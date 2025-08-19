import { $, show, hide, showPageLoader } from './core/dom.js';
import { state } from './core/state.js';
import { api } from './core/api.js';
import { loadBranding } from './core/branding.js';

const root = document.getElementById('app-root');

function setChip(){
  const chip = $('#userChip');
  if(state.user){ chip.textContent = `${state.user.displayName} · ${state.user.role}`; chip.classList.remove('hidden'); $('#logoutBtn').classList.remove('hidden'); }
  else { chip.classList.add('hidden'); $('#logoutBtn').classList.add('hidden'); }
}

async function loadView(htmlPath){
  const res = await fetch(htmlPath);
  const html = await res.text();
  root.innerHTML = html;
}

async function mountRole(role){
  // inject role css
  const id = 'role-style';
  document.getElementById(id)?.remove();
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `../styles/role-${role}.css`;
  document.head.appendChild(link);

  // load role layout and JS
  await loadView(`../views/roles/${role}/layout.html`);
  const mod = await import(`./roles/${role}/index.js`);
  await mod.init(); // each role exports init()
}

async function showLogin(){
  await loadView('../views/roles/login.html'); // tiny login partial
  const btnLogin = document.getElementById('btnLogin');
  const btnDemo  = document.getElementById('btnDemo');

  btnLogin.addEventListener('click', async ()=>{
    const email = document.getElementById('loginEmail').value.trim();
    const role  = document.getElementById('loginRole').value;
    showPageLoader(true);
    try{
      const res = await api('login',{email, role});
      if(res && res.token){
        localStorage.setItem('token', res.token);
        state.user = res.user; setChip();
        await loadBranding();
        await mountRole(state.user.role);
      } else throw new Error('Invalid login');
    }catch(err){ alert('Login failed: '+err.message) }
    finally{ showPageLoader(false); }
  });

  btnDemo.addEventListener('click', async ()=>{
    const role = document.getElementById('loginRole').value;
    state.user = {
      assistant:{ userId:'a-1', role:'assistant', displayName:'Sara Ali', course:'Math' },
      head:{ userId:'h-1', role:'head', displayName:'Mr. Hany', course:'Math' },
      admin:{ userId:'ad-1', role:'admin', displayName:'Admin User', course:'' }
    }[role];
    setChip();
    await loadBranding();
    await mountRole(role);
  });

  $('#logoutBtn').addEventListener('click',()=>{
    localStorage.removeItem('token'); state.user=null; setChip(); showLogin();
  });
}

(async function init(){
  await loadBranding();
  await showLogin();
})();
