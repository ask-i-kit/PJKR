// 回答管理(F14): 過去の問い合わせ&回答をQ&A形式で参照・検索する
import { state, col, projects, projectName, contactName, fmtDate, answeredTasks } from '../state.js';
import { esc } from '../ui.js';

let q = '';
let fContact = '';
let fProject = '';

export function render(el) {
  let list = answeredTasks();
  if (fContact) list = list.filter((t) => t.contactId === fContact);
  if (fProject) list = list.filter((t) => t.projectId === fProject);
  if (q) {
    const s = q.toLowerCase();
    list = list.filter((t) =>
      [t.title, t.detail, t.answer, ...(t.logs || []).map((l) => l.text)]
        .some((x) => (x || '').toLowerCase().includes(s)));
  }
  list = list.slice().sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  el.innerHTML = `
    <h2>回答管理 <span class="muted">過去の問い合わせと回答(${list.length}件)</span></h2>
    <div class="toolbar">
      <input type="text" id="aq" placeholder="キーワード検索(質問・回答・ログ)" value="${esc(q)}" style="flex:1;min-width:200px">
      <select id="afContact">
        <option value="">相手: すべて</option>
        ${col('contacts').map((c) => `<option value="${c.id}" ${fContact === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select id="afProject">
        <option value="">案件: すべて</option>
        ${projects().map((p) => `<option value="${p.id}" ${fProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    ${list.map(qaHTML).join('') ||
      '<div class="card empty">回答済みの問い合わせはまだありません。被依頼タスクを「回答して完了」するとここに溜まります。</div>'}`;

  const rerender = () => document.dispatchEvent(new Event('pjkr:render'));
  el.querySelector('#aq').addEventListener('input', (e) => {
    q = e.target.value.trim();
    clearTimeout(render._t);
    render._t = setTimeout(rerender, 250);
  });
  el.querySelector('#afContact').addEventListener('change', (e) => { fContact = e.target.value; rerender(); });
  el.querySelector('#afProject').addEventListener('change', (e) => { fProject = e.target.value; rerender(); });
  el.querySelectorAll('[data-jump]').forEach((s) => s.addEventListener('click', () => {
    state.selectedTaskId = s.dataset.jump;
    state.taskFilter.status = 'all';
    location.hash = '#/tasks';
  }));
}

function qaHTML(t) {
  const answer = t.answer || lastReplyLog(t) || '(回答概要なし。詳細は元タスクの作業ログを参照)';
  return `<div class="qa-item">
    <div class="qa-q">Q. ${esc(t.title)}${t.detail ? ` <span class="muted">${esc(t.detail)}</span>` : ''}</div>
    <div class="qa-a">A. ${esc(answer)}</div>
    <div class="qa-meta">
      ${t.contactId ? `${esc(contactName(t.contactId))} / ` : ''}
      <span class="proj-tag">${esc(projectName(t.projectId))}</span>
      回答日: ${t.doneAt ? fmtDate(t.doneAt.slice(0, 10)) : '-'}
      <a data-jump="${t.id}" style="cursor:pointer;color:#1d4ed8">元タスクへ →</a>
    </div>
  </div>`;
}

function lastReplyLog(t) {
  for (const l of (t.logs || []).slice().reverse()) {
    if (l.text.startsWith('【回答】')) return l.text.slice(4);
  }
  return '';
}
