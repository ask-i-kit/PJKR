// ボール管理まわりの共通ダイアログ(タスク/ボール/判断保留/ダッシュボードで共用)
import { col, todayStr } from './state.js';
import { patchEntity, createEntity, addLog } from './actions.js';
import { esc, toast, openModal, closeModal } from './ui.js';

function contactOptions(selected) {
  return col('contacts').map((c) =>
    `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}(${esc(c.org)})</option>`).join('');
}

// 返答待ちへの切替(F4-1): 相手(必須)・待ち開始日・回答希望日
export function waitingDialog(t) {
  if (!col('contacts').length) {
    newContactThen(() => waitingDialog(t), '返答待ちにするには相手の登録が必要です');
    return;
  }
  const modal = openModal(`
    <h3>返答待ちにする — ${esc(t.title)}</h3>
    <label>相手(ボールの所在) *</label>
    <select id="wContact"><option value="">選択してください</option>${contactOptions(t.contactId)}</select>
    <label>待ち開始日(依頼した日)</label>
    <input type="date" id="wSince" value="${t.waitSince || todayStr()}">
    <label>回答希望日(任意)</label>
    <input type="date" id="wHope" value="${t.replyHope || ''}">
    <div class="modal-actions">
      <button class="btn" id="wCancel">キャンセル</button>
      <button class="btn primary" id="wOk">返答待ちにする</button>
    </div>`);
  modal.querySelector('#wCancel').addEventListener('click', closeModal);
  modal.querySelector('#wOk').addEventListener('click', async () => {
    const contactId = modal.querySelector('#wContact').value;
    if (!contactId) { toast('相手を選択してください', true); return; }
    const fields = {
      status: 'waiting',
      contactId,
      waitSince: modal.querySelector('#wSince').value || todayStr(),
      replyHope: modal.querySelector('#wHope').value || null,
    };
    closeModal();
    await patchEntity('tasks', t.id, fields, '返答待ちに切替');
  });
}

// 回答受領(F4-10): 回答内容をログに残して状態を戻す
export function replyDialog(t, nextStatus = 'doing') {
  const modal = openModal(`
    <h3>回答受領 — ${esc(t.title)}</h3>
    <label>回答内容・経緯(作業ログに残ります。空欄可)</label>
    <textarea id="rText" style="min-height:80px"></textarea>
    <div class="modal-actions">
      <button class="btn" id="rCancel">キャンセル</button>
      <button class="btn primary" id="rOk">記録して${nextStatus === 'done' ? '完了' : '再開'}</button>
    </div>`);
  modal.querySelector('#rCancel').addEventListener('click', closeModal);
  modal.querySelector('#rOk').addEventListener('click', async () => {
    const text = modal.querySelector('#rText').value.trim();
    closeModal();
    if (text) await addLog(t.id, '【回答】' + text);
    const fields = { status: nextStatus };
    if (nextStatus === 'done') fields.doneAt = new Date().toISOString();
    await patchEntity('tasks', t.id, fields, '回答受領');
  });
}

// 被依頼タスクの完了(F14-1): 回答概要の記録を促す(スキップ可)
export function answerDialog(t) {
  const modal = openModal(`
    <h3>回答して完了 — ${esc(t.title)}</h3>
    <label>回答概要(1〜3行。回答管理から検索できるようになります)</label>
    <textarea id="aText" style="min-height:70px">${esc(t.answer || '')}</textarea>
    <div class="modal-actions">
      <button class="btn" id="aCancel">キャンセル</button>
      <button class="btn" id="aSkip">記録せず完了</button>
      <button class="btn primary" id="aOk">記録して完了</button>
    </div>`);
  const done = async (answer) => {
    closeModal();
    await patchEntity('tasks', t.id, {
      status: 'done', doneAt: new Date().toISOString(), answer,
    }, '回答して完了');
  };
  modal.querySelector('#aCancel').addEventListener('click', closeModal);
  modal.querySelector('#aSkip').addEventListener('click', () => done(t.answer || ''));
  modal.querySelector('#aOk').addEventListener('click', () =>
    done(modal.querySelector('#aText').value.trim()));
}

// 催促の記録(F4-4)
export async function recordNudge(t) {
  await patchEntity('tasks', t.id, { nudges: [...(t.nudges || []), todayStr()] }, '催促を記録');
  toast('催促を記録しました(経過日数がリセットされます)');
}

// 相手が未登録のときの補助
function newContactThen(after, message) {
  const modal = openModal(`
    <h3>相手を追加</h3>
    ${message ? `<div class="muted">${esc(message)}</div>` : ''}
    <label>名前 *</label><input type="text" id="ncName">
    <label>所属(ベンダー名/部署名)</label><input type="text" id="ncOrg">
    <div class="modal-actions">
      <button class="btn" id="ncCancel">キャンセル</button>
      <button class="btn primary" id="ncOk">追加</button>
    </div>`);
  modal.querySelector('#ncCancel').addEventListener('click', closeModal);
  modal.querySelector('#ncOk').addEventListener('click', async () => {
    const name = modal.querySelector('#ncName').value.trim();
    if (!name) return;
    const org = modal.querySelector('#ncOrg').value.trim();
    closeModal();
    await createEntity('contacts', { name, org, memo: '' }, '相手マスタ追加');
    after();
  });
}
