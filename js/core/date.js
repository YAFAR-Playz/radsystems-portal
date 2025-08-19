import { state } from './state.js';
const pad2 = n => (n<10 ? '0'+n : ''+n);
export function parseMaybeISO(s){
  if(!s) return null;
  if(typeof s === 'string'){
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1){ const [_, d,m,y] = m1; return new Date(+y, +m-1, +d); }
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m2){ const [_, y,m,d] = m2; return new Date(+y, +m-1, +d); }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
export function formatDateForInput(s){
  const d = parseMaybeISO(s); if(!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
export function formatDateDisplay(s, formatHint){
  const d = parseMaybeISO(s); if(!d) return s||'';
  const f = (formatHint || state.branding.dateFormat || 'yyyy-MM-dd');
  return f.replace(/yyyy/g, d.getFullYear()).replace(/MM/g, pad2(d.getMonth()+1)).replace(/dd/g, pad2(d.getDate()));
}
