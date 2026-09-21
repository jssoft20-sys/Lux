export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    const err = new Error('Нет соединения. Проверьте интернет');
    err.status = 0;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Ошибка ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body || {});
