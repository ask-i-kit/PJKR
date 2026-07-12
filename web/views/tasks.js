// タスク一覧+詳細パネル(F3)+ボール状態遷移(F4)+一括登録(F3-8)+担当別集計(F3-9)
import {
  state, col, visibleTasks, projects, projectName, contactName, byId,
  todayStr, fmtDate, fmtDateTime, dueKind, waitingInfo, STATUS, PRIORITY,
} from '../state.js';
import { createEntity, bulkCreateTasks, patchEntity, deleteEntity, addLog, openTarget } from '../actions.js';
import { waitingDialog, replyDialog, answerDialog, recordNudge } from '../dialogs.js';
import { esc, toast, openModal, closeModal } from '../ui.js';

export function render(el) {
  const f = state.taskFilter;
  let tasks = visibleTasks();
  if (f.status === 'open') tasks = tasks.filter((t) => t.status !== 'done');
  else if (f.status !== 'all') tasks = tasks.filter((t) => t.status === f.status);
  if (f.assignee === 'me') tasks = tasks.filter((t) => !t.assignee);
  else if (f.assignee) tasks = tasks.filter((t) => t.assignee === f.assignee);
  if (f.text) {
    const q = f.text.toLowerCase();
    tasks = tasks.filter((t) =>
      (t.title || '').toLowerCase().includes(q) || (t.detail || '').toLowerCase().includes(q));
  }

  const sel = state.selectedTaskId ? byId('tasks', state.selectedTaskId) : null;

  el.innerHTML = `
    <h2>タスク</h2>
    <div class="tasks-wrap">
      <div class="tasks-main">
        <div class="toolbar">
          <input type="text" id="newTask" placeholder="＋ 新しいタスク (Enterで追加)" style="flex:1;min-width:180px">
          <input type="text" id="fText" placeholder="絞り込み" value="${esc(f.text || '')}" style="width:110px">
          <select id="fStatus">
            <option value="open" ${f.status === 'open' ? 'selected' : ''}>未完了</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}
            <option value="all" ${f.status === 'all' ? 'selected' : ''}>すべて</option>
          </select>
          <select id="fAssignee">
            <option value="">担当: 全員</option>
            <option value="me" ${f.assignee === 'me' ? 'selected' : ''}>自分</option>
            ${col('contacts').map((c) => `<option value="${c.id}" ${f.assignee === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <select id="fGroup" title="グループ表示">
            <option value="">グループなし</option>
            <option value="assignee" ${f.group === 'assignee' ? 'selected' : ''}>担当別</option>
          </select>
          <button class="btn" id="bulkBtn" title="受入テスト項目などの一括登録">⇪ 一括登録</button>
        </div>
        ${f.group === 'assignee' ? groupedHTML(tasks) : tableHTML(treeOrder(tasks))}
      </div>
      ${sel ? detailHTML(sel) : ''}
    </div>`;

  bindList(el);
  if (sel) bindDetail(el, sel);
}

// ---- 一覧 ----

function tableHTML(rows) {
  return `<table class="list">
    <thead><tr>
      <th style="width:26px" title="今日やる">☀</th><th style="width:88px">状態</th><th>件名</th>
      <th style="width:110px">案件</th><th style="width:70px">担当</th>
      <th style="width:64px">期限</th><th style="width:34px">優先</th><th style="width:90px"></th>
    </tr></thead>
    <tbody>
      ${rows.map((r) => rowHTML(r.task, r.depth)).join('') ||
        `<tr><td colspan="8" class="empty">タスクがありません</td></tr>`}
    </tbody>
  </table>`;
}

// 担当別グループ表示(F3-9): 消化状況(完了n/全m)つき
function groupedHTML(tasks) {
  const groups = new Map(); // key: assignee(''=自分)
  for (const t of tasks) {
    const key = t.assignee || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  // 消化率は絞り込み前の全タスクで数える(未完了フィルタ中でも全体像を見せる)
  const all = visibleTasks();
  return [...groups.entries()].map(([key, list]) => {
    const totalOf = all.filter((t) => (t.assignee || '') === key);
    const done = totalOf.filter((t) => t.status === 'done').length;
    return `<div class="card">
      <h3>${esc(contactName(key || null))} <span class="muted">完了 ${done}/${totalOf.length}件</span></h3>
      <div class="progress-bar" style="max-width:220px"><div style="width:${totalOf.length ? Math.round(done / totalOf.length * 100) : 0}%"></div></div>
      ${tableHTML(treeOrder(list))}
    </div>`;
  }).join('') || '<div class="empty">タスクがありません</div>';
}

function treeOrder(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map();
  const roots = [];
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      if (!children.has(t.parentId)) children.set(t.parentId, []);
      children.get(t.parentId).push(t);
    } else roots.push(t);
  }
  const out = [];
  const walk = (t, depth) => {
    out.push({ task: t, depth });
    for (const c of children.get(t.id) || []) walk(c, depth + 1);
  };
  roots.forEach((t) => walk(t, 0));
  return out;
}

function rowHTML(t, depth) {
  const kind = dueKind(t);
  const today = t.todayOn === todayStr();
  const ballMark = t.status === 'waiting' ? ` <span title="相手: ${esc(contactName(t.contactId))}">🏐</span>`
    : (t.isAsked && t.status !== 'done' ? ' <span title="被依頼(自分ボール)">📩</span>' : '');
  return `<tr data-id="${t.id}" class="${t.id === state.selectedTaskId ? 'selected' : ''} ${t.status === 'done' ? 'done-task' : ''}">
    <td><span class="today-star ${today ? 'on' : ''}" data-act="today" title="今日やる">☀</span></td>
    <td><span class="status-chip status-${t.status}">${STATUS[t.status] || t.status}</span></td>
    <td><span class="indent" style="width:${depth * 18}px"></span><span class="task-title">${esc(t.title)}</span>${ballMark}</td>
    <td><span class="proj-tag">${esc(projectName(t.projectId))}</span></td>
    <td class="muted">${esc(contactName(t.assignee))}</td>
    <td class="${kind ? 'due-' + kind : ''}">${fmtDate(t.due)}</td>
    <td class="pri-${t.priority}">${PRIORITY[t.priority] || ''}</td>
    <td class="row-actions">
      <button class="btn small" data-act="child" title="子タスクを追加">＋子</button>
      <button class="btn small danger" data-act="del" title="削除">削除</button>
    </td>
  </tr>`;
}

function bindList(el) {
  const newTask = el.querySelector('#newTask');
  newTask.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !newTask.value.trim()) return;
    if (!projects().length) { toast('先に案件ホームから案件を登録してください', true); return; }
    const title = newTask.value.trim();
    newTask.value = '';
    const item = await createEntity('tasks', {
      ...taskDefaults(), title,
      projectId: state.projectId || projects()[0].id,
    }, 'タスク作成');
    state.selectedTaskId = item.id;
    document.dispatchEvent(new Event('pjkr:render'));
  });
  const rerender = () => document.dispatchEvent(new Event('pjkr:render'));
  el.querySelector('#fText').addEventListener('input', (e) => {
    state.taskFilter.text = e.target.value.trim();
    clearTimeout(bindList._t);
    bindList._t = setTimeout(rerender, 250);
  });
  el.querySelector('#fStatus').addEventListener('change', (e) => { state.taskFilter.status = e.target.value; rerender(); });
  el.querySelector('#fAssignee').addEventListener('change', (e) => { state.taskFilter.assignee = e.target.value; rerender(); });
  el.querySelector('#fGroup').addEventListener('change', (e) => { state.taskFilter.group = e.target.value; rerender(); });
  el.querySelector('#bulkBtn').addEventListener('click', bulkDialog);

  el.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.addEventListener('click', () => {
      state.selectedTaskId = state.selectedTaskId === id ? null : id;
      rerender();
    });
    tr.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const t = byId('tasks', id);
        switch (b.dataset.act) {
          case 'today':
            await patchEntity('tasks', id, { todayOn: t.todayOn === todayStr() ? null : todayStr() }, '今日やるの切替');
            break;
          case 'child': {
            const item = await createEntity('tasks', {
              ...taskDefaults(), title: '新しいサブタスク', projectId: t.projectId, parentId: id,
            }, 'サブタスク作成');
            state.selectedTaskId = item.id;
            rerender();
            break;
          }
          case 'del':
            if (state.selectedTaskId === id) state.selectedTaskId = null;
            await deleteEntity('tasks', id, `タスク削除「${t.title}」`);
            toast('削除しました(Ctrl+Zで戻せます)');
            break;
        }
      });
    });
  });
}

export function taskDefaults() {
  return {
    parentId: null, detail: '', start: null, due: null, priority: 'mid',
    status: 'todo', progress: 0, assignee: null, contactId: null,
    waitSince: null, replyHope: null, nudges: [], isAsked: false, askedOn: null,
    answer: '', checkMemo: '', todayOn: null, links: [], logs: [], doneAt: null,
  };
}

// ---- 一括登録(F3-8): 複数行貼り付け→工程テンプレートで親子生成 ----

function bulkDialog() {
  if (!projects().length) { toast('先に案件ホームから案件を登録してください', true); return; }
  const modal = openModal(`
    <h3>タスクの一括登録</h3>
    <div class="muted">1行が1項目になります(受入テストのデータ項目一覧の貼り付けを想定)。</div>
    <label>項目名(複数行)</label>
    <textarea id="bkItems" style="min-height:120px" placeholder="顧客マスタ&#10;受注データ&#10;請求データ"></textarea>
    <label>案件</label>
    <select id="bkProject">${projects().map((p) =>
      `<option value="${p.id}" ${p.id === state.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label>工程テンプレート(カンマ区切りで子タスクを生成。空欄なら子なし)</label>
    <input type="text" id="bkSteps" value="作成,検証">
    <label>担当 / 期限(全項目に適用)</label>
    <div style="display:flex;gap:6px">
      <select id="bkAssignee" style="flex:1">
        <option value="">自分</option>
        ${col('contacts').map((c) => `<option value="${c.id}">${esc(c.name)}(${esc(c.org)})</option>`).join('')}
      </select>
      <input type="date" id="bkDue" style="flex:1">
    </div>
    <div class="modal-actions">
      <button class="btn" id="bkCancel">キャンセル</button>
      <button class="btn primary" id="bkOk">一括登録</button>
    </div>`);
  modal.querySelector('#bkCancel').addEventListener('click', closeModal);
  modal.querySelector('#bkOk').addEventListener('click', async () => {
    const items = modal.querySelector('#bkItems').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!items.length) { toast('項目名を入力してください', true); return; }
    const projectId = modal.querySelector('#bkProject').value;
    const steps = modal.querySelector('#bkSteps').value.split(',').map((s) => s.trim()).filter(Boolean);
    const assignee = modal.querySelector('#bkAssignee').value || null;
    const due = modal.querySelector('#bkDue').value || null;
    closeModal();
    toast(`${items.length}項目を登録しています...`);
    await bulkCreateTasks(
      items.map((title) => ({ ...taskDefaults(), title, projectId, assignee, due })),
      (parent) => steps.map((s) => ({
        ...taskDefaults(), title: `${parent.title} - ${s}`, projectId, parentId: parent.id, assignee, due,
      })),
      `一括登録(${items.length}項目)`);
    toast(`${items.length}項目を一括登録しました(Ctrl+Zでまとめて取り消せます)`);
  });
}

// ---- 詳細パネル ----

function detailHTML(t) {
  const wi = t.status === 'waiting' ? waitingInfo(t) : null;
  return `<div class="detail-panel" id="detail">
    <label>件名</label><input type="text" data-f="title" value="${esc(t.title)}">
    <label>案件</label>
    <select data-f="projectId">${projects().map((p) =>
      `<option value="${p.id}" ${p.id === t.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label>状態 / 優先度</label>
    <div style="display:flex;gap:6px">
      <select id="statusSel" style="flex:1">${Object.entries(STATUS).map(([k, v]) =>
        `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select data-f="priority" style="flex:1">${Object.entries(PRIORITY).map(([k, v]) =>
        `<option value="${k}" ${t.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    ${wi ? `
    <div class="ball-info">
      🏐 相手: <b>${esc(contactName(t.contactId))}</b> / ${fmtDate(wi.base)}から
      <b class="${wi.alert ? 'due-over' : ''}">${wi.elapsed}営業日</b>経過
      ${t.replyHope ? ` / 回答希望 ${fmtDate(t.replyHope)}` : ''}
      ${(t.nudges || []).length ? ` / 催促${t.nudges.length}回` : ''}
      <div style="margin-top:6px">
        <button class="btn small" id="nudgeBtn">📣 催促した</button>
        <button class="btn small primary" id="replyBtn">✉ 回答受領</button>
      </div>
    </div>` : ''}
    <label><input type="checkbox" id="isAsked" ${t.isAsked ? 'checked' : ''}> 被依頼(相手から受けた仕事)</label>
    ${t.isAsked ? `
      <label>依頼元 / 発生日</label>
      <div style="display:flex;gap:6px">
        <select data-f="contactId" style="flex:1">
          <option value="">(未設定)</option>
          ${col('contacts').map((c) => `<option value="${c.id}" ${t.contactId === c.id ? 'selected' : ''}>${esc(c.name)}(${esc(c.org)})</option>`).join('')}
        </select>
        <input type="date" data-f="askedOn" value="${t.askedOn || ''}" style="flex:1">
      </div>
      <label>確認メモ(何を確認すれば回答できるか)</label>
      <textarea data-f="checkMemo" style="min-height:48px">${esc(t.checkMemo || '')}</textarea>
      ${t.answer ? `<label>回答概要</label><div class="muted">${esc(t.answer)}</div>` : ''}
    ` : ''}
    <label>担当(実行者)</label>
    <select data-f="assignee">
      <option value="">自分</option>
      ${col('contacts').map((c) => `<option value="${c.id}" ${t.assignee === c.id ? 'selected' : ''}>${esc(c.name)}(${esc(c.org)})</option>`).join('')}
      <option value="__new__">＋担当者を追加...</option>
    </select>
    <label>開始日 / 期限</label>
    <div style="display:flex;gap:6px">
      <input type="date" data-f="start" value="${t.start || ''}" style="flex:1">
      <input type="date" data-f="due" value="${t.due || ''}" style="flex:1">
    </div>
    <label>詳細</label><textarea data-f="detail">${esc(t.detail)}</textarea>

    <label>関連リンク</label>
    ${(t.links || []).map((l) => `
      <div class="link-item">
        <a data-open="${esc(l.target)}" title="${esc(l.target)}">🔗 ${esc(l.label || l.target)}</a>
        <button class="btn small danger row-actions" data-dellink="${l.id}">×</button>
      </div>`).join('')}
    <div class="add-form">
      <input type="text" id="linkLabel" placeholder="表示名" style="width:100px">
      <input type="text" id="linkTarget" placeholder="パスまたはURL" style="flex:1;min-width:120px">
      <button class="btn small" id="addLink">追加</button>
    </div>

    <label>作業ログ</label>
    <div>${(t.logs || []).slice().reverse().map((l) => `
      <div class="log-item"><time>${fmtDateTime(l.at)}</time>${esc(l.text)}</div>`).join('')
      || '<div class="empty">ログはまだありません</div>'}</div>
    <div class="add-form">
      <input type="text" id="logText" placeholder="ログを追記 (Enter)" style="flex:1">
    </div>

    <div class="modal-actions">
      ${t.status !== 'waiting' && t.status !== 'done' ? `<button class="btn" id="waitBtn">🏐 返答待ちへ</button>` : ''}
      ${t.status !== 'done' ? `<button class="btn primary" id="doneBtn">✔ 完了にする</button>` : ''}
      <button class="btn" id="closeDetail">閉じる</button>
    </div>
  </div>`;
}

function bindDetail(el, t) {
  const panel = el.querySelector('#detail');

  panel.querySelectorAll('[data-f]').forEach((input) => {
    input.addEventListener('change', async () => {
      const f = input.dataset.f;
      let v = input.value;
      if (f === 'assignee' && v === '__new__') { newContactDialog(t); return; }
      if ((f === 'start' || f === 'due' || f === 'assignee' || f === 'contactId' || f === 'askedOn') && v === '') v = null;
      await patchEntity('tasks', t.id, { [f]: v }, 'タスク更新');
    });
  });

  // 状態遷移(F4): waitingへの切替・waitingからの復帰・被依頼の完了はダイアログを挟む
  panel.querySelector('#statusSel').addEventListener('change', async (e) => {
    const next = e.target.value;
    if (next === t.status) return;
    if (next === 'waiting') { waitingDialog(t); return; }
    if (t.status === 'waiting' && next !== 'done') { replyDialog(t, next); return; }
    if (next === 'done' && t.isAsked) { answerDialog(t); return; }
    if (t.status === 'waiting' && next === 'done') { replyDialog(t, 'done'); return; }
    const fields = { status: next };
    if (next === 'done') fields.doneAt = new Date().toISOString();
    await patchEntity('tasks', t.id, fields, 'タスク更新');
  });

  panel.querySelector('#isAsked').addEventListener('change', async (e) => {
    const fields = { isAsked: e.target.checked };
    if (e.target.checked && !t.askedOn) fields.askedOn = todayStr();
    await patchEntity('tasks', t.id, fields, '被依頼の切替');
  });

  panel.querySelector('#nudgeBtn')?.addEventListener('click', () => recordNudge(t));
  panel.querySelector('#replyBtn')?.addEventListener('click', () => replyDialog(t, 'doing'));
  panel.querySelector('#waitBtn')?.addEventListener('click', () => waitingDialog(t));

  panel.querySelector('#addLink').addEventListener('click', async () => {
    const label = panel.querySelector('#linkLabel').value.trim();
    const target = panel.querySelector('#linkTarget').value.trim();
    if (!target) return;
    const links = [...(t.links || []), { id: 'l' + Date.now(), label: label || target, kind: 'file', target, group: '', memo: '' }];
    await patchEntity('tasks', t.id, { links }, 'リンク追加');
  });
  panel.querySelectorAll('[data-dellink]').forEach((b) => {
    b.addEventListener('click', async () => {
      const links = (t.links || []).filter((l) => l.id !== b.dataset.dellink);
      await patchEntity('tasks', t.id, { links }, 'リンク削除');
    });
  });
  panel.querySelectorAll('[data-open]').forEach((a) => {
    a.addEventListener('click', () => openTarget(a.dataset.open));
  });

  const logText = panel.querySelector('#logText');
  logText.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !logText.value.trim()) return;
    await addLog(t.id, logText.value.trim());
  });

  panel.querySelector('#doneBtn')?.addEventListener('click', async () => {
    if (t.isAsked) { answerDialog(t); return; }
    if (t.status === 'waiting') { replyDialog(t, 'done'); return; }
    await patchEntity('tasks', t.id, { status: 'done', doneAt: new Date().toISOString() }, 'タスク完了');
  });
  panel.querySelector('#closeDetail').addEventListener('click', () => {
    state.selectedTaskId = null;
    document.dispatchEvent(new Event('pjkr:render'));
  });
}

function newContactDialog(task) {
  const modal = openModal(`
    <h3>担当者を追加</h3>
    <label>名前</label><input type="text" id="cName">
    <label>所属(ベンダー名/部署名)</label><input type="text" id="cOrg">
    <div class="modal-actions">
      <button class="btn" id="cCancel">キャンセル</button>
      <button class="btn primary" id="cOk">追加して割当</button>
    </div>`);
  modal.querySelector('#cCancel').addEventListener('click', closeModal);
  modal.querySelector('#cOk').addEventListener('click', async () => {
    const name = modal.querySelector('#cName').value.trim();
    if (!name) return;
    const org = modal.querySelector('#cOrg').value.trim();
    closeModal();
    const c = await createEntity('contacts', { name, org, memo: '' }, '担当者追加');
    await patchEntity('tasks', task.id, { assignee: c.id }, '担当変更');
  });
}
