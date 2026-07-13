// エントリポイント: ルーティング・グローバルショートカット・ヘッダー動作
import { state, reload, projects, col, waitingTasks, askedTasks, waitingInfo, askedInfo } from './state.js';
import { createEntity, undo, redo } from './actions.js';
import { toast, isModalOpen, closeModal } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as tasks from './views/tasks.js';
import * as inbox from './views/inbox.js';
import * as home from './views/home.js';
import * as settings from './views/settings.js';
import * as balls from './views/balls.js';
import * as holds from './views/holds.js';
import * as answers from './views/answers.js';
import * as issues from './views/issues.js';
import * as gantt from './views/gantt.js';
import * as search from './views/search.js';
import * as report from './views/report.js';
import * as dataio from './views/dataio.js';

const views = { dashboard, tasks, inbox, home, settings, balls, holds, answers, issues, gantt, search, report, dataio };

function currentRoute() {
  const name = (location.hash || '#/dashboard').replace(/^#\//, '').split('/')[0];
  return views[name] ? name : 'dashboard';
}

export function render() {
  const route = currentRoute();
  document.querySelectorAll('#sidebar a[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const badge = document.getElementById('inboxBadge');
  const n = col('inbox').length;
  badge.hidden = n === 0;
  badge.textContent = n;
  const ballBadge = document.getElementById('ballBadge');
  const alerts = waitingTasks().filter((t) => waitingInfo(t).alert).length +
    askedTasks().filter((t) => askedInfo(t).alert).length;
  ballBadge.hidden = alerts === 0;
  ballBadge.textContent = alerts;
  renderProjectSelect();
  views[route].render(document.getElementById('main'));
}

function renderProjectSelect() {
  const sel = document.getElementById('projectSelect');
  const opts = ['<option value="">全案件</option>']
    .concat(projects().map((p) =>
      `<option value="${p.id}" ${p.id === state.projectId ? 'selected' : ''}>${p.name.replace(/</g, '&lt;')}</option>`));
  sel.innerHTML = opts.join('');
}

function setupHeader() {
  const quick = document.getElementById('quickAdd');
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    const text = quick.value.trim();
    quick.value = '';
    await createEntity('inbox', { text }, 'Inboxへの書き留め');
    toast('Inboxに書き留めました');
  });

  const search = document.getElementById('searchBox');
  search.addEventListener('input', () => { // 横断検索(F10)
    state.search = search.value.trim();
    if (currentRoute() !== 'search') location.hash = '#/search';
    else render();
  });

  document.getElementById('projectSelect').addEventListener('change', (e) => {
    state.projectId = e.target.value;
    render();
  });
}

function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (isModalOpen()) { closeModal(); e.preventDefault(); }
      else if (state.selectedTaskId) { state.selectedTaskId = null; render(); }
      return;
    }
    if (!e.ctrlKey) return;
    switch (e.key.toLowerCase()) {
      case 'i':
        e.preventDefault();
        document.getElementById('quickAdd').focus();
        break;
      case 'f':
        e.preventDefault();
        document.getElementById('searchBox').focus();
        break;
      case 'z':
        if (!inInput) { e.preventDefault(); undo(); } // 入力中はブラウザ標準のテキストUndoに譲る(要件N11)
        break;
      case 'y':
        if (!inInput) { e.preventDefault(); redo(); }
        break;
    }
  });
}

async function main() {
  try {
    await reload();
  } catch (err) {
    document.getElementById('main').innerHTML =
      `<div class="card">サーバに接続できません: ${err.message}</div>`;
    return;
  }
  setupHeader();
  setupShortcuts();
  window.addEventListener('hashchange', render);
  document.addEventListener('pjkr:render', render);
  render();
}

main();
