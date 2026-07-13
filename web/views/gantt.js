// ガントチャート(F5): タスク期間バー・マイルストーン◆・週/月/四半期切替・当日線・ドラッグ日程変更
import {
  state, col, projects, byId, projectName,
  todayStr, addDays, fmtDate, isBusinessDay, STATUS,
} from '../state.js';
import { createEntity, patchEntity, deleteEntity } from '../actions.js';
import { esc, toast, openModal, closeModal } from '../ui.js';

// [key, 表示名, 表示日数, 1日の幅px, ◀▶の移動日数]
const MODES = [
  ['week', '週', 14, 44, 7],
  ['month', '月', 42, 24, 14],
  ['quarter', '四半期', 91, 11, 28],
];
const LABEL_W = 190;

let mode = 'month';
let anchor = null; // 表示開始日(月曜)

const modeDef = () => MODES.find((m) => m[0] === mode);

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return addDays(dateStr, -((d.getDay() + 6) % 7));
}
const defaultAnchor = () => addDays(mondayOf(todayStr()), -7);

export function render(el) {
  if (!anchor) anchor = defaultAnchor();
  const [, , days, dayW, step] = modeDef();
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(addDays(anchor, i));
  const rangeEnd = dates[days - 1];
  const dayIdx = (d) =>
    Math.round((new Date(d + 'T00:00:00') - new Date(anchor + 'T00:00:00')) / 86400000);

  const ps = projects().filter((p) => !state.projectId || p.id === state.projectId);
  const { rows, noDateCount } = buildRows(ps, anchor, rangeEnd);
  const allMs = col('milestones')
    .filter((m) => ps.some((p) => p.id === m.projectId))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  el.innerHTML = `
    <h2>ガントチャート</h2>
    <div class="toolbar">
      ${MODES.map(([k, label]) =>
        `<button class="btn ${k === mode ? 'active' : ''}" data-mode="${k}">${label}</button>`).join('')}
      <span style="width:10px"></span>
      <button class="btn" id="gPrev">◀</button>
      <button class="btn" id="gToday">今日</button>
      <button class="btn" id="gNext">▶</button>
      <span style="flex:1"></span>
      <button class="btn primary" id="addMs">🚩 ＋マイルストーン</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${rows.length ? ganttHTML(rows, dates, dayW, dayIdx) :
        '<div class="empty" style="padding:20px">表示できるタスク・マイルストーンがありません。タスクに開始日または期限を設定すると表示されます。</div>'}
    </div>
    <div class="muted" style="margin:-6px 0 12px">
      バーのドラッグで日程を移動、両端のドラッグで期間を変更できます(Ctrl+Zで取消可)。クリックでタスク詳細を開きます。
      ${noDateCount ? `日付未設定のため非表示のタスクが${noDateCount}件あります。` : ''}
    </div>
    <div class="card">
      <h3>🚩 マイルストーン一覧</h3>
      ${allMs.map((m) => `
        <div class="dash-item">
          <span class="ms-diamond"></span>
          <span class="title" data-ms="${m.id}">${esc(m.name)}</span>
          <span class="proj-tag">${esc(projectName(m.projectId))}</span>
          <span class="muted ${m.date < todayStr() ? 'done-task' : ''}">${fmtDate(m.date)}</span>
          ${m.memo ? `<span class="muted">${esc(m.memo)}</span>` : ''}
        </div>`).join('') || '<div class="empty">マイルストーンがありません(リリース日・レビュー日などを登録できます)</div>'}
    </div>`;

  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    rerender();
  }));
  el.querySelector('#gPrev').addEventListener('click', () => { anchor = addDays(anchor, -step); rerender(); });
  el.querySelector('#gNext').addEventListener('click', () => { anchor = addDays(anchor, step); rerender(); });
  el.querySelector('#gToday').addEventListener('click', () => { anchor = defaultAnchor(); rerender(); });
  el.querySelector('#addMs').addEventListener('click', () => msDialog(null));
  el.querySelectorAll('[data-ms]').forEach((s) =>
    s.addEventListener('click', () => msDialog(byId('milestones', s.dataset.ms))));
  bindBars(el, dayW);

  // 初回は今日が見える位置へスクロール
  const sc = el.querySelector('.gantt-scroll');
  if (sc) {
    const ti = dayIdx(todayStr());
    if (ti >= 0 && ti < days) sc.scrollLeft = Math.max(0, ti * dayW - (sc.clientWidth - LABEL_W) / 3);
  }
}

const rerender = () => document.dispatchEvent(new Event('pjkr:render'));

// ---- 行データの組み立て ----
// 案件ごとに: 案件行(期間バー+マイルストーン◆) + 期間が範囲と重なるタスク行
function buildRows(ps, rangeStart, rangeEnd) {
  const rows = [];
  let noDateCount = 0;
  for (const p of ps) {
    const tasks = col('tasks').filter((t) => t.projectId === p.id);
    noDateCount += tasks.filter((t) => !t.start && !t.due && t.status !== 'done').length;
    const visible = tasks.filter((t) => {
      const s = t.start || t.due;
      if (!s) return false;
      const e = t.due || t.start;
      return e >= rangeStart && s <= rangeEnd;
    }).sort((a, b) => (a.start || a.due).localeCompare(b.start || b.due));
    const ms = col('milestones').filter((m) => m.projectId === p.id &&
      m.date >= rangeStart && m.date <= rangeEnd);
    const projInRange = p.start && p.end && p.end >= rangeStart && p.start <= rangeEnd;
    if (visible.length || ms.length || projInRange) {
      rows.push({ kind: 'proj', p, ms });
      for (const t of visible) rows.push({ kind: 'task', t });
    }
  }
  return { rows, noDateCount };
}

// ---- 描画 ----

function ganttHTML(rows, dates, dayW, dayIdx) {
  const days = dates.length;
  const trackW = days * dayW;
  const today = todayStr();

  // 月ヘッダー(同じ月をまとめる)
  const monthCells = [];
  for (const d of dates) {
    const label = `${Number(d.slice(5, 7))}月`;
    const last = monthCells.at(-1);
    if (last && last.label === label) last.count++;
    else monthCells.push({ label, year: d.slice(0, 4), count: 1 });
  }
  if (monthCells.length) monthCells[0].label = `${monthCells[0].year}年${monthCells[0].label}`;

  const dayCells = dates.map((d, i) => {
    const wd = new Date(d + 'T00:00:00').getDay();
    if (mode === 'quarter') { // 四半期は週の頭だけラベル
      return wd === 1 ? `<div class="gantt-day wk" style="left:${i * dayW}px;width:${7 * dayW}px">${fmtDate(d)}</div>` : '';
    }
    const label = mode === 'week' ? `${Number(d.slice(8))}(${'日月火水木金土'[wd]})` : Number(d.slice(8));
    return `<div class="gantt-day" style="left:${i * dayW}px;width:${dayW}px">${label}</div>`;
  }).join('');

  // 土日祝の背景帯と当日線(行エリア全体へのオーバーレイ)
  const bands = dates.map((d, i) =>
    !isBusinessDay(d) ? `<div class="gantt-band" style="left:${LABEL_W + i * dayW}px;width:${dayW}px"></div>` : '').join('');
  const ti = dayIdx(today);
  const todayLine = ti >= 0 && ti < days ?
    `<div class="gantt-today" style="left:${LABEL_W + ti * dayW + dayW / 2}px"></div>` : '';

  const body = rows.map((r) => r.kind === 'proj'
    ? projRowHTML(r, dayW, dayIdx, days, trackW)
    : taskRowHTML(r.t, dayW, dayIdx, days, trackW)).join('');

  return `
    <div class="gantt-scroll">
      <div class="gantt-inner" style="width:${LABEL_W + trackW}px">
        <div class="gantt-hrow">
          <div class="gantt-label"></div>
          <div class="gantt-track" style="width:${trackW}px">
            ${monthCells.reduce((acc, c) => {
              acc.html += `<div class="gantt-month" style="left:${acc.x}px;width:${c.count * dayW}px">${c.label}</div>`;
              acc.x += c.count * dayW;
              return acc;
            }, { html: '', x: 0 }).html}
          </div>
        </div>
        <div class="gantt-hrow days">
          <div class="gantt-label"></div>
          <div class="gantt-track" style="width:${trackW}px">${dayCells}</div>
        </div>
        <div class="gantt-rows">
          ${bands}${todayLine}
          ${body}
        </div>
      </div>
    </div>`;
}

// バーの表示範囲へのクランプ(範囲外は clip 表示)
function clamp(s, e, dayIdx, days, dayW) {
  const si = Math.max(0, dayIdx(s));
  const ei = Math.min(days - 1, dayIdx(e));
  return {
    left: si * dayW,
    width: (ei - si + 1) * dayW - 3,
    clipL: dayIdx(s) < 0, clipR: dayIdx(e) > days - 1,
  };
}

function projRowHTML({ p, ms }, dayW, dayIdx, days, trackW) {
  let bar = '';
  if (p.start && p.end && p.end >= addDays(anchor, 0) && dayIdx(p.start) < days) {
    const c = clamp(p.start, p.end, dayIdx, days, dayW);
    bar = `<div class="gantt-projbar" style="left:${c.left}px;width:${c.width}px"></div>`;
  }
  const diamonds = ms.map((m) => `
    <span class="gantt-ms" data-ms="${m.id}" style="left:${dayIdx(m.date) * dayW + dayW / 2}px"
      title="${esc(m.name)} (${fmtDate(m.date)})">
      <span class="ms-diamond"></span><span class="ms-name">${esc(m.name)}</span>
    </span>`).join('');
  return `<div class="gantt-row proj">
    <div class="gantt-label"><b>${esc(p.name)}</b></div>
    <div class="gantt-track" style="width:${trackW}px">${bar}${diamonds}</div>
  </div>`;
}

function taskRowHTML(t, dayW, dayIdx, days, trackW) {
  const s = t.start || t.due;
  const e = t.due || t.start;
  const c = clamp(s, e, dayIdx, days, dayW);
  const mark = t.status === 'waiting' ? ' 🏐' : (t.isAsked && t.status !== 'done' ? ' 📩' : '');
  return `<div class="gantt-row">
    <div class="gantt-label ${t.status === 'done' ? 'done-task' : ''}" title="${esc(t.title)}">${esc(t.title)}${mark}</div>
    <div class="gantt-track" style="width:${trackW}px">
      <div class="gantt-bar st-${t.status} ${c.clipL ? 'clip-l' : ''} ${c.clipR ? 'clip-r' : ''}"
        data-id="${t.id}" style="left:${c.left}px;width:${c.width}px"
        title="${esc(t.title)} (${fmtDate(s)}〜${fmtDate(e)} / ${STATUS[t.status]})">
        <span class="gh l"></span><span class="gh r"></span>
      </div>
    </div>
  </div>`;
}

// ---- ドラッグによる日程変更(F5-5)とクリックで詳細 ----

function bindBars(el, dayW) {
  el.querySelectorAll('.gantt-bar[data-id]').forEach((bar) => {
    bar.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const t = byId('tasks', bar.dataset.id);
      const rect = bar.getBoundingClientRect();
      const zone = ev.clientX - rect.left < 8 ? 'l' : (rect.right - ev.clientX < 8 ? 'r' : 'move');
      const x0 = ev.clientX;
      const left0 = parseFloat(bar.style.left);
      const width0 = parseFloat(bar.style.width);
      let dd = 0, moved = false;
      bar.setPointerCapture(ev.pointerId);
      bar.classList.add('dragging');

      const onMove = (e) => {
        if (Math.abs(e.clientX - x0) > 4) moved = true;
        dd = Math.round((e.clientX - x0) / dayW);
        if (zone === 'move') bar.style.left = `${left0 + dd * dayW}px`;
        else if (zone === 'l') {
          const w = Math.max(dayW - 3, width0 - dd * dayW);
          bar.style.left = `${left0 + (width0 - w)}px`;
          bar.style.width = `${w}px`;
        } else bar.style.width = `${Math.max(dayW - 3, width0 + dd * dayW)}px`;
      };
      const onUp = async () => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onUp);
        bar.classList.remove('dragging');
        if (!moved) { // クリック: タスク詳細へ
          state.selectedTaskId = t.id;
          location.hash = '#/tasks';
          return;
        }
        if (!dd) { rerender(); return; }
        const s = t.start || t.due;
        const e = t.due || t.start;
        const fields = {};
        if (zone === 'move') {
          if (t.start) fields.start = addDays(t.start, dd);
          if (t.due) fields.due = addDays(t.due, dd);
        } else if (zone === 'l') {
          fields.start = addDays(s, dd) > e ? e : addDays(s, dd);
        } else {
          fields.due = addDays(e, dd) < s ? s : addDays(e, dd);
        }
        await patchEntity('tasks', t.id, fields, 'ガントで日程変更');
      };
      bar.addEventListener('pointermove', onMove);
      bar.addEventListener('pointerup', onUp);
    });
  });
}

// ---- マイルストーンの登録・編集(F5-2) ----

function msDialog(m) {
  if (!projects().length) { toast('先に案件ホームから案件を登録してください', true); return; }
  const modal = openModal(`
    <h3>${m ? 'マイルストーンを編集' : 'マイルストーンを追加'}</h3>
    <label>名称 *</label><input type="text" id="msName" value="${esc(m?.name || '')}" placeholder="リリース、受入テスト開始 など">
    <label>案件</label>
    <select id="msProj">${projects().map((p) =>
      `<option value="${p.id}" ${(m ? m.projectId === p.id : p.id === state.projectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label>日付 *</label><input type="date" id="msDate" value="${m?.date || ''}">
    <label>メモ(任意)</label><input type="text" id="msMemo" value="${esc(m?.memo || '')}">
    <div class="modal-actions">
      ${m ? '<button class="btn danger" id="msDel">削除</button>' : ''}
      <button class="btn" id="msCancel">キャンセル</button>
      <button class="btn primary" id="msOk">${m ? '保存' : '追加'}</button>
    </div>`);
  modal.querySelector('#msCancel').addEventListener('click', closeModal);
  modal.querySelector('#msDel')?.addEventListener('click', async () => {
    closeModal();
    await deleteEntity('milestones', m.id, `マイルストーン削除「${m.name}」`);
    toast('削除しました(Ctrl+Zで戻せます)');
  });
  modal.querySelector('#msOk').addEventListener('click', async () => {
    const name = modal.querySelector('#msName').value.trim();
    const date = modal.querySelector('#msDate').value;
    if (!name || !date) { toast('名称と日付を入力してください', true); return; }
    const fields = {
      name, date,
      projectId: modal.querySelector('#msProj').value,
      memo: modal.querySelector('#msMemo').value.trim(),
    };
    closeModal();
    if (m) await patchEntity('milestones', m.id, fields, 'マイルストーン編集');
    else await createEntity('milestones', fields, 'マイルストーン追加');
  });
}
