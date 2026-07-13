import * as api from './api.js';

// クライアント状態。data はサーバの pjkr.json 全体(サーバが正)。
export const state = {
  data: null,
  meta: null,
  projectId: '',        // ヘッダーの案件フィルタ('' = 全案件)
  search: '',           // Ctrl+F の絞り込みテキスト
  selectedTaskId: null, // タスク画面の詳細パネル対象
  homeProjectId: '',    // 案件ホームで選択中の案件
  taskFilter: { status: 'open', assignee: '', text: '', group: '' },
  ballTab: 'theirs',     // ボール画面のタブ(theirs/mine/contact)
  ballContactId: '',     // 相手別ビューで選択中の相手
  selectedIssueId: null, // 課題画面の詳細パネル対象
  issueTab: 'issues',    // issues/risks
};

// サーバから全データを取得し直す(全変更操作の後に呼ぶ。設計書§6.1)
export async function reload() {
  const res = await api.get('/api/state');
  state.data = res.data;
  state.meta = res.meta;
}

export const col = (key) => state.data?.[key] ?? [];
export const byId = (key, id) => col(key).find((x) => x.id === id);

// 表示順(order)の昇順。未設定は末尾(作成順を維持。sortは安定ソート)
export const projects = () => col('projects').filter((p) => !p.archived)
  .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
export const projectName = (id) => byId('projects', id)?.name ?? '(案件なし)';
export const contactName = (id) => (id ? (byId('contacts', id)?.name ?? '?') : '自分');

// 表示対象のタスク(ヘッダーの案件フィルタを適用)
export function visibleTasks() {
  const archived = new Set(col('projects').filter((p) => p.archived).map((p) => p.id));
  return col('tasks').filter((t) => {
    if (state.projectId && t.projectId !== state.projectId) return false;
    if (!state.projectId && archived.has(t.projectId)) return false;
    return true;
  });
}

// ---- 日付ユーティリティ ----
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fmtDate(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${Number(m)}/${Number(d)}`;
}
export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// 期限の状態: 'over' | 'today' | 'soon'(3日以内) | ''
export function dueKind(t) {
  if (!t.due || t.status === 'done') return '';
  const today = todayStr();
  if (t.due < today) return 'over';
  if (t.due === today) return 'today';
  if (t.due <= addDays(today, 3)) return 'soon';
  return '';
}

export const STATUS = {
  todo: '未着手', doing: '進行中', waiting: '返答待ち', done: '完了', hold: '保留',
};
export const PRIORITY = { high: '高', mid: '中', low: '低' };
export const ISTATUS = { open: '未対応', doing: '対応中', done: '完了', hold: '保留' };
export const RSTATUS = { open: '対応中', done: 'クローズ' };
export const LEVEL = { high: '高', mid: '中', low: '低' };

// ---- 営業日計算(要件N14。サーバ側 busday と同じ定義) ----

function holidaySet() {
  const set = new Set(state.meta?.holidays ?? []);
  for (const d of state.data?.settings?.customHolidays ?? []) set.add(d);
  return set;
}

export function isBusinessDay(dateStr, holidays = holidaySet()) {
  const d = new Date(dateStr + 'T00:00:00');
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(dateStr);
}

// fromISO の翌日から今日までの営業日数(金曜依頼→月曜=1営業日)
export function bizDaysSince(fromISO) {
  if (!fromISO) return 0;
  const holidays = holidaySet();
  const today = todayStr();
  let n = 0;
  for (let d = addDays(fromISO, 1); d <= today; d = addDays(d, 1)) {
    if (isBusinessDay(d, holidays)) n++;
  }
  return n;
}

export function settingNum(key, def) {
  const v = Number(state.data?.settings?.[key]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

// ---- ボール管理の判定(F4) ----

// 返答待ちタスク: 待ち開始/最終催促からの経過営業日と催促候補判定
export function waitingInfo(t) {
  let base = t.waitSince || '';
  for (const n of t.nudges || []) if (n > base) base = n;
  const elapsed = bizDaysSince(base);
  const hopeOver = t.replyHope && t.replyHope < todayStr();
  return { base, elapsed, alert: hopeOver || elapsed >= settingNum('waitAlertBizDays', 5) };
}

// 被依頼タスク(自分ボール): 発生日からの経過営業日と要回答判定。判断保留は別の日数設定を使う
export function askedInfo(t) {
  const elapsed = bizDaysSince(t.askedOn);
  const limit = t.status === 'hold' ? settingNum('holdAlertBizDays', 5) : settingNum('askedAlertBizDays', 3);
  const dueOver = t.due && t.due < todayStr();
  return { elapsed, alert: dueOver || elapsed >= limit };
}

// 表示対象タスクのボール抽出
export function waitingTasks() {
  return visibleTasks().filter((t) => t.status === 'waiting');
}
export function askedTasks() { // 自分ボール(未完了の被依頼。返答待ち中のものは相手ボール扱い)
  return visibleTasks().filter((t) => t.isAsked && t.status !== 'done' && t.status !== 'waiting');
}
export function heldTasks() { // 判断保留箱(F13)
  return visibleTasks().filter((t) => t.isAsked && t.status === 'hold');
}
export function answeredTasks() { // 回答管理(F14)
  return col('tasks').filter((t) => t.isAsked && t.status === 'done');
}
