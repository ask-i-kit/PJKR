// 報告(F8): 週報の自動下書き→編集→保存/報告資料モード/Copilot用コピー/Excel出力
import {
  col, projects, contactName, byId,
  todayStr, addDays, fmtDate, waitingInfo, askedInfo, LEVEL,
} from '../state.js';
import { createEntity, patchEntity, downloadPost } from '../actions.js';
import { esc, toast } from '../ui.js';

const SECTIONS = [
  ['done', '今週の実績'],
  ['issues', '今週の課題'],
  ['plan', '来週の予定'],
  ['balls', 'リスク・ボール状況'],
];

let current = null;   // { weekStart, rows: [{projectId, project, done, issues, plan, balls}] }
let showMode = false; // 報告資料モード(F8-2)

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const diff = (d.getDay() + 6) % 7; // 月曜=0
  return addDays(dateStr, -diff);
}

export function render(el) {
  if (!current) {
    current = { weekStart: mondayOf(todayStr()), rows: null };
    loadSaved();
  }
  const ws = current.weekStart;
  const we = addDays(ws, 6);
  const saved = savedReport(ws);
  const weekLabel = `${fmtDate(ws)}〜${fmtDate(we)}`;

  if (showMode && current.rows) {
    renderShow(el, weekLabel);
    return;
  }

  el.innerHTML = `
    <h2>報告(週報)</h2>
    <div class="toolbar no-print">
      <button class="btn" id="prevW">◀ 前週</button>
      <b>${weekLabel}</b>
      <button class="btn" id="nextW">次週 ▶</button>
      <span style="flex:1"></span>
      <select id="pastSel">
        <option value="">過去の週報...</option>
        ${col('reports').slice().sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''))
          .map((r) => `<option value="${r.id}">${fmtDate(r.weekStart)}〜${fmtDate(r.weekEnd)}の週報</option>`).join('')}
      </select>
    </div>
    <div class="toolbar no-print">
      <button class="btn primary" id="genBtn">⟳ 下書きを生成${current.rows ? '(やり直し)' : ''}</button>
      ${current.rows ? `
        <button class="btn" id="saveBtn">💾 保存${saved ? '(上書き)' : ''}</button>
        <button class="btn" id="showBtn">📄 報告資料モード</button>
        <button class="btn" id="copilotBtn">📋 Copilot用にコピー</button>
        <button class="btn" id="excelBtn">📊 Excel出力</button>` : ''}
    </div>
    ${current.rows ? editHTML() : `
      <div class="card empty">「下書きを生成」を押すと、この週の完了タスク・作業ログ・課題・ボール状況から
      案件別の週報下書きを自動生成します。${saved ? '<br>この週には保存済みの週報があります(自動で読み込みました)。' : ''}</div>`}`;

  el.querySelector('#prevW').addEventListener('click', () => moveWeek(-7));
  el.querySelector('#nextW').addEventListener('click', () => moveWeek(7));
  el.querySelector('#pastSel').addEventListener('change', (e) => {
    const r = byId('reports', e.target.value);
    if (!r) return;
    current = { weekStart: r.weekStart, rows: r.rows.map((x) => ({ ...x })) };
    document.dispatchEvent(new Event('pjkr:render'));
  });
  el.querySelector('#genBtn').addEventListener('click', () => {
    current.rows = generate(ws, we);
    document.dispatchEvent(new Event('pjkr:render'));
  });
  if (!current.rows) return;

  el.querySelectorAll('[data-sec]').forEach((ta) => {
    ta.addEventListener('input', () => {
      const row = current.rows[Number(ta.dataset.row)];
      row[ta.dataset.sec] = ta.value;
    });
  });
  el.querySelector('#saveBtn').addEventListener('click', save);
  el.querySelector('#showBtn').addEventListener('click', () => {
    showMode = true;
    document.dispatchEvent(new Event('pjkr:render'));
  });
  el.querySelector('#copilotBtn').addEventListener('click', copyForCopilot);
  el.querySelector('#excelBtn').addEventListener('click', exportExcel);
}

function moveWeek(days) {
  current = { weekStart: addDays(current.weekStart, days), rows: null };
  loadSaved();
  showMode = false;
  document.dispatchEvent(new Event('pjkr:render'));
}

const savedReport = (ws) => col('reports').find((r) => r.weekStart === ws);

function loadSaved() {
  const r = savedReport(current.weekStart);
  if (r) current.rows = r.rows.map((x) => ({ ...x }));
}

// ---- 下書き生成(F8-1) ----

function generate(ws, we) {
  const nextWs = addDays(ws, 7);
  const nextWe = addDays(ws, 13);
  const inWeek = (iso) => iso && iso.slice(0, 10) >= ws && iso.slice(0, 10) <= we;
  const rows = [];

  for (const p of projects()) {
    const tasks = col('tasks').filter((t) => t.projectId === p.id);
    const issues = col('issues').filter((i) => i.projectId === p.id && i.status !== 'done');
    const risks = col('risks').filter((r) => r.projectId === p.id && r.status !== 'done');

    const done = [];
    for (const t of tasks) {
      if (inWeek(t.doneAt)) done.push(`・${t.title} を完了${t.answer ? `(回答: ${t.answer})` : ''}`);
      else if (t.status !== 'done' && (t.logs || []).some((l) => inWeek(l.at))) {
        const last = t.logs.filter((l) => inWeek(l.at)).at(-1);
        done.push(`・${t.title}: ${last.text}(対応中)`);
      }
    }
    const issueLines = issues.map((i) =>
      `・[${LEVEL[i.severity] || '中'}] ${i.title}${i.due ? `(期限 ${fmtDate(i.due)})` : ''}`);
    for (const t of tasks) {
      if (t.isAsked && t.status !== 'done' && t.status !== 'waiting' && askedInfo(t).alert) {
        issueLines.push(`・(要回答) ${t.title} ← ${contactName(t.contactId)}`);
      }
    }
    const plan = tasks
      .filter((t) => t.status !== 'done' && t.due && t.due >= nextWs && t.due <= nextWe)
      .sort((a, b) => a.due.localeCompare(b.due))
      .map((t) => `・${t.title}(${fmtDate(t.due)})`);
    const balls = tasks.filter((t) => t.status === 'waiting').map((t) => {
      const wi = waitingInfo(t);
      return `・${t.title} → ${contactName(t.contactId)}(${wi.elapsed}営業日待ち${wi.alert ? '・要催促' : ''})`;
    });
    balls.push(...risks.map((r) =>
      `・(リスク) ${r.title}(影響${LEVEL[r.impact]}×可能性${LEVEL[r.likelihood]})${r.plan ? ` — ${r.plan}` : ''}`));

    if (done.length || issueLines.length || plan.length || balls.length || p.status === 'active') {
      rows.push({
        projectId: p.id, project: p.name,
        done: done.join('\n'), issues: issueLines.join('\n'),
        plan: plan.join('\n'), balls: balls.join('\n'),
      });
    }
  }
  if (!rows.length) toast('対象データがありません(案件が未登録か、今週の活動がありません)', true);
  return rows;
}

// ---- 編集(F8-4) ----

function editHTML() {
  return current.rows.map((row, ri) => `
    <div class="card">
      <h3>${esc(row.project)}</h3>
      <div class="report-grid">
        ${SECTIONS.map(([key, label]) => `
          <div>
            <label class="muted">${label}</label>
            <textarea data-row="${ri}" data-sec="${key}">${esc(row[key] || '')}</textarea>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// ---- 報告資料モード(F8-2) ----

function renderShow(el, weekLabel) {
  el.innerHTML = `
    <div class="toolbar no-print">
      <button class="btn" id="backBtn">← 編集に戻る</button>
      <button class="btn" id="printBtn">🖨 印刷</button>
      <button class="btn" id="copilotBtn2">📋 Copilot用にコピー</button>
    </div>
    <div class="report-show">
      <h2>週次報告(${weekLabel})</h2>
      ${current.rows.map((row) => `
        <div class="report-proj">
          <h3>${esc(row.project)}</h3>
          ${SECTIONS.map(([key, label]) => row[key] ? `
            <h4>${label}</h4>
            <div class="report-body">${esc(row[key])}</div>` : '').join('')}
        </div>`).join('')}
    </div>`;
  el.querySelector('#backBtn').addEventListener('click', () => {
    showMode = false;
    document.dispatchEvent(new Event('pjkr:render'));
  });
  el.querySelector('#printBtn').addEventListener('click', () => window.print());
  el.querySelector('#copilotBtn2').addEventListener('click', copyForCopilot);
}

// ---- 保存(F8-6) ----

async function save() {
  const we = addDays(current.weekStart, 6);
  const saved = savedReport(current.weekStart);
  if (saved) {
    await patchEntity('reports', saved.id, { rows: current.rows, weekEnd: we }, '週報を上書き保存');
  } else {
    await createEntity('reports', { weekStart: current.weekStart, weekEnd: we, rows: current.rows }, '週報を保存');
  }
  toast('週報を保存しました');
}

// ---- Copilot用テキスト(F8-3) ----

async function copyForCopilot() {
  const we = addDays(current.weekStart, 6);
  const lines = [
    '以下は今週の業務メモです。上司向けの週次報告として、案件ごとに見出し+箇条書きで簡潔に清書してください(です・ます調)。',
    '',
    `# 週報メモ(${fmtDate(current.weekStart)}〜${fmtDate(we)})`,
  ];
  for (const row of current.rows) {
    lines.push('', `## ${row.project}`);
    for (const [key, label] of SECTIONS) {
      if (row[key]) lines.push(`### ${label}`, row[key]);
    }
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    toast('Copilot用テキストをコピーしました。CopilotやTeamsのチャットに貼り付けてください');
  } catch {
    toast('クリップボードへのコピーに失敗しました', true);
  }
}

// ---- Excel出力(F8-5) ----

async function exportExcel() {
  const we = addDays(current.weekStart, 6);
  const rows = [];
  for (const row of current.rows) {
    for (const [key, label] of SECTIONS) {
      if (row[key]) rows.push({ project: row.project, section: label, text: row[key] });
    }
  }
  try {
    await downloadPost('/api/export/report',
      { title: `週次報告(${fmtDate(current.weekStart)}〜${fmtDate(we)})`, rows },
      `週報-${current.weekStart}.xlsx`);
  } catch (e) {
    toast(e.message, true);
  }
}
