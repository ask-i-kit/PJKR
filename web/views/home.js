// 案件ホーム: リンク集(F12)+案件メモ(F15)+サマリ+案件管理(F1)
import { state, col, projects, byId, fmtDate, fmtDateTime, dueKind, todayStr } from '../state.js';
import { createEntity, patchEntity, deleteEntity, openTarget } from '../actions.js';
import { esc, toast, openModal, closeModal } from '../ui.js';

const PSTATUS = { planned: '計画中', active: '進行中', onhold: '保留', done: '完了' };
let editingNoteId = null;

export function render(el) {
  const ps = projects();
  if (!ps.find((p) => p.id === state.homeProjectId)) {
    state.homeProjectId = (ps.find((p) => p.id === state.projectId) || ps[0])?.id || '';
  }
  const p = byId('projects', state.homeProjectId);

  el.innerHTML = `
    <h2>案件ホーム</h2>
    <div class="proj-tabs">
      ${ps.map((x) => `<button class="btn ${x.id === state.homeProjectId ? 'active' : ''}" data-proj="${x.id}">${esc(x.name)}</button>`).join('')}
      <button class="btn" id="newProj">＋ 新規案件</button>
    </div>
    ${p ? projectHTML(p) : '<div class="card empty">案件がありません。「＋ 新規案件」から登録してください。</div>'}`;

  el.querySelectorAll('[data-proj]').forEach((b) => {
    b.addEventListener('click', () => {
      state.homeProjectId = b.dataset.proj;
      editingNoteId = null;
      document.dispatchEvent(new Event('pjkr:render'));
    });
  });
  el.querySelector('#newProj').addEventListener('click', () => projectDialog(null));
  if (p) bind(el, p);
}

function projectHTML(p) {
  const tasks = col('tasks').filter((t) => t.projectId === p.id);
  const open = tasks.filter((t) => t.status !== 'done');
  const over = open.filter((t) => dueKind(t) === 'over');
  const next = open.filter((t) => t.due && t.due >= todayStr())
    .sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);

  const groups = {};
  for (const l of p.links || []) (groups[l.group || ''] ??= []).push(l);

  const notes = col('notes').filter((n) => n.projectId === p.id)
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  return `
    <div class="card">
      <h3>${esc(p.name)}
        <span class="status-chip">${PSTATUS[p.status] || p.status}</span>
        ${p.vendor ? `<span class="muted">/ ${esc(p.vendor)}</span>` : ''}
        <button class="btn small" id="editProj">編集</button></h3>
      <div class="muted">${p.start ? '期間: ' + fmtDate(p.start) + '〜' + (p.end ? fmtDate(p.end) : '') : ''}
        ${p.summary ? ' / ' + esc(p.summary) : ''}</div>
      <div class="muted" style="margin-top:6px">
        未完了タスク ${open.length}件
        ${over.length ? `・<span class="due-over">期限切れ${over.length}件</span>` : ''}
        ${next.length ? '・直近期限: ' + next.map((t) => `${esc(t.title)}(${fmtDate(t.due)})`).join(', ') : ''}
      </div>
    </div>

    <div class="card">
      <h3>🔗 リンク集</h3>
      ${Object.entries(groups).map(([g, links]) => `
        ${g ? `<div class="link-group-title">${esc(g)}</div>` : ''}
        ${links.map((l) => `
          <div class="link-item">
            <a data-open="${esc(l.target)}" title="${esc(l.target)}">${kindIcon(l.kind)} ${esc(l.label)}</a>
            ${l.memo ? `<span class="muted">${esc(l.memo)}</span>` : ''}
            <button class="btn small danger row-actions" data-dellink="${l.id}">×</button>
          </div>`).join('')}`).join('') || '<div class="empty">リンクがありません</div>'}
      <div class="add-form">
        <input type="text" id="lkLabel" placeholder="表示名" style="width:110px">
        <select id="lkKind">
          <option value="file">ファイル</option><option value="folder">フォルダ</option>
          <option value="url">URL</option><option value="mail">メール</option>
        </select>
        <input type="text" id="lkTarget" placeholder="パスまたはURL(共有フォルダ可)" style="flex:1;min-width:180px">
        <input type="text" id="lkGroup" placeholder="分類(任意)" style="width:90px">
        <button class="btn small primary" id="addLink">追加</button>
      </div>
    </div>

    <div class="card">
      <h3>📝 案件メモ</h3>
      <div class="add-form" style="margin-bottom:10px">
        <input type="text" id="ntTitle" placeholder="タイトル(任意)" style="width:180px">
        <textarea id="ntBody" placeholder="メモ本文(決定事項・経緯・方針など)" style="flex:1;min-width:200px;min-height:38px"></textarea>
        <button class="btn small primary" id="addNote">追加</button>
      </div>
      ${notes.map((n) => noteHTML(n)).join('') || '<div class="empty">メモがありません</div>'}
    </div>`;
}

function kindIcon(kind) {
  return { file: '📄', folder: '📁', url: '🌐', mail: '✉' }[kind] || '🔗';
}

function noteHTML(n) {
  if (editingNoteId === n.id) {
    return `<div class="note-item ${n.pinned ? 'pinned' : ''}" data-note="${n.id}">
      <input type="text" id="edTitle" value="${esc(n.title)}" placeholder="タイトル(任意)" style="width:100%;margin-bottom:6px">
      <textarea id="edBody" style="width:100%;min-height:80px">${esc(n.body)}</textarea>
      <div class="modal-actions">
        <button class="btn small" data-nact="cancel" data-id="${n.id}">キャンセル</button>
        <button class="btn small primary" data-nact="save" data-id="${n.id}">保存</button>
      </div>
    </div>`;
  }
  return `<div class="note-item ${n.pinned ? 'pinned' : ''}">
    ${n.title ? `<h4>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h4>` : (n.pinned ? '<h4>📌</h4>' : '')}
    <div class="body">${esc(n.body)}</div>
    <div class="meta">${fmtDateTime(n.updatedAt)}
      <button class="btn small row-actions" data-nact="pin" data-id="${n.id}">${n.pinned ? 'ピン解除' : 'ピン留め'}</button>
      <button class="btn small row-actions" data-nact="edit" data-id="${n.id}">編集</button>
      <button class="btn small danger row-actions" data-nact="del" data-id="${n.id}">削除</button>
    </div>
  </div>`;
}

function bind(el, p) {
  el.querySelector('#editProj').addEventListener('click', () => projectDialog(p));

  el.querySelectorAll('[data-open]').forEach((a) => {
    a.addEventListener('click', () => openTarget(a.dataset.open));
  });
  el.querySelector('#addLink').addEventListener('click', async () => {
    const target = el.querySelector('#lkTarget').value.trim();
    if (!target) { toast('パスまたはURLを入力してください', true); return; }
    const label = el.querySelector('#lkLabel').value.trim() || target;
    const link = {
      id: 'l' + Date.now(), label, kind: el.querySelector('#lkKind').value,
      target, group: el.querySelector('#lkGroup').value.trim(), memo: '',
    };
    await patchEntity('projects', p.id, { links: [...(p.links || []), link] }, 'リンク追加');
  });
  el.querySelectorAll('[data-dellink]').forEach((b) => {
    b.addEventListener('click', async () => {
      const links = (p.links || []).filter((l) => l.id !== b.dataset.dellink);
      await patchEntity('projects', p.id, { links }, 'リンク削除');
    });
  });

  el.querySelector('#addNote').addEventListener('click', async () => {
    const body = el.querySelector('#ntBody').value.trim();
    if (!body) return;
    await createEntity('notes', {
      projectId: p.id, title: el.querySelector('#ntTitle').value.trim(),
      body, pinned: false, links: [],
    }, '案件メモ追加');
  });
  el.querySelectorAll('[data-nact]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.id;
      const n = byId('notes', id);
      switch (b.dataset.nact) {
        case 'pin':
          await patchEntity('notes', id, { pinned: !n.pinned }, 'ピン留め切替');
          break;
        case 'edit':
          editingNoteId = id;
          document.dispatchEvent(new Event('pjkr:render'));
          break;
        case 'cancel':
          editingNoteId = null;
          document.dispatchEvent(new Event('pjkr:render'));
          break;
        case 'save': {
          const box = el.querySelector(`[data-note="${id}"]`);
          editingNoteId = null;
          await patchEntity('notes', id, {
            title: box.querySelector('#edTitle').value.trim(),
            body: box.querySelector('#edBody').value,
          }, '案件メモ編集');
          break;
        }
        case 'del':
          await deleteEntity('notes', id, '案件メモ削除');
          toast('削除しました(Ctrl+Zで戻せます)');
          break;
      }
    });
  });
}

// 案件の新規作成/編集ダイアログ(F1)
function projectDialog(p) {
  const modal = openModal(`
    <h3>${p ? '案件を編集' : '新規案件'}</h3>
    <label>案件名 *</label><input type="text" id="pjName" value="${esc(p?.name || '')}">
    <label>依頼元/ベンダー</label><input type="text" id="pjVendor" value="${esc(p?.vendor || '')}">
    <label>状態</label>
    <select id="pjStatus">${Object.entries(PSTATUS).map(([k, v]) =>
      `<option value="${k}" ${p?.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label>開始日 / 終了日</label>
    <div style="display:flex;gap:6px">
      <input type="date" id="pjStart" value="${p?.start || ''}" style="flex:1">
      <input type="date" id="pjEnd" value="${p?.end || ''}" style="flex:1">
    </div>
    <label>概要</label><textarea id="pjSummary">${esc(p?.summary || '')}</textarea>
    ${p ? `<label><input type="checkbox" id="pjArchived" ${p.archived ? 'checked' : ''}> アーカイブする(通常表示から除外)</label>` : ''}
    <div class="modal-actions">
      <button class="btn" id="pjCancel">キャンセル</button>
      <button class="btn primary" id="pjOk">${p ? '保存' : '作成'}</button>
    </div>`);
  modal.querySelector('#pjCancel').addEventListener('click', closeModal);
  modal.querySelector('#pjOk').addEventListener('click', async () => {
    const name = modal.querySelector('#pjName').value.trim();
    if (!name) { toast('案件名を入力してください', true); return; }
    const fields = {
      name,
      vendor: modal.querySelector('#pjVendor').value.trim(),
      status: modal.querySelector('#pjStatus').value,
      start: modal.querySelector('#pjStart').value || null,
      end: modal.querySelector('#pjEnd').value || null,
      summary: modal.querySelector('#pjSummary').value.trim(),
    };
    closeModal();
    if (p) {
      fields.archived = modal.querySelector('#pjArchived')?.checked || false;
      await patchEntity('projects', p.id, fields, '案件編集');
    } else {
      const item = await createEntity('projects', { ...fields, archived: false, links: [] }, '案件作成');
      state.homeProjectId = item.id;
      document.dispatchEvent(new Event('pjkr:render'));
    }
  });
}
