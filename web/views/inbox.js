// Inbox: 未整理メモの一覧と変換(F2)
import { col, projects, fmtDateTime, todayStr, state } from '../state.js';
import { convertInbox, deleteEntity } from '../actions.js';
import { esc, toast } from '../ui.js';

let openFormId = null; // 変換フォームを開いている項目
let openFormMode = 'tasks';

export function render(el) {
  const items = col('inbox');
  el.innerHTML = `
    <h2>Inbox <span class="muted">未整理 ${items.length}件 — Ctrl+I でどこからでも書き留められます</span></h2>
    ${items.map(itemHTML).join('') || '<div class="card empty">未整理の書き留めはありません 🎉</div>'}`;

  el.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', () => onAction(b.dataset.act, b.dataset.id));
  });
  bindForms(el);
}

function itemHTML(i) {
  return `<div class="inbox-item">
    <div class="text">${esc(i.text)}</div>
    <div class="meta">${fmtDateTime(i.createdAt)}</div>
    <div>
      <button class="btn small" data-act="task" data-id="${i.id}">→ タスク化</button>
      <button class="btn small" data-act="hold" data-id="${i.id}">→ 判断保留</button>
      <button class="btn small" data-act="note" data-id="${i.id}">→ 案件メモ化</button>
      <button class="btn small danger" data-act="del" data-id="${i.id}">破棄</button>
    </div>
    ${openFormId === i.id ? formHTML(i) : ''}
  </div>`;
}

function formHTML(i) {
  const projOpts = projects().map((p) =>
    `<option value="${p.id}" ${p.id === state.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  if (openFormMode === 'tasks') {
    return `<div class="convert-form" data-form="${i.id}">
      <input type="text" id="cvTitle" value="${esc(i.text)}" style="flex:1;min-width:180px">
      <select id="cvProject">${projOpts}</select>
      <input type="date" id="cvDue" title="期限">
      <button class="btn small primary" id="cvOk">タスクとして登録</button>
    </div>`;
  }
  if (openFormMode === 'hold') {
    return `<div class="convert-form" data-form="${i.id}">
      <input type="text" id="cvTitle" value="${esc(i.text)}" style="flex:1;min-width:160px">
      <select id="cvContact">
        <option value="">誰から?</option>
        ${col('contacts').map((c) => `<option value="${c.id}">${esc(c.name)}(${esc(c.org)})</option>`).join('')}
      </select>
      <select id="cvProject">${projOpts}</select>
      <input type="date" id="cvDue" title="回答期限">
      <button class="btn small primary" id="cvOk">判断保留箱へ</button>
    </div>`;
  }
  return `<div class="convert-form" data-form="${i.id}">
    <input type="text" id="cvTitle" placeholder="メモのタイトル(任意)" style="flex:1;min-width:150px">
    <select id="cvProject">${projOpts}</select>
    <button class="btn small primary" id="cvOk">案件メモとして登録</button>
  </div>`;
}

async function onAction(act, id) {
  if (act === 'del') {
    await deleteEntity('inbox', id, '書き留めの破棄');
    toast('破棄しました(Ctrl+Zで戻せます)');
    return;
  }
  if (!projects().length) {
    toast('先に案件ホームから案件を登録してください', true);
    return;
  }
  const mode = { task: 'tasks', note: 'notes', hold: 'hold' }[act];
  if (openFormId === id && openFormMode === mode) openFormId = null;
  else { openFormId = id; openFormMode = mode; }
  document.dispatchEvent(new Event('pjkr:render'));
}

function bindForms(el) {
  const form = el.querySelector('[data-form]');
  if (!form) return;
  const id = form.dataset.form;
  form.querySelector('#cvOk').addEventListener('click', async () => {
    const projectId = form.querySelector('#cvProject').value;
    const title = form.querySelector('#cvTitle').value.trim();
    const item = col('inbox').find((x) => x.id === id);
    openFormId = null;
    if (openFormMode === 'tasks' || openFormMode === 'hold') {
      const isHold = openFormMode === 'hold';
      await convertInbox(id, 'tasks', {
        projectId, title: title || item.text, detail: '',
        parentId: null, start: null, due: form.querySelector('#cvDue').value || null,
        priority: 'mid', status: isHold ? 'hold' : 'todo', progress: 0, assignee: null,
        contactId: isHold ? (form.querySelector('#cvContact').value || null) : null,
        waitSince: null, replyHope: null, nudges: [],
        isAsked: isHold, askedOn: isHold ? todayStr() : null,
        answer: '', checkMemo: '', todayOn: null, links: [], logs: [], doneAt: null,
      }, isHold ? 'Inboxを判断保留化' : 'Inboxをタスク化');
      toast(isHold ? '判断保留箱に入れました' : 'タスクにしました');
    } else {
      await convertInbox(id, 'notes', {
        projectId, title, body: item.text, pinned: false, links: [],
      }, 'Inboxをメモ化');
      toast('案件メモにしました');
    }
  });
}
