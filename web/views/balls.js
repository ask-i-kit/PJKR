// ボール画面(F4-8, F4-11): 相手ボール(返答待ち)/自分ボール(被依頼)/相手別ビュー
import {
  state, col, byId, projectName, contactName, fmtDate, todayStr,
  waitingTasks, askedTasks, waitingInfo, askedInfo, STATUS,
} from '../state.js';
import { waitingDialog, replyDialog, answerDialog, recordNudge } from '../dialogs.js';
import { patchEntity } from '../actions.js';
import { esc } from '../ui.js';

export function render(el) {
  const tab = state.ballTab;
  const theirs = waitingTasks();
  const mine = askedTasks();

  el.innerHTML = `
    <h2>ボール <span class="muted">今どちらがボールを持っているか</span></h2>
    <div class="proj-tabs">
      <button class="btn ${tab === 'theirs' ? 'active' : ''}" data-tab="theirs">🏐 相手ボール(返答待ち ${theirs.length})</button>
      <button class="btn ${tab === 'mine' ? 'active' : ''}" data-tab="mine">📩 自分ボール(被依頼 ${mine.length})</button>
      <button class="btn ${tab === 'contact' ? 'active' : ''}" data-tab="contact">👥 相手別</button>
    </div>
    ${tab === 'theirs' ? theirsHTML(theirs) : tab === 'mine' ? mineHTML(mine) : contactHTML(theirs, mine)}`;

  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      state.ballTab = b.dataset.tab;
      document.dispatchEvent(new Event('pjkr:render'));
    });
  });
  el.querySelector('#ballContact')?.addEventListener('change', (e) => {
    state.ballContactId = e.target.value;
    document.dispatchEvent(new Event('pjkr:render'));
  });
  bindActions(el);
}

function theirsHTML(list) {
  const sorted = list.slice().sort((a, b) => waitingInfo(b).elapsed - waitingInfo(a).elapsed);
  return `<table class="list">
    <thead><tr><th>件名</th><th style="width:110px">相手</th><th style="width:110px">案件</th>
      <th style="width:80px">待ち開始</th><th style="width:80px">経過</th>
      <th style="width:80px">回答希望</th><th style="width:60px">催促</th><th style="width:170px"></th></tr></thead>
    <tbody>${sorted.map((t) => {
      const wi = waitingInfo(t);
      return `<tr data-id="${t.id}" class="${wi.alert ? 'ball-alert' : ''}">
        <td><span class="task-title" data-jump="${t.id}">${esc(t.title)}</span></td>
        <td>${esc(contactName(t.contactId))}</td>
        <td><span class="proj-tag">${esc(projectName(t.projectId))}</span></td>
        <td>${fmtDate(wi.base)}</td>
        <td class="${wi.alert ? 'due-over' : ''}">${wi.elapsed}営業日</td>
        <td class="${t.replyHope && t.replyHope < todayStr() ? 'due-over' : ''}">${fmtDate(t.replyHope)}</td>
        <td class="muted">${(t.nudges || []).length ? t.nudges.length + '回' : ''}</td>
        <td>
          <button class="btn small" data-nudge="${t.id}">📣 催促した</button>
          <button class="btn small primary" data-reply="${t.id}">✉ 回答受領</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">返答待ちはありません。タスクを「返答待ち」にするとここに表示されます。</td></tr>'}
    </tbody></table>
    <div class="muted" style="margin-top:8px">赤い行 = 催促候補(${esc(String(alertRule()))}。設定で変更可)</div>`;
}

function mineHTML(list) {
  const sorted = list.slice().sort((a, b) => askedInfo(b).elapsed - askedInfo(a).elapsed);
  return `<table class="list">
    <thead><tr><th>件名</th><th style="width:110px">依頼元</th><th style="width:110px">案件</th>
      <th style="width:80px">発生日</th><th style="width:80px">経過</th>
      <th style="width:64px">期限</th><th style="width:80px">状態</th><th style="width:200px"></th></tr></thead>
    <tbody>${sorted.map((t) => {
      const ai = askedInfo(t);
      return `<tr data-id="${t.id}" class="${ai.alert ? 'ball-alert' : ''}">
        <td><span class="task-title" data-jump="${t.id}">${esc(t.title)}</span></td>
        <td>${esc(contactName(t.contactId))}</td>
        <td><span class="proj-tag">${esc(projectName(t.projectId))}</span></td>
        <td>${fmtDate(t.askedOn)}</td>
        <td class="${ai.alert ? 'due-over' : ''}">${ai.elapsed}営業日</td>
        <td class="${t.due && t.due < todayStr() ? 'due-over' : ''}">${fmtDate(t.due)}</td>
        <td><span class="status-chip status-${t.status}">${STATUS[t.status]}</span></td>
        <td>
          ${t.status !== 'hold' ? `<button class="btn small" data-hold="${t.id}">🕓 保留へ</button>` : ''}
          <button class="btn small" data-wait="${t.id}">🏐 確認中へ</button>
          <button class="btn small primary" data-answer="${t.id}">✔ 回答して完了</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">自分が回答を持っている項目はありません。</td></tr>'}
    </tbody></table>
    <div class="muted" style="margin-top:8px">赤い行 = 要回答(放置警告)。「確認中へ」= 回答のために誰かへ質問し返答待ちにする</div>`;
}

// 相手別ビュー(F4-8): 打合せ・電話前の確認用
function contactHTML(theirs, mine) {
  const contacts = col('contacts');
  if (!contacts.length) return '<div class="card empty">相手が未登録です(設定画面から登録できます)</div>';
  const cid = state.ballContactId || contacts[0].id;
  const c = byId('contacts', cid);
  const waitList = theirs.filter((t) => t.contactId === cid);
  const askList = mine.filter((t) => t.contactId === cid);
  return `
    <div class="toolbar">
      <select id="ballContact">${contacts.map((x) =>
        `<option value="${x.id}" ${x.id === cid ? 'selected' : ''}>${esc(x.name)}(${esc(x.org)})</option>`).join('')}</select>
      <span class="muted">${esc(c?.memo || '')}</span>
    </div>
    <div class="card">
      <h3>🏐 ${esc(c?.name || '')}に待っているもの(${waitList.length})</h3>
      ${waitList.map((t) => {
        const wi = waitingInfo(t);
        return `<div class="dash-item ${wi.alert ? 'ball-alert' : ''}">
          <span class="title" data-jump="${t.id}">${esc(t.title)}</span>
          <span class="proj-tag">${esc(projectName(t.projectId))}</span>
          <span class="${wi.alert ? 'due-over' : 'muted'}">${wi.elapsed}営業日</span>
          <button class="btn small" data-nudge="${t.id}">📣 催促した</button>
          <button class="btn small primary" data-reply="${t.id}">✉ 回答受領</button>
        </div>`;
      }).join('') || '<div class="empty">なし</div>'}
    </div>
    <div class="card">
      <h3>📩 ${esc(c?.name || '')}を待たせているもの(${askList.length})</h3>
      ${askList.map((t) => {
        const ai = askedInfo(t);
        return `<div class="dash-item ${ai.alert ? 'ball-alert' : ''}">
          <span class="title" data-jump="${t.id}">${esc(t.title)}</span>
          <span class="proj-tag">${esc(projectName(t.projectId))}</span>
          <span class="${ai.alert ? 'due-over' : 'muted'}">${ai.elapsed}営業日</span>
          <button class="btn small primary" data-answer="${t.id}">✔ 回答して完了</button>
        </div>`;
      }).join('') || '<div class="empty">なし</div>'}
    </div>`;
}

function alertRule() {
  return '待ち開始または最終催促から規定営業日経過、もしくは回答希望日超過';
}

function bindActions(el) {
  const task = (id) => byId('tasks', id);
  el.querySelectorAll('[data-jump]').forEach((s) => s.addEventListener('click', () => {
    state.selectedTaskId = s.dataset.jump;
    state.taskFilter.status = 'all';
    location.hash = '#/tasks';
  }));
  el.querySelectorAll('[data-nudge]').forEach((b) => b.addEventListener('click', () => recordNudge(task(b.dataset.nudge))));
  el.querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => replyDialog(task(b.dataset.reply))));
  el.querySelectorAll('[data-answer]').forEach((b) => b.addEventListener('click', () => answerDialog(task(b.dataset.answer))));
  el.querySelectorAll('[data-wait]').forEach((b) => b.addEventListener('click', () => waitingDialog(task(b.dataset.wait))));
  el.querySelectorAll('[data-hold]').forEach((b) => b.addEventListener('click', () =>
    patchEntity('tasks', b.dataset.hold, { status: 'hold' }, '判断保留へ')));
}
