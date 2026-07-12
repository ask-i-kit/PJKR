// UI共通部品: トースト・モーダル・エスケープ

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), isError ? 5000 : 2600);
}

// モーダル: htmlを表示し、要素を返す。closeModal()かEsc/背景クリックで閉じる。
export function openModal(html) {
  const wrap = document.getElementById('modalWrap');
  const modal = document.getElementById('modal');
  modal.innerHTML = html;
  wrap.hidden = false;
  return modal;
}
export function closeModal() {
  const wrap = document.getElementById('modalWrap');
  wrap.hidden = true;
  document.getElementById('modal').innerHTML = '';
}
export function isModalOpen() {
  return !document.getElementById('modalWrap').hidden;
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'modalWrap') closeModal();
});
