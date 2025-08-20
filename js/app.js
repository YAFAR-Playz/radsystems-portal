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
function wireHeader() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (!logoutBtn) return;
  logoutBtn.onclick = async () => {
    localStorage.removeItem('token');
    state.user = null;
    setChip();
    await showLogin();
  };
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

  const emailEl   = document.getElementById('loginEmail');
  const passEl    = document.getElementById('loginPassword');
  const newPass   = document.getElementById('newPass');
  const newPass2  = document.getElementById('newPass2');

  const stepEmail   = document.getElementById('step-email');
  const stepExist   = document.getElementById('step-existing');
  const stepNewPass = document.getElementById('step-newpass');

  const btnContinue   = document.getElementById('btnContinue');
  const btnSignIn     = document.getElementById('btnSignIn');
  const btnSetPass    = document.getElementById('btnSetPassword');
  const btnBack1      = document.getElementById('btnBack1');
  const btnBack2      = document.getElementById('btnBack2');
  const btnDemo       = document.getElementById('btnDemo');

  const spinCont  = document.getElementById('continueSpin');
  const spinSign  = document.getElementById('signinSpin');
  const spinSet   = document.getElementById('setpassSpin');

  if(!emailEl || !btnContinue || !btnDemo) throw new Error('login.html missing required IDs');

  const go = (a,b,c)=>{ a.classList.remove('hidden'); b.classList.add('hidden'); c.classList.add('hidden'); };

  btnContinue.addEventListener('click', async ()=>{
    const email = (emailEl.value||'').trim();
    if (!email){ alert('Enter your email'); return; }
    setLoading(btnContinue, true, spinCont);
    try{
      const r = await api('auth.checkEmail', { email });
      if (!r.exists) { alert('No account found for this email'); return; }
      if (r.hasPassword) {
        passEl.value = '';
        go(stepExist, stepEmail, stepNewPass);
        setTimeout(()=> passEl.focus(), 0);
      } else {
        newPass.value=''; newPass2.value='';
        go(stepNewPass, stepEmail, stepExist);
        setTimeout(()=> newPass.focus(), 0);
      }
    }catch(e){ alert('Error: '+e.message); }
    finally{ setLoading(btnContinue, false, spinCont); }
  });

  btnBack1?.addEventListener('click', ()=> go(stepEmail, stepExist, stepNewPass));
  btnBack2?.addEventListener('click', ()=> go(stepEmail, stepExist, stepNewPass));

  btnSignIn?.addEventListener('click', async ()=>{
    const email = (emailEl.value||'').trim();
    const password = passEl?.value || '';
    if (!password){ alert('Enter your password'); return; }
    setLoading(btnSignIn, true, spinSign);
    showPageLoader(true);
    try{
      const res = await api('login',{ email, password });
      localStorage.setItem('token', res.token);
      state.user = res.user;
      setChip();
      await loadBranding();
      await mountRole(state.user.role, false);
    }catch(err){ alert('Login failed: '+err.message); }
    finally{ setLoading(btnSignIn,false,spinSign); showPageLoader(false); }
  });

  btnSetPass?.addEventListener('click', async ()=>{
    const email = (emailEl.value||'').trim();
    const p1 = newPass?.value || '', p2 = newPass2?.value || '';
    if (p1.length < 6) { alert('Password must be at least 6 characters'); return; }
    if (p1 !== p2) { alert('Passwords do not match'); return; }
    setLoading(btnSetPass, true, spinSet);
    showPageLoader(true);
    try{
      await api('auth.setPassword', { email, password:p1 });
      // Auto sign-in after setting password
      const res = await api('login',{ email, password:p1 });
      localStorage.setItem('token', res.token);
      state.user = res.user;
      setChip();
      await loadBranding();
      await mountRole(state.user.role, false);
    }catch(err){ alert('Could not set password: '+err.message); }
    finally{ setLoading(btnSetPass,false,spinSet); showPageLoader(false); }
  });

  // Demo mode remains
  btnDemo.addEventListener('click', async ()=>{
    const email = (emailEl.value || '').trim().toLowerCase();
    let role = 'assistant';
    if (email.includes('admin')) role='admin';
    else if (email.includes('head')) role='head';

    state.user = {
      admin:{ userId:'ad-1', role:'admin', displayName:'Admin User', course:'' },
      head:{ userId:'h-1', role:'head', displayName:'Mr. Hany', course:'Math' },
      assistant:{ userId:'a-1', role:'assistant', displayName:'Sara Ali', course:'Math' }
    }[role];

    setChip();
    await loadBranding();
    await mountRole(state.user.role, true);
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
  wireHeader();
  const resumed = await tryResume();
  if (!resumed) await showLogin();
})();
