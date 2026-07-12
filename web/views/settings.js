// 設定: 警告日数・通知・スタートアップ・独自休日・相手マスタ・バックアップ
import { state, col, settingNum } from '../state.js';
import {
  createEntity, deleteEntity, backupNow, openTarget,
  updateSettings, setStartup, notifyTest,
} from '../actions.js';
import { esc, toast } from '../ui.js';

export function render(el) {
  const meta = state.meta || {};
  const s = state.data?.settings || {};
  el.innerHTML = `
    <h2>設定</h2>

    <div class="card">
      <h3>🏐 ボール管理の警告(営業日)</h3>
      <div class="settings-grid">
        <label>催促候補: 返答待ちが
          <input type="number" id="sWait" min="1" max="30" value="${settingNum('waitAlertBizDays', 5)}" style="width:56px"> 営業日</label>
        <label>要回答: 被依頼が
          <input type="number" id="sAsked" min="1" max="30" value="${settingNum('askedAlertBizDays', 3)}" style="width:56px"> 営業日</label>
        <label>滞留警告: 判断保留が
          <input type="number" id="sHold" min="1" max="30" value="${settingNum('holdAlertBizDays', 5)}" style="width:56px"> 営業日</label>
      </div>
      <div class="muted">営業日 = 土日・祝日(同梱データ)・下の独自休日を除いた日数</div>
    </div>

    <div class="card">
      <h3>🔔 通知(開き忘れ対策)</h3>
      <label><input type="checkbox" id="sNotify" ${s.notifyEnabled ? 'checked' : ''}> 毎朝の通知を有効にする</label>
      <label style="margin-left:12px">時刻: <input type="time" id="sNotifyTime" value="${esc(s.notifyTime || '09:00')}"></label>
      <label style="margin-left:12px"><input type="checkbox" id="sStartup" ${meta.startupEnabled ? 'checked' : ''}> Windows起動時にPJKRを自動起動する</label>
      <div style="margin-top:8px">
        <button class="btn" id="notifyTestBtn">通知テスト</button>
      </div>
      <div class="muted" style="margin-top:6px">通知は「今日期限・期限切れ/催促候補/要回答」の件数を表示します(0件の日は通知されません)。クリックでPJKRが開きます。</div>
    </div>

    <div class="card">
      <h3>📅 独自休日(会社の休業日など)</h3>
      <textarea id="sHolidays" style="width:100%;min-height:60px" placeholder="1行に1日付(例: 2026-12-29)">${esc((s.customHolidays || []).join('\n'))}</textarea>
      <div style="margin-top:6px"><button class="btn" id="saveHolidays">休日を保存</button></div>
    </div>

    <div class="card">
      <h3>👥 相手マスタ(担当者・依頼相手)</h3>
      ${col('contacts').map((c) => `
        <div class="link-item">
          <span>${esc(c.name)} <span class="muted">(${esc(c.org)})</span></span>
          <button class="btn small danger row-actions" data-delc="${c.id}">削除</button>
        </div>`).join('') || '<div class="empty">未登録です。タスクの担当やボール管理の相手として使います。</div>'}
      <div class="add-form">
        <input type="text" id="cName" placeholder="名前" style="width:120px">
        <input type="text" id="cOrg" placeholder="所属(ベンダー/部署)" style="width:160px">
        <button class="btn small primary" id="addContact">追加</button>
      </div>
    </div>

    <div class="card">
      <h3>💾 データとバックアップ</h3>
      <div class="muted">データフォルダ: ${esc(meta.dataDir || '')}</div>
      <div class="muted">保存は自動です。バックアップは起動時と日次で自動作成されます(直近20世代)。</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn" id="backupBtn">今すぐバックアップ</button>
        <button class="btn" id="openData">データフォルダを開く</button>
      </div>
    </div>

    <div class="card">
      <h3>ℹ バージョン情報</h3>
      <div class="muted">PJKR ${esc(meta.version || '')}</div>
      <div class="muted">Phase 3以降で追加予定: 報告(週報・Copilot用コピー)・Excel入出力・ガントチャート</div>
    </div>`;

  // 警告日数(F4-6): 変更したら即保存
  const saveNum = (id, key) => {
    el.querySelector(id).addEventListener('change', async (e) => {
      const v = Math.max(1, Math.min(30, Number(e.target.value) || 1));
      await updateSettings({ [key]: v });
      toast('保存しました');
    });
  };
  saveNum('#sWait', 'waitAlertBizDays');
  saveNum('#sAsked', 'askedAlertBizDays');
  saveNum('#sHold', 'holdAlertBizDays');

  el.querySelector('#sNotify').addEventListener('change', async (e) => {
    await updateSettings({ notifyEnabled: e.target.checked });
    toast('保存しました');
  });
  el.querySelector('#sNotifyTime').addEventListener('change', async (e) => {
    await updateSettings({ notifyTime: e.target.value || '09:00' });
    toast('保存しました');
  });
  el.querySelector('#sStartup').addEventListener('change', async (e) => {
    try {
      const enabled = await setStartup(e.target.checked);
      toast(enabled ? 'スタートアップに登録しました' : 'スタートアップ登録を解除しました');
    } catch (err) {
      toast(err.message, true);
    }
  });
  el.querySelector('#notifyTestBtn').addEventListener('click', () => notifyTest().catch((e) => toast(e.message, true)));

  el.querySelector('#saveHolidays').addEventListener('click', async () => {
    const days = el.querySelector('#sHolidays').value.split('\n')
      .map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    await updateSettings({ customHolidays: days });
    toast(`独自休日を${days.length}件保存しました`);
  });

  el.querySelector('#backupBtn').addEventListener('click', backupNow);
  el.querySelector('#openData').addEventListener('click', () => openTarget(meta.dataDir));
  el.querySelector('#addContact').addEventListener('click', async () => {
    const name = el.querySelector('#cName').value.trim();
    if (!name) return;
    await createEntity('contacts', {
      name, org: el.querySelector('#cOrg').value.trim(), memo: '',
    }, '相手マスタ追加');
  });
  el.querySelectorAll('[data-delc]').forEach((b) => {
    b.addEventListener('click', async () => {
      await deleteEntity('contacts', b.dataset.delc, '相手マスタ削除');
      toast('削除しました(Ctrl+Zで戻せます)');
    });
  });
}
