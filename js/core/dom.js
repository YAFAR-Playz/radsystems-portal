// js/core/dom.js  — upgraded, backwards‑compatible

// ------- tiny DOM helpers -------
export const $  = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

export function show(el){ if(el) el.classList.remove('hidden'); }
export function hide(el){ if(el) el.classList.add('hidden'); }

// ------- page overlay loader -------
let _overlayEl = null;
function ensureOverlay(){
  if (_overlayEl) return _overlayEl;
  _overlayEl = document.getElementById('pageLoader');
  return _overlayEl;
}
export function showPageLoader(on){
  const el = ensureOverlay();
  if (!el) return;
  if (on) el.classList.add('show'); else el.classList.remove('show');
}

// ------- spinner injection -------
function ensureSpinnerForButton(btn, preferDark=false){
  if (!btn) return null;

  // Use existing spinner if present
  let spin = btn.querySelector('.spinner');
  if (spin) return spin;

  // Inject a spinner (hidden by default)
  spin = document.createElement('span');
  spin.className = 'spinner' + (preferDark ? ' dark' : '');
  spin.classList.add('hidden');

  // Put spinner first for better alignment
  btn.insertBefore(spin, btn.firstChild);
  return spin;
}

// ------- improved setLoading (BC-safe) -------
// Works with or without passing a spinner element. If none,
// we auto-inject one and toggle it.
export function setLoading(btn, on, spinEl){
  if(!btn) return;

  // preferDark for non-primary buttons on light backgrounds
  const preferDark = !btn.classList.contains('primary');
  const spinner = spinEl || ensureSpinnerForButton(btn, preferDark);

  btn.disabled = !!on;
  if (spinner){
    if (on) spinner.classList.remove('hidden');
    else spinner.classList.add('hidden');
  }
}

// ------- one-shot guard + spinner wrapper -------
// Prevents double-clicks, auto-disables/enables, shows spinner.
export async function withLoading(btn, task){
  if (!btn) return await task();

  // Guard against concurrent in-flight actions on same button
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';

  setLoading(btn, true);
  try{
    return await task();
  } finally {
    setLoading(btn, false);
    delete btn.dataset.busy;
  }
}

// ------- bind a click handler with loading controls -------
// Example:
//   bindAsyncClick('#saveBtn', async () => { await api(...); });
export function bindAsyncClick(targetOrSelector, handler){
  const btn = typeof targetOrSelector === 'string' ? $(targetOrSelector) : targetOrSelector;
  if (!btn) return;
  btn.addEventListener('click', async (e)=>{
    e.preventDefault();
    await withLoading(btn, handler);
  });
}

// ------- downloads -------
export function downloadText(text, filename){
  const blob = new Blob([text], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
export function downloadCSV(name, csv){
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name+'.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ------- safe setters (kept for compatibility) -------
export function setTextById(id, value){
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
export function setHTMLBySel(sel, html){
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
}

// Aliases you already exported (kept)
export function qs(sel){ return document.querySelector(sel); }
export function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
