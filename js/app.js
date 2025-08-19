// js/app.js
import { $, show, hide, showPageLoader } from './core/dom.js';
import { state } from './core/state.js';
import { api } from './core/api.js';
import { loadBranding } from './core/branding.js';
import { wireTabs } from './core/tabs.js';

const root = document.getElementById('app-root'); // must exist in public/index.html

/** Map of all tab panes per role => relative partial paths */
const ROLE_TABS = {
  assistant: [
    ['a-home',        '../views/roles/assistant/tabs/home.html'],
    ['a-students',    '../views/roles/assistant/tabs/students.html'],
    ['a-performance', '../views/roles/assistant/tabs/performance.html'],
  ],
  head: [
    ['h-home',         '../views/roles/head/tabs/home.html'],
    ['h-assign',       '../views/roles/head/tabs/assign.html'],
    ['h-assignments',  '../views/roles/head/tabs/assignments.html'],
    ['h-analytics',    '../views/roles/head/tabs/analytics.html'],
  ],
  admin: [
    ['adm-users',     '../views/roles/admin/tabs/users.html'],
    ['adm-students',  '../views/roles/admin/tabs/students.html'],
    ['adm-courses',   '../views/roles/admin/tabs/courses.html'],
    ['adm-enroll',    '../views/roles/admin/tabs/enrollments.html'],
    ['adm-perms',     '../views/roles/admin/tabs/perms.html'],
    ['adm-data',      '../views/roles/admin/tabs/data.html'],
    ['adm-brand',     '../views/roles/admin/tabs/brand.html'],
  ],
};

function setChip(){
  const chip = $('#userChip');
  const logout = $('#logoutBtn');
  if (!chip || !logout) return; // header must exist; hard guard
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
  const res = await fetch(htmlPath);
  if (!res.ok) throw new Error(`Failed to load ${htmlPath}`);
  root.innerHTML = await res.text();
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

/**
 * Mount + boot a role safely:
 *  1) inject role-specific CSS
 *  2) load role layout
 *  3) load ALL tab partials (so the DOM exists)
 *  4) wire tabs
 *  5) try to import optional role module and call its boot(demo)
 */
async function mountRole(role, demo=false){
  // 1) role CSS
  const id = 'role-style';
  document.getElementById(id)?.remove();
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `../styles/role-${role}.css`;
  document.head.appendChild(link);

  // 2) layout
  await loadView(`../views/roles/${role}/layout.html`);

  // 3) load tabs BEFORE any role code runs
  await loadTabsForRole(role);

  // 4) wire tabs now that HTML is in place
  wireTabs(`#view-${role}`);

  // 5) optional role module (won’t crash if missing or minimal)
  try{
    const mod = await import(`./roles/${role}/index.js`);
    if (typeof mod.mount === 'function') await mod.mount(); // if you want extra per-role mounting
    if (typeof mod.boot  === 'function') await mod.boot(!!demo);
    else if (typeof mod.init === 'function') await mod.init(!!demo); // support older naming
  }catch(_err){
    // no role module or it’s not needed — that’s fine
  }
}

async function showLogin(){
  await loadView('../views/roles/login.html'); // injects login partial into #app-root

  // Hard guards for missing markup (prevents "reading 'value' of null")
  const emailEl = document.getElementById('loginEmail');
  const roleEl  = document.getElementById('loginRole');
  const btnLogin = document.getElementById('btnLogin');
  const btnDemo  = document.getElementById('btnDemo');
  if (!emailEl || !roleEl || !btnLogin || !btnDemo) {
    throw new Error('login.html is missing required IDs (loginEmail, loginRole, btnLogin, btnDemo)');
  }

  btnLogin.addEventListener('click', async ()=>{
    const email = emailEl.value.trim();
    const role  = roleEl.value;
    showPageLoader(true);
    try{
      const res = await api('login',{email, role});
      if (!res || !res.token) throw new Error('Invalid login');
      localStorage.setItem('token', res.token);
      state.user = res.user;
      setChip();
      await loadBranding();
      await mountRole(state.user.role, /*demo=*/false);
    }catch(err){
      alert('Login failed: ' + err.message);
    }finally{
      showPageLoader(false);
    }
  });

  btnDemo.addEventListener('click', async ()=>{
    const role = roleEl.value;
    state.user = {
      assistant:{ userId:'a-1', role:'assistant', displayName:'Sara Ali', course:'Math' },
      head:{ userId:'h-1', role:'head', displayName:'Mr. Hany', course:'Math' },
      admin:{ userId:'ad-1', role:'admin', displayName:'Admin User', course:'' }
    }[role];
    setChip();
    await loadBranding();
    await mountRole(role, /*demo=*/true);
  });

  // header logout (header is outside #app-root, so it survives view swaps)
  $('#logoutBtn')?.addEventListener('click', async ()=>{
    localStorage.removeItem('token');
    state.user = null;
    setChip();
    await showLogin();
  });
}

(async function init(){
  await loadBranding();
  await showLogin();
})();
