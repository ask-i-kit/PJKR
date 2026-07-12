// データ入出力(F9): Excelエクスポート/インポート、JSONバックアップ/リストア
import { importExcel, restoreJSON } from '../actions.js';
import { esc, toast, openModal, closeModal } from '../ui.js';

export function render(el) {
  el.innerHTML = `
    <h2>データ入出力</h2>

    <div class="card">
      <h3>📤 Excelエクスポート</h3>
      <div class="muted">現在のデータを .xlsx としてダウンロードします(報告への添付・確認用)。</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="/api/export/tasks">✅ タスク一覧</a>
        <a class="btn" href="/api/export/issues">⚠ 課題一覧</a>
        <a class="btn" href="/api/export/balls">🏐 ボール一覧</a>
        <a class="btn" href="/api/export/qa">💬 Q&A一覧(FAQ素材)</a>
      </div>
      <div class="muted" style="margin-top:6px">週報のExcel出力は「報告」画面から行えます。</div>
    </div>

    <div class="card">
      <h3>📥 Excelインポート(一括取込)</h3>
      <div class="muted">テンプレートの列構成で作成したExcelから、タスク・課題を一括登録します。
        案件名・担当名は登録済みのものと一致させてください。取込はCtrl+Zで取り消せます。</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <a class="btn small" href="/api/template/tasks">タスク用テンプレート</a>
        <a class="btn small" href="/api/template/issues">課題用テンプレート</a>
      </div>
      <div class="add-form" style="margin-top:10px;align-items:center">
        <select id="impKind">
          <option value="tasks">タスクとして取込</option>
          <option value="issues">課題として取込</option>
        </select>
        <input type="file" id="impFile" accept=".xlsx">
        <button class="btn primary" id="impBtn">取込実行</button>
      </div>
      <div id="impResult"></div>
    </div>

    <div class="card">
      <h3>💾 JSONバックアップ / リストア</h3>
      <div class="muted">全データを1つのJSONファイルとして持ち出し・復元できます(PC入替・退避用)。</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <a class="btn" href="/api/export/json">⬇ バックアップをダウンロード</a>
        <input type="file" id="restoreFile" accept=".json">
        <button class="btn danger" id="restoreBtn">⚠ このファイルで復元</button>
      </div>
    </div>`;

  el.querySelector('#impBtn').addEventListener('click', async () => {
    const file = el.querySelector('#impFile').files[0];
    if (!file) { toast('Excelファイルを選択してください', true); return; }
    const kind = el.querySelector('#impKind').value;
    try {
      const res = await importExcel(kind, file);
      const box = document.querySelector('#impResult');
      if (box) {
        box.innerHTML = `<div style="margin-top:8px">✅ ${res.created.length}件を取り込みました
          ${res.errors.length ? `<div class="due-over" style="margin-top:4px">スキップ ${res.errors.length}件:<br>${res.errors.map(esc).join('<br>')}</div>` : ''}</div>`;
      }
      toast(`${res.created.length}件を取り込みました(Ctrl+Zで取り消せます)`);
    } catch (e) {
      toast(e.message, true);
    }
  });

  el.querySelector('#restoreBtn').addEventListener('click', () => {
    const file = el.querySelector('#restoreFile').files[0];
    if (!file) { toast('バックアップのJSONファイルを選択してください', true); return; }
    const modal = openModal(`
      <h3>⚠ データの復元</h3>
      <p>現在の全データを「${esc(file.name)}」の内容で<b>置き換えます</b>。<br>
      現在のデータは復元前に data/backup/ へ自動退避されますが、この操作はCtrl+Zでは戻せません。</p>
      <div class="modal-actions">
        <button class="btn" id="rsCancel">キャンセル</button>
        <button class="btn danger" id="rsOk">復元する</button>
      </div>`);
    modal.querySelector('#rsCancel').addEventListener('click', closeModal);
    modal.querySelector('#rsOk').addEventListener('click', async () => {
      closeModal();
      try {
        await restoreJSON(file);
        toast('復元しました');
      } catch (e) {
        toast(e.message, true);
      }
    });
  });
}
