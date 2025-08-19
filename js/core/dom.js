export const $  = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));
export function show(el){ el && el.classList.remove('hidden'); }
export function hide(el){ el && el.classList.add('hidden'); }
export function setLoading(btn, on, spinEl){ if(!btn) return; btn.disabled=!!on; if(spinEl){ on?spinEl.classList.remove('hidden'):spinEl.classList.add('hidden'); } }
export function showPageLoader(on){ const el=document.getElementById('pageLoader'); if(!el) return; on?el.classList.add('show'):el.classList.remove('show'); }
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
