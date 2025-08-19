export const API_BASE = "https://script.google.com/macros/s/AKfycbyKV_M4M5aNWNNoq9faKWcAAl31LC6FGPzdDYIl5J0AZS2lMMN8POH9JH7N-bW6xNjnBA/exec";

export async function api(action, payload = {}) {
  const token = localStorage.getItem('token') || '';
  const body = new URLSearchParams();
  body.set('action', action);
  body.set('payload', JSON.stringify(payload));
  body.set('token', token);

  let res, text;
  try { res = await fetch(API_BASE, { method: 'POST', body, redirect: 'follow' }); }
  catch (err) { throw new Error(`Network/CORS error: ${err.message}`); }
  text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0,300)}`);
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0,300)}`); }
  if (data && data.error) throw new Error(data.error);
  return data;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = ''; const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk){ binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk)); }
  return btoa(binary);
}

export async function uploadFileBase64(file, extraParams) {
  const token = localStorage.getItem('token') || '';
  const buf = await file.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const body = new URLSearchParams();
  Object.entries({ ...extraParams, token, file64:b64, filename:file.name, mimeType:file.type || 'application/octet-stream' })
    .forEach(([k,v])=> body.set(k,String(v)));
  const res = await fetch(API_BASE, { method:'POST', body });
  if(!res.ok) throw new Error('Upload failed');
  const out = await res.json();
  if (out && out.error) throw new Error(out.error);
  return out;
}
