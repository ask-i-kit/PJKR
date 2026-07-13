// ダッシュボード: 「今日」セクション(F7-1〜3。催促候補・要回答を含む)+期限間近+Inbox+案件サマリ
import {
  state, col, visibleTasks, projects, projectName, contactName, todayStr, addDays, fmtDate, dueKind,
  waitingTasks, askedTasks, waitingInfo, askedInfo, byId,
} from '../state.js';
import { patchEntity } from '../actions.js';
import { recordNudge, replyDialog, answerDialog } from '../dialogs.js';
import { esc, openModal, closeModal } from '../ui.js';

export function render(el) {
  const today = todayStr();
  const tasks = visibleTasks().filter((t) => t.status !== 'done');
  const over = tasks.filter((t) => t.due && t.due < today && t.status !== 'waiting');
  const dueToday = tasks.filter((t) => t.due === today && t.status !== 'waiting');
  const nudges = waitingTasks().map((t) => [t, waitingInfo(t)]).filter(([, i]) => i.alert); // 催促候補(F4-2)
  const answers = askedTasks().map((t) => [t, askedInfo(t)]).filter(([, i]) => i.alert);    // 要回答(F4-5, F13-4)
  const autoIds = new Set([...over, ...dueToday, ...nudges.map(([t]) => t), ...answers.map(([t]) => t)].map((t) => t.id));
  const picks = tasks.filter((t) => t.todayOn === today && !autoIds.has(t.id));
  const leftovers = tasks.filter((t) => t.todayOn && t.todayOn < today);
  const soon = tasks.filter((t) => t.due && t.due > today && t.due <= addDays(today, 3) && t.status !== 'waiting');
  const remain = over.length + dueToday.length + picks.length + nudges.length + answers.length;
  const inboxItems = col('inbox');
  const nextMs = col('milestones')  // 直近マイルストーン(F7-8)
    .filter((m) => (!state.projectId || m.projectId === state.projectId) && m.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const d = new Date();
  const youbi = '日月火水木金土'[d.getDay()];

  el.innerHTML = `
    <h2>ダッシュボード</h2>
    <div class="card today-card">
      <h3>今日 (${d.getMonth() + 1}/${d.getDate()} ${youbi}) — 残り ${remain}件</h3>
      ${section('⚠ 期限切れ', 'over', over, (t) => overdueLabel(t, today))}
      ${section('● 今日期限', 'due', dueToday)}
      ${nudges.length ? `
        <div class="dash-section-title over">📣 催促候補(返答待ち)</div>
        ${nudges.map(([t, i]) => `
          <div class="dash-item ball-alert">
            <span class="title" data-id="${t.id}">${esc(t.title)}</span>
            <span class="muted">→ ${esc(contactName(t.contactId))}</span>
            <span class="proj-tag">${esc(projectName(t.projectId))}</span>
            <span class="due-over">${i.elapsed}営業日</span>
            <button class="btn small" data-act="nudge" data-id="${t.id}">📣 催促した</button>
            <button class="btn small" data-act="reply" data-id="${t.id}">✉ 回答受領</button>
          </div>`).join('')}` : ''}
      ${answers.length ? `
        <div class="dash-section-title over">📩 要回答(自分ボール)</div>
        ${answers.map(([t, i]) => `
          <div class="dash-item ball-alert">
            <span class="title" data-id="${t.id}">${esc(t.title)}</span>
            <span class="muted">← ${esc(contactName(t.contactId))}${t.status === 'hold' ? '(判断保留)' : ''}</span>
            <span class="proj-tag">${esc(projectName(t.projectId))}</span>
            <span class="due-over">${i.elapsed}営業日</span>
            <button class="btn small" data-act="answer" data-id="${t.id}">✔ 回答して完了</button>
          </div>`).join('')}` : ''}
      <div class="dash-section-title">○ 今日やる(手動ピック)
        <button class="btn small" id="pickBtn">＋タスクから選ぶ</button></div>
      ${picks.length ? picks.map((t) => row(t, `<button class="btn small" data-act="unpick" data-id="${t.id}">外す</button>`)).join('') : '<div class="empty">手動ピックはありません</div>'}
      ${leftovers.length ? `
        <div class="dash-section-title">▣ 昨日の残り</div>
        ${leftovers.map((t) => row(t, `
          <button class="btn small" data-act="repick" data-id="${t.id}">今日もやる</button>
          <button class="btn small" data-act="unpick" data-id="${t.id}">外す</button>`)).join('')}` : ''}
    </div>

    <div class="card">
      <h3>期限間近(3日以内)</h3>
      ${soon.length ? soon.sort((a, b) => a.due.localeCompare(b.due)).map((t) => row(t)).join('') : '<div class="empty">ありません</div>'}
    </div>

    ${nextMs.length ? `
    <div class="card">
      <h3>🚩 直近のマイルストーン <a href="#/gantt" class="btn small">ガントで見る</a></h3>
      ${nextMs.map((m) => {
        const days = Math.round((new Date(m.date) - new Date(today)) / 86400000);
        return `<div class="dash-item">
          <span class="ms-diamond"></span>
          <span class="title" style="cursor:default;text-decoration:none">${esc(m.name)}</span>
          <span class="proj-tag">${esc(projectName(m.projectId))}</span>
          <span class="${days <= 3 ? 'due-soon' : 'muted'}">${fmtDate(m.date)}(${days === 0 ? '今日' : `あと${days}日`})</span>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="card">
      <h3>Inbox(未整理 ${inboxItems.length}件) <a href="#/inbox" class="btn small">整理する</a></h3>
      ${inboxItems.slice(0, 5).map((i) => `<div class="dash-item"><span class="title">${esc(i.text)}</span></div>`).join('')
        || '<div class="empty">未整理の書き留めはありません</div>'}
    </div>

    <div class="card">
      <h3>案件サマリ</h3>
      ${summary()}
    </div>`;

  el.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      if (b.dataset.act === 'done') await patchEntity('tasks', id, { status: 'done', doneAt: new Date().toISOString() }, 'タスク完了');
      if (b.dataset.act === 'unpick') await patchEntity('tasks', id, { todayOn: null }, '今日やるを解除');
      if (b.dataset.act === 'repick') await patchEntity('tasks', id, { todayOn: todayStr() }, '今日やるに再追加');
      if (b.dataset.act === 'nudge') await recordNudge(byId('tasks', id));
      if (b.dataset.act === 'reply') replyDialog(byId('tasks', id));
      if (b.dataset.act === 'answer') answerDialog(byId('tasks', id));
    });
  });
  el.querySelectorAll('.title[data-id]').forEach((s) => {
    s.addEventListener('click', () => {
      state.selectedTaskId = s.dataset.id;
      location.hash = '#/tasks';
    });
  });
  el.querySelector('#pickBtn').addEventListener('click', () => pickDialog(autoIds));
}

function overdueLabel(t, today) {
  const days = Math.round((new Date(today) - new Date(t.due)) / 86400000);
  return `期限${fmtDate(t.due)} (${days}日超過)`;
}

function section(title, cls, items, dueLabel) {
  if (!items.length) return '';
  return `<div class="dash-section-title ${cls}">${title}</div>` +
    items.map((t) => row(t, '', dueLabel)).join('');
}

function row(t, extra = '', dueLabel) {
  const kind = dueKind(t);
  const due = t.due ? `<span class="due-${kind || 'none'}">${dueLabel ? dueLabel(t) : '期限' + fmtDate(t.due)}</span>` : '';
  return `<div class="dash-item">
    <input type="checkbox" data-act="done" data-id="${t.id}" title="完了にする">
    <span class="title" data-id="${t.id}">${esc(t.title)}</span>
    <span class="proj-tag">${esc(projectName(t.projectId))}</span>
    ${due} ${extra}</div>`;
}

function summary() {
  const ps = projects().filter((p) => !state.projectId || p.id === state.projectId);
  if (!ps.length) return '<div class="empty">案件がありません。<a href="#/home">案件ホーム</a>から登録してください。</div>';
  return `<div class="summary-grid">` + ps.map((p) => {
    const ts = col('tasks').filter((t) => t.projectId === p.id);
    const done = ts.filter((t) => t.status === 'done').length;
    const overCnt = ts.filter((t) => dueKind(t) === 'over').length;
    const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
    return `<div class="summary-item">
      <div><b>${esc(p.name)}</b></div>
      <div class="muted">タスク ${done}/${ts.length} 完了 ${overCnt ? `・<span class="due-over">期限切れ${overCnt}件</span>` : ''}</div>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join('') + '</div>';
}

// 「＋タスクから選ぶ」ダイアログ(F3-10)
function pickDialog(autoIds) {
  const today = todayStr();
  const cands = visibleTasks()
    .filter((t) => t.status !== 'done' && t.todayOn !== today && !autoIds.has(t.id))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const modal = openModal(`
    <h3>今日やるタスクを選ぶ</h3>
    ${cands.length ? cands.map((t) => `
      <div class="dash-item">
        <span class="title">${esc(t.title)}</span>
        <span class="proj-tag">${esc(projectName(t.projectId))}</span>
        ${t.due ? `<span class="muted">期限${fmtDate(t.due)}</span>` : ''}
        <button class="btn small" data-pick="${t.id}">追加</button>
      </div>`).join('') : '<div class="empty">追加できるタスクがありません</div>'}
    <div class="modal-actions"><button class="btn" id="pickClose">閉じる</button></div>`);
  modal.querySelectorAll('[data-pick]').forEach((b) => {
    b.addEventListener('click', async () => {
      closeModal();
      await patchEntity('tasks', b.dataset.pick, { todayOn: today }, '今日やるに追加');
    });
  });
  modal.querySelector('#pickClose').addEventListener('click', closeModal);
}
