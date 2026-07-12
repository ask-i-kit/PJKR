// 変更系操作の共通層: API呼び出し → 状態再取得 → 再描画 → Undo登録(設計書§6.3)
import * as api from './api.js';
import { state, reload } from './state.js';
import { toast } from './ui.js';

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

async function refresh() {
  await reload();
  document.dispatchEvent(new Event('pjkr:render'));
}

export async function undo() {
  const e = undoStack.pop();
  if (!e) { toast('取り消す操作がありません'); return; }
  try {
    await e.undo();
    redoStack.push(e);
    await refresh();
    toast(`元に戻しました: ${e.label}`);
  } catch (err) {
    toast(`取り消しに失敗: ${err.message}`, true);
    await refresh();
  }
}

export async function redo() {
  const e = redoStack.pop();
  if (!e) { toast('やり直す操作がありません'); return; }
  try {
    await e.redo();
    undoStack.push(e);
    await refresh();
    toast(`やり直しました: ${e.label}`);
  } catch (err) {
    toast(`やり直しに失敗: ${err.message}`, true);
    await refresh();
  }
}

// ---- エンティティ操作 ----

export async function createEntity(entity, fields, label) {
  const item = await api.post(`/api/${entity}`, fields);
  pushUndo({
    label,
    undo: () => api.del(`/api/${entity}/${item.id}`),
    redo: () => api.post(`/api/${entity}`, item),
  });
  await refresh();
  return item;
}

export async function patchEntity(entity, id, fields, label) {
  const { before } = await api.patch(`/api/${entity}/${id}`, fields);
  pushUndo({
    label,
    undo: () => api.patch(`/api/${entity}/${id}`, before),
    redo: () => api.patch(`/api/${entity}/${id}`, fields),
  });
  await refresh();
}

export async function deleteEntity(entity, id, label) {
  const { removed } = await api.del(`/api/${entity}/${id}`);
  pushUndo({
    label,
    undo: async () => { // 親→子の順で返るため、その順で再作成すれば復元できる
      for (const item of removed) await api.post(`/api/${entity}`, item);
    },
    redo: () => api.del(`/api/${entity}/${id}`),
  });
  await refresh();
  return removed;
}

export async function convertInbox(id, to, fields, label) {
  const { created, inbox } = await api.post(`/api/inbox/${id}/convert`, { to, fields });
  pushUndo({
    label,
    undo: async () => {
      await api.del(`/api/${to}/${created.id}`);
      await api.post('/api/inbox', inbox);
    },
    redo: async () => {
      await api.post(`/api/${to}`, created);
      await api.del(`/api/inbox/${inbox.id}`);
    },
  });
  await refresh();
  return created;
}

// 一括登録(F3-8): 親タスク群+工程子タスクを作成し、1回のCtrl+Zでまとめて取り消せる
// childrenOf(parent) が各親の子タスクのフィールド配列を返す。
export async function bulkCreateTasks(parents, childrenOf, label) {
  const created = [];
  const parentIds = [];
  for (const pf of parents) {
    const p = await api.post('/api/tasks', pf);
    created.push(p);
    parentIds.push(p.id);
    for (const cf of childrenOf(p)) created.push(await api.post('/api/tasks', cf));
  }
  pushUndo({
    label,
    undo: async () => { // 親を消せば子はカスケード削除される
      for (const id of parentIds.slice().reverse()) await api.del(`/api/tasks/${id}`);
    },
    redo: async () => { // createdは親→その子の順なのでそのまま再作成できる
      for (const item of created) await api.post('/api/tasks', item);
    },
  });
  await refresh();
  return created;
}

// 作業ログは追記専用のためUndo対象外
export async function addLog(taskId, text) {
  await api.post(`/api/tasks/${taskId}/log`, { text });
  await refresh();
}

// 設定の更新(Undo対象外)
export async function updateSettings(fields) {
  await api.post('/api/settings', fields);
  await refresh();
}

// スタートアップ登録(F11-4)
export async function setStartup(enabled) {
  const res = await api.post('/api/startup', { enabled });
  await refresh();
  return res.enabled;
}

export async function notifyTest() {
  await api.post('/api/notify-test');
  toast('通知を送信しました(画面右下に表示されない場合はWindowsの通知設定を確認してください)');
}

// Excel一括インポート(F9-2)。取り込んだ分は1回のCtrl+Zでまとめて取り消せる
export async function importExcel(kind, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/import/${kind}`, { method: 'POST', body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  await reload();
  const created = json.created.map((id) => (state.data[kind] || []).find((x) => x.id === id)).filter(Boolean);
  if (created.length) {
    pushUndo({
      label: `Excel取込(${kind === 'tasks' ? 'タスク' : '課題'}${created.length}件)`,
      undo: async () => { for (const it of created.slice().reverse()) await api.del(`/api/${kind}/${it.id}`); },
      redo: async () => { for (const it of created) await api.post(`/api/${kind}`, it); },
    });
  }
  document.dispatchEvent(new Event('pjkr:render'));
  return json;
}

// JSONバックアップからの復元(F9-3)。Undo不可(復元前データは自動でbackup/に退避される)
export async function restoreJSON(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/restore', { method: 'POST', body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  undoStack.length = 0;
  redoStack.length = 0;
  await refresh();
}

// POSTの応答(Excel等)をファイルとしてダウンロードする
export async function downloadPost(url, body, filename) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || res.statusText);
  }
  const blobURL = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = blobURL;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobURL);
}

// リンク・ローカルパスを開く
export async function openTarget(target) {
  if (/^https?:\/\//i.test(target)) {
    window.open(target, '_blank');
    return;
  }
  try {
    await api.post('/api/open', { target });
  } catch (err) {
    toast(err.message, true);
  }
}

export async function backupNow() {
  await api.post('/api/backup');
  toast('バックアップを作成しました');
}
