// 課題・リスク管理(F6)
import {
  state, col, byId, projects, projectName, contactName, fmtDate, fmtDateTime,
  todayStr, addDays, ISTATUS, RSTATUS, LEVEL,
} from '../state.js';
import { createEntity, patchEntity, deleteEntity } from '../actions.js';
import { esc, toast } from '../ui.js';

export function render(el) {
  const tab = state.issueTab;
  el.innerHTML = `
    <h2>課題・リスク</h2>
    <div class="proj-tabs">
      <button class="btn ${tab === 'issues' ? 'active' : ''}" data-tab="issues">⚠ 課題(${openCount('issues')})</button>
      <button class="btn ${tab === 'risks' ? 'active' : ''}" data-tab="risks">⚡ リスク(${openCount('risks')})</button>
    </div>
    ${tab === 'issues' ? issuesHTML() : risksHTML()}`;

  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      state.issueTab = b.dataset.tab;
      state.selectedIssueId = null;
      document.dispatchEvent(new Event('pjkr:render'));
    });
  });
  if (tab === 'issues') bindIssues(el);
  else bindRisks(el);
}

function visible(entity) {
  const archived = new Set(col('projects').filter((p) => p.archived).map((p) => p.id));
  return col(entity).filter((x) => {
    if (state.projectId && x.projectId !== state.projectId) return false;
    if (!state.projectId && archived.has(x.projectId)) return false;
    return true;
  });
}
const openCount = (entity) => visible(entity).filter((x) => x.status !== 'done').length;

// ---- 課題 ----

function issuesHTML() {
  const list = visible('issues').slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9999').localeCompare(b.due || '9999'));
  const sel = state.selectedIssueId ? byId('issues', state.selectedIssueId) : null;
  const staleLine = addDays(todayStr(), -14);
  return `<div class="tasks-wrap">
    <div class="tasks-main">
      <div class="toolbar">
        <input type="text" id="newIssue" placeholder="＋ 課題を起票 (Enterで追加)" style="flex:1;min-width:200px">
      </div>
      <table class="list">
        <thead><tr><th style="width:50px">番号</th><th>件名</th><th style="width:100px">案件</th>
          <th style="width:40px">重要</th><th style="width:70px">対応者</th><th style="width:64px">期限</th>
          <th style="width:76px">状態</th><th style="width:70px">更新</th><th style="width:56px"></th></tr></thead>
        <tbody>${list.map((i) => {
          const stale = i.status !== 'done' && (i.updatedAt || '').slice(0, 10) < staleLine; // 2週間未更新(F6-6)
          const dueOver = i.due && i.due < todayStr() && i.status !== 'done';
          return `<tr data-id="${i.id}" class="${i.id === state.selectedIssueId ? 'selected' : ''} ${i.status === 'done' ? 'done-task' : ''} ${stale ? 'stale-issue' : ''}">
            <td class="muted">${esc(i.id.replace('q', '課-'))}</td>
            <td>${esc(i.title)}${stale ? ' <span title="2週間以上更新なし">🕸</span>' : ''}</td>
            <td><span class="proj-tag">${esc(projectName(i.projectId))}</span></td>
            <td class="pri-${i.severity}">${LEVEL[i.severity] || ''}</td>
            <td class="muted">${esc(contactName(i.assignee))}</td>
            <td class="${dueOver ? 'due-over' : ''}">${fmtDate(i.due)}</td>
            <td><span class="status-chip status-${i.status === 'open' ? 'todo' : i.status}">${ISTATUS[i.status] || i.status}</span></td>
            <td class="muted">${fmtDate((i.updatedAt || '').slice(0, 10))}</td>
            <td class="row-actions"><button class="btn small danger" data-del="${i.id}">削除</button></td>
          </tr>`;
        }).join('') || '<tr><td colspan="9" class="empty">課題はありません</td></tr>'}
        </tbody>
      </table>
    </div>
    ${sel ? issueDetailHTML(sel) : ''}
  </div>`;
}

function issueDetailHTML(i) {
  return `<div class="detail-panel" id="issueDetail">
    <label>件名</label><input type="text" data-f="title" value="${esc(i.title)}">
    <label>案件</label>
    <select data-f="projectId">${projects().map((p) =>
      `<option value="${p.id}" ${p.id === i.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label>内容</label><textarea data-f="detail">${esc(i.detail || '')}</textarea>
    <label>状態 / 重要度</label>
    <div style="display:flex;gap:6px">
      <select data-f="status" style="flex:1">${Object.entries(ISTATUS).map(([k, v]) =>
        `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select data-f="severity" style="flex:1">${Object.entries(LEVEL).map(([k, v]) =>
        `<option value="${k}" ${i.severity === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <label>対応者</label>
    <select data-f="assignee">
      <option value="">自分</option>
      ${col('contacts').map((c) => `<option value="${c.id}" ${i.assignee === c.id ? 'selected' : ''}>${esc(c.name)}(${esc(c.org)})</option>`).join('')}
    </select>
    <label>発生日 / 期限</label>
    <div style="display:flex;gap:6px">
      <input type="date" data-f="openedOn" value="${i.openedOn || ''}" style="flex:1">
      <input type="date" data-f="due" value="${i.due || ''}" style="flex:1">
    </div>
    <label>対応履歴</label>
    <div>${(i.logs || []).slice().reverse().map((l) => `
      <div class="log-item"><time>${fmtDateTime(l.at)}</time>${esc(l.text)}</div>`).join('')
      || '<div class="empty">履歴はまだありません</div>'}</div>
    <div class="add-form">
      <input type="text" id="issueLog" placeholder="対応を記録 (Enter)" style="flex:1">
    </div>
    <div class="modal-actions">
      <button class="btn" id="closeIssue">閉じる</button>
    </div>
  </div>`;
}

function bindIssues(el) {
  const rerender = () => document.dispatchEvent(new Event('pjkr:render'));
  el.querySelector('#newIssue').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    if (!projects().length) { toast('先に案件ホームから案件を登録してください', true); return; }
    const title = e.target.value.trim();
    e.target.value = '';
    const item = await createEntity('issues', {
      projectId: state.projectId || projects()[0].id,
      title, detail: '', openedOn: todayStr(), due: null,
      severity: 'mid', assignee: null, status: 'open', logs: [],
    }, '課題起票');
    state.selectedIssueId = item.id;
    rerender();
  });
  el.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      state.selectedIssueId = state.selectedIssueId === tr.dataset.id ? null : tr.dataset.id;
      rerender();
    });
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.selectedIssueId === b.dataset.del) state.selectedIssueId = null;
      await deleteEntity('issues', b.dataset.del, '課題削除');
      toast('削除しました(Ctrl+Zで戻せます)');
    });
  });

  const panel = el.querySelector('#issueDetail');
  if (!panel) return;
  const i = byId('issues', state.selectedIssueId);
  panel.querySelectorAll('[data-f]').forEach((input) => {
    input.addEventListener('change', async () => {
      let v = input.value;
      if ((input.dataset.f === 'due' || input.dataset.f === 'openedOn' || input.dataset.f === 'assignee') && v === '') v = null;
      await patchEntity('issues', i.id, { [input.dataset.f]: v }, '課題更新');
    });
  });
  panel.querySelector('#issueLog').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const logs = [...(i.logs || []), { at: new Date().toISOString(), text: e.target.value.trim() }];
    await patchEntity('issues', i.id, { logs }, '対応履歴を記録');
  });
  panel.querySelector('#closeIssue').addEventListener('click', () => {
    state.selectedIssueId = null;
    rerender();
  });
}

// ---- リスク ----

function risksHTML() {
  const list = visible('risks').slice().sort((a, b) => (a.status === 'done') - (b.status === 'done'));
  return `
    <div class="toolbar">
      <input type="text" id="newRisk" placeholder="＋ リスクを登録 (Enterで追加)" style="flex:1;min-width:200px">
    </div>
    ${list.map((r) => `
      <div class="card ${r.status === 'done' ? 'done-task' : ''}" data-risk="${r.id}">
        <h3>${esc(r.title)}
          <span class="muted">影響 <b class="pri-${r.impact}">${LEVEL[r.impact]}</b> × 可能性 <b class="pri-${r.likelihood}">${LEVEL[r.likelihood]}</b></span>
          <span class="proj-tag">${esc(projectName(r.projectId))}</span>
          <span class="status-chip status-${r.status === 'open' ? 'doing' : 'done'}">${RSTATUS[r.status]}</span>
        </h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <select data-rf="impact" style="width:110px">
            ${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}" ${r.impact === k ? 'selected' : ''}>影響: ${v}</option>`).join('')}
          </select>
          <select data-rf="likelihood" style="width:110px">
            ${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}" ${r.likelihood === k ? 'selected' : ''}>可能性: ${v}</option>`).join('')}
          </select>
          <select data-rf="status" style="width:110px">
            ${Object.entries(RSTATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <select data-rf="projectId" style="width:150px">
            ${projects().map((p) => `<option value="${p.id}" ${r.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <button class="btn small danger" data-delrisk="${r.id}" style="margin-left:auto">削除</button>
        </div>
        <label class="muted" style="display:block;margin-top:6px">対応方針</label>
        <textarea data-rf="plan" style="width:100%;min-height:40px" placeholder="回避・軽減・受容などの方針">${esc(r.plan || '')}</textarea>
      </div>`).join('') || '<div class="card empty">リスクはありません</div>'}`;
}

function bindRisks(el) {
  el.querySelector('#newRisk').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    if (!projects().length) { toast('先に案件ホームから案件を登録してください', true); return; }
    const title = e.target.value.trim();
    e.target.value = '';
    await createEntity('risks', {
      projectId: state.projectId || projects()[0].id,
      title, impact: 'mid', likelihood: 'mid', plan: '', status: 'open',
    }, 'リスク登録');
  });
  el.querySelectorAll('[data-risk]').forEach((card) => {
    const id = card.dataset.risk;
    card.querySelectorAll('[data-rf]').forEach((input) => {
      input.addEventListener('change', async () => {
        await patchEntity('risks', id, { [input.dataset.rf]: input.value }, 'リスク更新');
      });
    });
  });
  el.querySelectorAll('[data-delrisk]').forEach((b) => {
    b.addEventListener('click', async () => {
      await deleteEntity('risks', b.dataset.delrisk, 'リスク削除');
      toast('削除しました(Ctrl+Zで戻せます)');
    });
  });
}
