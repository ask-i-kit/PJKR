// 判断保留箱(F13): すぐ答えられない問い合わせを預かり、確認事項を整理する
import {
  state, col, byId, projects, projectName, contactName, fmtDate, todayStr,
  heldTasks, askedInfo,
} from '../state.js';
import { createEntity, patchEntity } from '../actions.js';
import { waitingDialog, answerDialog } from '../dialogs.js';
import { esc, toast } from '../ui.js';

export function render(el) {
  const list = heldTasks().slice().sort((a, b) => askedInfo(b).elapsed - askedInfo(a).elapsed);

  el.innerHTML = `
    <h2>判断保留箱 <span class="muted">すぐ答えられない問い合わせの置き場(${list.length}件)</span></h2>
    <div class="card">
      <h3>＋ 直接登録</h3>
      <div class="add-form">
        <input type="text" id="hTitle" placeholder="問い合わせ内容" style="flex:2;min-width:200px">
        <select id="hContact">
          <option value="">誰から?</option>
          ${col('contacts').map((c) => `<option value="${c.id}">${esc(c.name)}(${esc(c.org)})</option>`).join('')}
        </select>
        <select id="hProject">
          <option value="">案件</option>
          ${projects().map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <input type="date" id="hDue" title="回答期限">
        <button class="btn small primary" id="hAdd">保留箱へ</button>
      </div>
    </div>
    ${list.map(itemHTML).join('') ||
      '<div class="card empty">判断保留はありません。Inboxやボール画面(自分ボール)からも送れます。</div>'}`;

  el.querySelector('#hAdd').addEventListener('click', async () => {
    const title = el.querySelector('#hTitle').value.trim();
    if (!title) { toast('内容を入力してください', true); return; }
    if (!projects().length) { toast('先に案件を登録してください', true); return; }
    await createEntity('tasks', {
      parentId: null, title, detail: '', start: null,
      due: el.querySelector('#hDue').value || null,
      priority: 'mid', status: 'hold', progress: 0, assignee: null,
      contactId: el.querySelector('#hContact').value || null,
      waitSince: null, replyHope: null, nudges: [],
      isAsked: true, askedOn: todayStr(), answer: '', checkMemo: '',
      todayOn: null, links: [], logs: [], doneAt: null,
      projectId: el.querySelector('#hProject').value || projects()[0].id,
    }, '判断保留を登録');
  });

  el.querySelectorAll('[data-memo]').forEach((ta) => {
    ta.addEventListener('change', async () => {
      await patchEntity('tasks', ta.dataset.memo, { checkMemo: ta.value }, '確認メモ更新');
    });
  });
  el.querySelectorAll('[data-jump]').forEach((s) => s.addEventListener('click', () => {
    state.selectedTaskId = s.dataset.jump;
    state.taskFilter.status = 'all';
    location.hash = '#/tasks';
  }));
  el.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      const t = byId('tasks', b.dataset.id);
      switch (b.dataset.act) {
        case 'resume': await patchEntity('tasks', t.id, { status: 'todo' }, '保留を再開'); break;
        case 'wait': waitingDialog(t); break;
        case 'answer': answerDialog(t); break;
      }
    });
  });
}

function itemHTML(t) {
  const ai = askedInfo(t);
  const dueOver = t.due && t.due < todayStr();
  return `<div class="card ${ai.alert ? 'hold-alert' : ''}">
    <h3><span data-jump="${t.id}" class="task-title" style="cursor:pointer">${esc(t.title)}</span>
      <span class="proj-tag">${esc(projectName(t.projectId))}</span></h3>
    <div class="muted">
      ${t.contactId ? `誰から: <b>${esc(contactName(t.contactId))}</b> / ` : ''}
      受領: ${fmtDate(t.askedOn)} /
      <span class="${ai.alert ? 'due-over' : ''}">${ai.elapsed}営業日経過</span>
      ${t.due ? ` / 回答期限: <span class="${dueOver ? 'due-over' : ''}">${fmtDate(t.due)}</span>` : ''}
    </div>
    <label class="muted" style="display:block;margin-top:8px">何を確認すれば回答できるか</label>
    <textarea data-memo="${t.id}" style="width:100%;min-height:44px" placeholder="例: ◯◯の設計書の△△の仕様を確認する / □□さんに聞く">${esc(t.checkMemo || '')}</textarea>
    <div style="margin-top:8px">
      <button class="btn small" data-act="resume" data-id="${t.id}">▶ 再開(自分で調べる)</button>
      <button class="btn small" data-act="wait" data-id="${t.id}">🏐 返答待ちへ(誰かに質問)</button>
      <button class="btn small primary" data-act="answer" data-id="${t.id}">✔ 回答して完了</button>
    </div>
  </div>`;
}
