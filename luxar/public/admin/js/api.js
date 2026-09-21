export async function api(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: body && !opts.form ? { 'Content-Type': 'application/json' } : {}, body: body ? (opts.form ? body : JSON.stringify(body)) : undefined, credentials: 'same-origin' });
  } catch { const e = new Error('Нет соединения с сервером'); e.status = 0; throw e; }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (res.status === 401 && !path.endsWith('/login') && !path.endsWith('/me')) { window.dispatchEvent(new CustomEvent('admin:unauthorized')); }
  if (!res.ok) { const e = new Error((data && data.error) || `Ошибка ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b || {});
export const put = (p, b) => api('PUT', p, b || {});
export const del = (p, b) => api('DELETE', p, b);
export const upload = (p, formData) => api('POST', p, formData, { form: true });
