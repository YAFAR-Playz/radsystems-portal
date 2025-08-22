import { state } from './state.js';
const pad2 = n => (n<10 ? '0'+n : ''+n);

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
  const d = parseMaybeISO(s); if(!d) return s || '';
  const fmt = formatHint || state.branding?.dateFormat || 'yyyy-MM-dd';

  const Y = d.getFullYear();
  const M = d.getMonth();      // 0..11
  const D = d.getDate();       // 1..31

  const tokens = {
    'yyyy': String(Y),
    'MMMM': MONTHS_LONG[M],
    'MMM' : MONTHS_SHORT[M],
    'MM'  : pad2(M+1),
    'M'   : String(M+1),
    'dd'  : pad2(D),
    'd'   : String(D),
  };

  // Replace longer tokens first to avoid partial overlaps
  return fmt.replace(/yyyy|MMMM|MMM|MM|M|dd|d/g, t => tokens[t]);
}
