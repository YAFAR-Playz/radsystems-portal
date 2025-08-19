import { $, $$, show } from './dom.js';

export function wireTabs(scopeSelector){
  $$(scopeSelector+' .tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      $$(scopeSelector+' .tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      $$(scopeSelector+' .tab-pane').forEach(p=>p.classList.add('hidden'));
      show(document.getElementById(name));
    });
  });
}
