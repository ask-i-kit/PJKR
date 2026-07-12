// サーバAPI呼び出しの薄いラッパー
async function call(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
  return json;
}

export const get = (url) => call('GET', url);
export const post = (url, body) => call('POST', url, body);
export const patch = (url, body) => call('PATCH', url, body);
export const del = (url) => call('DELETE', url);
