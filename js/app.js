// js/app.js
import { $, show, hide, showPageLoader, setLoading } from './core/dom.js';
import { state } from './core/state.js';
import { api } from './core/api.js';
import { loadBranding } from './core/branding.js';
import { wireTabs } from './core/tabs.js';

const root = document.getElementById('app-root'); // must exist in public/index.html

/** Map of all tab panes per role => relative partial paths */
const ROLE_TABS = {
  assistant: [
    ['a-home',        'views/roles/assistant/tabs/home.html'],
    ['a-students',    'views/roles/assistant/tabs/students.html'],
    ['a-performance', 'views/roles/assistant/tabs/performance.html'],
  ],
  head: [
    ['h-home',         'views/roles/head/tabs/home.html'],
    ['h-assign',       'views/roles/head/tabs/assign.html'],
    ['h-assignments',  'views/roles/head/tabs/assignments.html'],
    ['h-analytics',    'views/roles/head/tabs/analytics.html'],
  ],
  admin: [
    ['adm-users',     'views/roles/admin/tabs/users.html'],
    ['adm-students',  'views/roles/admin/tabs/students.html'],
    ['adm-courses',   'views/roles/admin/tabs/courses.html'],
    ['adm-enroll',    'views/roles/admin/tabs/enrollments.html'],
    ['adm-perms',     'views/roles/admin/tabs/perms.html'],
    ['adm-data',      'views/roles/admin/tabs/data.html'],
    ['adm-brand',     'views/roles/admin/tabs/brand.html'],
  ],
};

function setChip(){
  const chip = $('#userChip');
  const logout = $('#logoutBtn');
  if (!chip || !logout) return;
  if (state.user) {
    chip.textContent = `${state.user.displayName} · ${state.user.role}`;
    chip.classList.remove('hidden');
    logout.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
    logout.classList.add('hidden');
  }
}

async function loadView(htmlPath){
  try {
    const res = await fetch(htmlPath, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const html = await res.text();
    root.innerHTML = html;
  } catch (err) {
    console.error('loadView failed for', htmlPath, err);
    root.innerHTML = `
      <div class="card">
        <h3>Failed to load view</h3>
        <div class="muted">Path: ${htmlPath}</div>
        <div class="badge danger">${String(err)}</div>
      </div>`;
  }
}

async function loadTabsForRole(role){
  const entries = ROLE_TABS[role] || [];
  for (const [paneId, htmlPath] of entries){
    const pane = document.getElementById(paneId);
    if (!pane) throw new Error(`Missing pane #${paneId} in ${role}/layout.html`);
    const res = await fetch(htmlPath);
    if (!res.ok) throw new Error(`Failed to load ${htmlPath}`);
    pane.innerHTML = await res.text();
  }
}

async function mountRole(role, demo=false){
  // 1) role CSS
  const id = 'role-style';
  document.getElementById(id)?.remove();
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `styles/role-${role}.css`;
  document.head.appendChild(link);

  // 2) layout
  await loadView(`views/roles/${role}/layout.html`);

  // 3) load tabs BEFORE any role code runs
  await loadTabsForRole(role);

  // 4) wire tabs now that HTML is in place
  wireTabs(`#view-${role}`);

  // 5) optional role module
  try{
    const mod = await import(`./roles/${role}/index.js`);
    if (typeof mod.mount === 'function') await mod.mount();
    if (typeof mod.boot  === 'function') await mod.boot(!!demo);
    else if (typeof mod.init === 'function') await mod.init(!!demo);
  }catch(_err){}
}

async function showLogin(){
  await loadView('views/roles/login.html');

  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPassword');
  const btnLogin = document.getElementById('btnLogin');
  const btnDemo  = document.getElementById('btnDemo');
  const spin     = document.getElementById('loginSpin');
  if (!emailEl || !passEl || !btnLogin || !btnDemo || !spin) {
    throw new Error('login.html is missing required IDs (loginEmail, loginPassword, btnLogin, btnDemo, loginSpin)');
  }

  btnLogin.addEventListener('click', async ()=>{
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password){ alert('Enter email and password'); return; }

    setLoading(btnLogin, true, spin);
    showPageLoader(true);
    try{
      const res = await api('login',{ email, password });
      if (!res || !res.token) throw new Error('Invalid login');
      localStorage.setItem('token', res.token);
      state.user = res.user;
      setChip();
      await loadBranding();
      await mountRole(state.user.role, /*demo=*/false);
    }catch(err){
      alert('Login failed: ' + err.message);
    }finally{
      setLoading(btnLogin, false, spin);
      showPageLoader(false);
      passEl.value = '';
    }
  });

  // Demo: still works, but now role is inferred by email
  btnDemo.addEventListener('click', async ()=>{
    const demoEmail = (emailEl.value || '').trim().toLowerCase();
    let user;
    if (demoEmail.includes('admin'))      user = { userId:'ad-1', role:'admin', displayName:'Admin User', course:'' };
    else if (demoEmail.includes('head'))  user = { userId:'h-1', role:'head', displayName:'Mr. Hany', course:'Math' };
    else                                  user = { userId:'a-1', role:'assistant', displayName:'Sara Ali', course:'Math' };
    state.user = user;
    setChip();
    await loadBranding();
    await mountRole(state.user.role, /*demo=*/true);
  });

  $('#logoutBtn')?.addEventListener('click', async ()=>{
    localStorage.removeItem('token');
    state.user = null;
    setChip();
    await showLogin();
  });
}

// Attempt session resume
async function tryResume(){
  const token = localStorage.getItem('token') || '';
  if (!token) return false;
  try{
    const r = await api('me', {});
    state.user = r.user;
    setChip();
    await loadBranding();
    await mountRole(state.user.role, /*demo=*/false);
    return true;
  }catch(_){ return false; }
}

(async function init(){
  await loadBranding();
  const resumed = await tryResume();
  if (!resumed) await showLogin();
})();
