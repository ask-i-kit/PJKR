// 横断検索(F10): タスク(作業ログ含む)・課題・案件メモ・Inbox・リスクを串刺しで検索
import { state, col, projectName, fmtDate, STATUS, ISTATUS } from '../state.js';
import { esc } from '../ui.js';

export function render(el) {
  const q = (state.search || '').trim().toLowerCase();
  if (!q) {
    el.innerHTML = `<h2>横断検索</h2>
      <div class="card empty">上の検索ボックス(Ctrl+F)にキーワードを入力してください。<br>
      タスク(件名・詳細・作業ログ・回答)、課題(内容・対応履歴)、案件メモ、Inbox、リスクを横断検索します。</div>`;
    return;
  }
  const hit = (...fields) => fields.some((x) => (x || '').toLowerCase().includes(q));

  const tasks = col('tasks').filter((t) => hit(t.title, t.detail, t.answer, t.checkMemo,
    ...(t.logs || []).map((l) => l.text)));
  const issues = col('issues').filter((i) => hit(i.title, i.detail, ...(i.logs || []).map((l) => l.text)));
  const notes = col('notes').filter((n) => hit(n.title, n.body));
  const inbox = col('inbox').filter((i) => hit(i.text));
  const risks = col('risks').filter((r) => hit(r.title, r.plan));
  const total = tasks.length + issues.length + notes.length + inbox.length + risks.length;

  el.innerHTML = `
    <h2>横断検索 <span class="muted">「${esc(state.search)}」 ${total}件</span></h2>
    ${section('✅ タスク', tasks, (t) => `
      <div class="dash-item">
        <span class="status-chip status-${t.status}">${STATUS[t.status]}</span>
        <span class="title" data-jump-task="${t.id}">${esc(t.title)}</span>
        <span class="proj-tag">${esc(projectName(t.projectId))}</span>
        <span class="muted">${esc(snippet(q, t.detail, t.answer, t.checkMemo, ...(t.logs || []).map((l) => l.text)))}</span>
      </div>`)}
    ${section('⚠ 課題', issues, (i) => `
      <div class="dash-item">
        <span class="status-chip status-${i.status === 'open' ? 'todo' : i.status}">${ISTATUS[i.status]}</span>
        <span class="title" data-jump-issue="${i.id}">${esc(i.title)}</span>
        <span class="proj-tag">${esc(projectName(i.projectId))}</span>
        <span class="muted">${esc(snippet(q, i.detail, ...(i.logs || []).map((l) => l.text)))}</span>
      </div>`)}
    ${section('📝 案件メモ', notes, (n) => `
      <div class="dash-item">
        <span class="title" data-jump-note="${n.projectId}">${esc(n.title || n.body.slice(0, 30))}</span>
        <span class="proj-tag">${esc(projectName(n.projectId))}</span>
        <span class="muted">${esc(snippet(q, n.body))} (${fmtDate((n.updatedAt || '').slice(0, 10))})</span>
      </div>`)}
    ${section('📥 Inbox', inbox, (i) => `
      <div class="dash-item"><span class="title" data-jump-inbox="1">${esc(i.text)}</span></div>`)}
    ${section('⚡ リスク', risks, (r) => `
      <div class="dash-item">
        <span class="title" data-jump-risk="1">${esc(r.title)}</span>
        <span class="proj-tag">${esc(projectName(r.projectId))}</span>
      </div>`)}
    ${total === 0 ? '<div class="card empty">該当する項目はありません</div>' : ''}`;

  el.querySelectorAll('[data-jump-task]').forEach((s) => s.addEventListener('click', () => {
    state.selectedTaskId = s.dataset.jumpTask;
    state.taskFilter = { ...state.taskFilter, status: 'all', text: '' };
    location.hash = '#/tasks';
  }));
  el.querySelectorAll('[data-jump-issue]').forEach((s) => s.addEventListener('click', () => {
    state.selectedIssueId = s.dataset.jumpIssue;
    state.issueTab = 'issues';
    location.hash = '#/issues';
  }));
  el.querySelectorAll('[data-jump-note]').forEach((s) => s.addEventListener('click', () => {
    state.homeProjectId = s.dataset.jumpNote;
    location.hash = '#/home';
  }));
  el.querySelectorAll('[data-jump-inbox]').forEach((s) => s.addEventListener('click', () => { location.hash = '#/inbox'; }));
  el.querySelectorAll('[data-jump-risk]').forEach((s) => s.addEventListener('click', () => {
    state.issueTab = 'risks';
    location.hash = '#/issues';
  }));
}

function section(title, items, rowFn) {
  if (!items.length) return '';
  return `<div class="card"><h3>${title}(${items.length})</h3>${items.slice(0, 50).map(rowFn).join('')}
    ${items.length > 50 ? `<div class="muted">…他${items.length - 50}件</div>` : ''}</div>`;
}

// 一致箇所の前後を切り出して表示する
function snippet(q, ...fields) {
  for (const f of fields) {
    const text = f || '';
    const idx = text.toLowerCase().indexOf(q);
    if (idx >= 0) {
      const start = Math.max(0, idx - 15);
      return (start > 0 ? '…' : '') + text.slice(start, idx + q.length + 25) +
        (idx + q.length + 25 < text.length ? '…' : '');
    }
  }
  return '';
}
