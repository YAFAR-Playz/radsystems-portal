import { wireTabs } from '../../core/tabs.js';
import { $, $$, show, hide, showPageLoader, setLoading, downloadCSV } from '../../core/dom.js';
import { api, uploadFileBase64 } from '../../core/api.js';
import { state } from '../../core/state.js';
import { formatDateDisplay, formatDateForInput } from '../../core/date.js';
import { applyBranding } from '../../core/branding.js';

// helpers
// ---- status mapping & pills ----
const MAP_STU_to_ENR = { Active:'Active', Left:'Dropped', Inactive:'Completed' };
const MAP_ENR_to_STU = { Active:'Active', Dropped:'Left',   Completed:'Inactive' };

function badgeForStatus(kind, val){
  // kind: 'student' | 'enroll'
  const cls =
    (kind==='student')
      ? (val==='Active' ? 'ok' : val==='Left' ? 'danger' : 'warn')
      : (val==='Active' ? 'ok' : val==='Dropped' ? 'danger' : 'warn');
  return `<span class="badge ${cls}">${val||''}</span>`;
}

// keep both sides in sync
async function syncEnrollmentsFromStudent(studentId, studentStatus){
  const target = MAP_STU_to_ENR[studentStatus];
  if (!target) return;
  // ensure we have enrollments loaded
  const list = state.admin.enrollments?.filter(e=> e.studentId===studentId) || [];
  await Promise.all(list.map(e=>{
    if (e.status !== target){
      return api('admin.enroll.update', { enrollmentId: e.enrollmentId, patch:{ status: target } });
    }
  }));
}

async function syncStudentFromEnrollment(studentId, enrStatus){
  const target = MAP_ENR_to_STU[enrStatus];
  if (!target) return;
  const s = (state.admin.students||[]).find(x=> x.studentId===studentId);
  if (s && s.status !== target){
    await api('admin.students.update', { studentId, patch:{ status: target } });
  }
}

function makeTable(el, headers, rows){
  const thead = el.querySelector('thead'); const tbody = el.querySelector('tbody');
  thead.innerHTML = '<tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr>';
  tbody.innerHTML = rows.map(r=>'<tr>'+r.map(c=>`<td>${c}</td>`).join('')+'</tr>').join('');
}
function fillCourseSelect(selectEl){
  const prev = selectEl.value;
  selectEl.innerHTML = '<option value="">— select course —</option>';
  state.admin.courses.forEach(c=>{
    const o=document.createElement('option'); o.value=c.courseId; o.textContent=`${c.name} (${c.code})`; o.dataset.name=c.name; selectEl.appendChild(o);
  });
  if (prev) selectEl.value = prev;
}
function fillStudentSelect(selectEl){
  const prev = selectEl.value;
  selectEl.innerHTML = '<option value="">— select student —</option>';
  state.admin.students.forEach(s=>{
    const o=document.createElement('option'); o.value=s.studentId; o.textContent=`${s.studentName} (${s.email||''})`; selectEl.appendChild(o);
  });
  if (prev) selectEl.value = prev;
}
function fillAssistantSelectForCourse(selectEl, courseId){
  const prev = selectEl.value;
  selectEl.innerHTML = '<option value="">— select assistant —</option>';

  const course = state.admin.courses.find(c => c.courseId === courseId);
  const courseName = course ? course.name : '';

  const list = (state.admin.assistants || [])
    .filter(a => a.role === 'assistant' && (a.course||'') === courseName);

  list.forEach(a=>{
    const o = document.createElement('option');
    o.value = a.userId;
    o.textContent = a.displayName || a.email || a.userId;
    selectEl.appendChild(o);
  });

  if (prev) selectEl.value = prev;
}

// LOAD DATA
async function loadAssistants(){
  const res = await api('admin.users.list', { role:'assistant' });
  state.admin.assistants = res.users || [];
}
async function loadUsers(){
  setLoading($('#u-refresh'), true, $('#u-refresh-spin'));
  try{
    const search = $('#u-search').value?.trim() || '';
    const role = $('#u-filter-role').value || undefined;
    const res = await api('admin.users.list', {search, role});
    state.admin.users = res.users || [];
    renderUsersTable();
  } finally { setLoading($('#u-refresh'), false, $('#u-refresh-spin')); }
}
function renderUsersTable(){
  const el = $('#u-table');
  const thead = el.querySelector('thead'); const tbody = el.querySelector('tbody');
  thead.innerHTML = '<tr><th>User</th><th>Role</th><th>Course</th><th>Actions</th></tr>';
  tbody.innerHTML = '';
  state.admin.users.forEach(u=>{
    const courseName = (state.admin.courses.find(c=> c.name===u.course || c.courseId===u.course)?.name) || (u.course||'');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div><b>${u.displayName||''}</b></div>
        <div class="muted">${u.email}</div>
      </td>
      <td>${u.role}</td>
      <td>${courseName}</td>
      <td class="cell-actions">
        <button class="btn u-edit" data-id="${u.userId}">Edit</button>
        <button class="btn ghost u-del" data-id="${u.userId}">Delete</button>
        <button class="btn ghost u-loginas" data-id="${u.userId}"><span class="spinner dark hidden"></span><span>Login as</span></button>
      </td>`;
    tbody.appendChild(tr);
  });

  $$('.u-edit').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.getAttribute('data-id');
      const u = state.admin.users.find(x=>x.userId===id);
      if (!u) return;
      $('#u-titlebar').textContent='Edit User';
      $('#u-edit-hint').classList.remove('hidden');
      hide($('#u-create')); show($('#u-update')); show($('#u-cancel'));
      $('#u-id').value = u.userId;
      $('#u-email').value = u.email || '';
      $('#u-role').value = u.role || 'assistant';
      $('#u-name').value = u.displayName || '';
      const cObj = state.admin.courses.find(c=> c.name===u.course || c.courseId===u.course);
      $('#u-course').value = cObj ? cObj.courseId : '';
      $('#u-msg').textContent='Editing…';
    });
  });
  $$('.u-del').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if (!confirm('Delete this user?')) return;
      try{ b.disabled = true; await api('admin.users.delete',{userId:b.getAttribute('data-id')}); $('#u-msg').textContent='Deleted ✅'; await loadUsers(); }
      catch(e){ $('#u-msg').textContent='Failed: '+e.message; }
      finally{ b.disabled = false; }
    });
  });
  $$('.u-loginas').forEach(b=>{
  b.addEventListener('click', async ()=>{
    const id = b.getAttribute('data-id');
    const spin = b.querySelector('.spinner');
    try {
      setLoading(b, true, spin);

      const res = await api('admin.users.loginAs', { userId:id });
      const t = res.token;

      // store token broadly
      ['auth_token','token'].forEach(k=>{
        try{ localStorage.setItem(k, t); }catch(_){}
        try{ sessionStorage.setItem(k, t); }catch(_){}
      });

      // clear cached user payloads
      ['me','user','current_user'].forEach(k=>{
        try{ localStorage.removeItem(k); }catch(_){}
        try{ sessionStorage.removeItem(k); }catch(_){}
      });

      // reload with new token
      location.replace(location.origin + location.pathname + location.search);
    } catch(e) {
      alert('Failed to login as user: '+e.message);
    } finally {
      setLoading(b, false, spin);
    }
  });
});
}
async function loadStudents(){
  setLoading($('#s-refresh'), true, $('#s-refresh-spin'));
  try{
    const r = await api('admin.students.list',{});
    state.admin.students = r.students || [];
    renderStudentsTable();
  } finally { setLoading($('#s-refresh'), false, $('#s-refresh-spin')); }
}
function renderStudentsTable(){
  const el = $('#s-table');
  const thead = el.querySelector('thead'); const tbody = el.querySelector('tbody');
  thead.innerHTML = '<tr><th>Name</th><th>Email</th><th>Course</th><th>Unit</th><th>Assistant</th><th>Status</th><th>Actions</th></tr>';
  tbody.innerHTML = '';
  state.admin.students.forEach(s=>{
    const asst = state.admin.assistants.find(a=> a.userId===s.assistantId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.studentName||''}</td>
      <td>${s.email||''}</td>
      <td>${s.course||''}</td>
      <td>${s.unit||''}</td>
      <td>${asst ? (asst.displayName||asst.email) : '—'}</td>
      <td>${badgeForStatus('student', s.status||'')}</td>
      <td class="cell-actions">
        <button class="btn s-edit" data-id="${s.studentId}">Edit</button>
      </td>`;
    tbody.appendChild(tr);
  });

  $$('.s-edit').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      const s = state.admin.students.find(x=>x.studentId===id);
      if (!s) return;
      $('#s-titlebar').textContent = 'Edit Student';
      $('#s-edit-hint').classList.remove('hidden');
      hide($('#s-create')); show($('#s-update')); show($('#s-cancel'));
      $('#s-id').value = s.studentId;
      $('#s-name').value = s.studentName || '';
      $('#s-email').value = s.email || '';
      $('#s-phone').value = s.phone || '';
      const c = state.admin.courses.find(cc=> cc.name===s.course || cc.courseId===s.course);
      $('#s-course').value = c ? c.courseId : '';
      $('#s-unit').value = s.unit || '';
      fillAssistantSelectForCourse($('#s-assistant'), $('#s-course').value);
      $('#s-assistant').value = s.assistantId || '';
      $('#s-status').value = s.status || 'Active';
      $('#s-msg').textContent = 'Editing…';
    });
  });
}
async function loadCourses(){
  const res = await api('admin.courses.list', {});
  state.admin.courses = res.courses || [];
  const rows = state.admin.courses.map(c=>[
    `<b>${c.name}</b><div class="muted">${c.code}</div>`,
    `${c.status}`,
    formatDateDisplay(c.createdAt, state.branding.dateFormat),
    `<div class="cell-actions">
       <button data-id="${c.courseId}" class="btn c-edit">Edit</button>
       <button data-id="${c.courseId}" class="btn ghost c-del">Delete</button>
     </div>`
  ]);
  makeTable($('#c-table'), ['Course','Status','Created','Actions'], rows);

  $$('#c-table .c-del').forEach(b=> b.addEventListener('click', async e=>{
    const id = e.target.getAttribute('data-id');
    if (!confirm('Delete this course?')) return;
    try{
      e.target.disabled = true;
      await api('admin.courses.delete',{courseId:id}); $('#c-msg').textContent='Deleted ✅';
      await loadCourses(); fillCourseSelect($('#u-course')); fillCourseSelect($('#s-course')); fillCourseSelect($('#e-courseId'));
    }catch(err){ $('#c-msg').textContent='Failed: '+err.message; }
    finally{ e.target.disabled = false; }
  }));
  $$('#c-table .c-edit').forEach(b=> b.addEventListener('click', ()=>{
    const id = b.getAttribute('data-id');
    const c = state.admin.courses.find(x=>x.courseId===id);
    if (!c) return;
    $('#c-titlebar').textContent='Edit Course';
    $('#c-edit-hint').classList.remove('hidden');
    hide($('#c-create')); show($('#c-update')); show($('#c-cancel'));
    $('#c-id').value = c.courseId;
    $('#c-name').value = c.name || '';
    $('#c-code').value = c.code || '';
    $('#c-status').value = c.status || 'Active';
    $('#c-msg').textContent='Editing…';
  }));
}
async function loadEnrollments(){
  const res = await api('admin.enroll.list', {});
  state.admin.enrollments = res.enrollments || [];

  // Build rows WITHOUT the ID column
  const rows = state.admin.enrollments.map(en=>{
    const course  = state.admin.courses.find(c=>c.courseId===en.courseId);
    const student = state.admin.students.find(s=>s.studentId===en.studentId);
    return [
      `${student ? student.studentName : (en.studentId || '')}`,
      `${course ? course.name : (en.courseId || '')}`,
      en.subgroupId || '',
      `${formatDateDisplay(en.startDate, state.branding.dateFormat)} → ${formatDateDisplay(en.endDate, state.branding.dateFormat)}`,
      badgeForStatus('enroll', en.status || ''),
      `<button data-id="${en.enrollmentId}" class="btn e-edit">Edit</button>
       <button data-id="${en.enrollmentId}" class="btn ghost e-del">Delete</button>`
    ];
  });

  makeTable($('#e-table'), ['Student','Course','Subgroup','Period','Status','Actions'], rows);

  // wire delete / edit (unchanged logic)
  $$('#e-table .e-del').forEach(b=> b.addEventListener('click', async e=>{
    const id = e.target.getAttribute('data-id');
    if (!confirm('Delete this enrollment?')) return;
    try{
      e.target.disabled = true;
      await api('admin.enroll.delete',{enrollmentId:id});
      $('#e-msg').textContent='Deleted ✅';
      await loadEnrollments();
    }catch(e2){ $('#e-msg').textContent='Failed: '+e2.message; }
    finally{ e.target.disabled = false; }
  }));

  $$('#e-table .e-edit').forEach(b=> b.addEventListener('click', ()=>{
    const id = b.getAttribute('data-id');
    const en = state.admin.enrollments.find(x=>x.enrollmentId===id);
    if (!en) return;
    $('#e-titlebar').textContent='Edit Enrollment';
    $('#e-edit-hint').classList.remove('hidden');
    hide($('#e-create')); show($('#e-update')); show($('#e-cancel'));
    $('#e-id').value = en.enrollmentId;
    $('#e-studentId').value = en.studentId || '';
    $('#e-courseId').value = en.courseId || '';
    $('#e-subgroupId').value = en.subgroupId || '';
    $('#e-start').value = formatDateForInput(en.startDate || '');
    $('#e-end').value = formatDateForInput(en.endDate || '');
    $('#e-status').value = en.status || 'Active';
    $('#e-msg').textContent='Editing…';
  }));
}
async function loadRoles(){
  try{
    const r = await api('admin.roles.list',{});
    state.admin.roles = r.roles || [];
    const sel = $('#p-role'); sel.innerHTML='';
    state.admin.roles.forEach(rr=>{ const o=document.createElement('option'); o.value=rr.role; o.textContent=`${rr.role} — ${rr.description||''}`; sel.appendChild(o); });
    if (!state.admin.currentRole && state.admin.roles[0]) state.admin.currentRole = state.admin.roles[0].role;
  }catch(e){}
}
async function loadPerms(role){
  try{
    setLoading($('#p-load'), true, $('#p-load-spin'));
    const p = await api('admin.rolePerms.list',{role});
    state.admin.perms = p.perms || [];
    const tbody = $('#p-table tbody'); tbody.innerHTML='';
    const keys = new Set(state.admin.perms.map(x=>x.permKey));
    if (keys.size===0){
      ['user.manage','student.manage','course.manage','enroll.manage','perm.manage','branding.edit','cors.manage','assignment.create','checks.submit']
        .forEach(k=> keys.add(k));
    }
    [...keys].sort().forEach(k=>{
      const rec = state.admin.perms.find(x=>x.permKey===k);
      const enabled = rec ? (String(rec.enabled)==='true' || rec.enabled===true) : false;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${k}</td><td><input type="checkbox" class="p-toggle" data-key="${k}" ${enabled?'checked':''}></td>`;
      tbody.appendChild(tr);
    });
    $$('#p-table .p-toggle').forEach(cb=>{
      cb.addEventListener('change', async e=>{
        e.target.disabled = true;
        try{ await api('admin.rolePerms.set',{role, permKey:e.target.getAttribute('data-key'), enabled:e.target.checked}); }
        finally{ e.target.disabled = false; }
      });
    });
  }finally{
    setLoading($('#p-load'), false, $('#p-load-spin'));
  }
}
async function loadBrandingUI(){
  try{
    const r = await api('admin.branding.get',{});
    const b = r.branding || {};
    state.branding = {...state.branding, ...b};
    $('#b-primary').value = b.primaryColor || state.branding.primaryColor;
    $('#b-accent').value  = b.accentColor || state.branding.accentColor;
    $('#b-date').value    = b.dateFormat || state.branding.dateFormat;
    applyBranding({ logoUrl: b.logoUrl || state.branding.logoUrl, primaryColor:$('#b-primary').value, accentColor:$('#b-accent').value });
  }catch(e){
    try{
      const pub = await api('public.config', {});
      if (pub && pub.branding){
        applyBranding({ ...pub.branding, logoUrl: pub.branding.logoUrl || state.branding.logoUrl });
      }
    }catch(_){}
  }
}
async function loadCors(){
  try{
    const r = await api('admin.cors.list',{});
    const arr = r.origins || [];
    $('#cors-origins').value = arr.join(', ');
  }catch(e){}
}

// EVENTS
function wireUserEvents(){
  $('#u-create')?.addEventListener('click', async()=>{
    const btn = $('#u-create'); const spin = $('#u-create-spin');
    setLoading(btn,true,spin);
    try{
      const email=$('#u-email').value.trim(), role=$('#u-role').value, displayName=$('#u-name').value.trim();
      const courseOpt=$('#u-course').value;
      await api('admin.users.create',{email, role, displayName, course:courseOpt});
      $('#u-msg').textContent='Created ✅';
      $('#u-email').value=''; $('#u-name').value=''; $('#u-course').value='';
      await loadUsers();
    }catch(e){ $('#u-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#u-update')?.addEventListener('click', async()=>{
    const btn = $('#u-update'); const spin = $('#u-update-spin');
    setLoading(btn,true,spin);
    try{
      const id = $('#u-id').value;
      const patch = {
        email: $('#u-email').value.trim(),
        role: $('#u-role').value,
        displayName: $('#u-name').value.trim(),
        course: $('#u-course').value
      };
      await api('admin.users.update',{userId:id, patch});
      $('#u-msg').textContent='Updated ✅';
      $('#u-titlebar').textContent='Create User';
      $('#u-edit-hint').classList.add('hidden');
      show($('#u-create')); hide($('#u-update')); hide($('#u-cancel'));
      $('#u-id').value=''; $('#u-email').value=''; $('#u-name').value=''; $('#u-course').value='';
      await loadUsers();
    }catch(e){ $('#u-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#u-cancel')?.addEventListener('click', ()=>{
    $('#u-titlebar').textContent='Create User';
    $('#u-edit-hint').classList.add('hidden');
    show($('#u-create')); hide($('#u-update')); hide($('#u-cancel'));
    $('#u-id').value=''; $('#u-email').value=''; $('#u-name').value=''; $('#u-course').value='';
  });
  $('#u-refresh')?.addEventListener('click', loadUsers);
  $('#u-search')?.addEventListener('input', ()=>{ clearTimeout(window._u_t); window._u_t=setTimeout(loadUsers,300); });
  $('#u-filter-role')?.addEventListener('change', loadUsers);
}
function wireStudentEvents(){
  $('#s-create')?.addEventListener('click', async()=>{
    const btn = $('#s-create'); const spin = $('#s-create-spin');
    setLoading(btn,true,spin);
    try{
      const name=$('#s-name').value.trim(), email=$('#s-email').value.trim();
      const phone=$('#s-phone').value.trim(), courseId=$('#s-course').value, unit=$('#s-unit').value.trim();const selStatus = $('#s-status').value || 'Active';   // <- capture before clearing
      if(!name){ $('#s-msg').textContent='Name required'; return; }
      let courseForStudent = '';
      if (courseId){
        const c = state.admin.courses.find(cc=>cc.courseId===courseId);
        courseForStudent = c ? c.courseId : '';
      }
      await api('admin.students.create',{
  studentName:name, email, phone,
  course:courseForStudent, unit,
  assistantId: $('#s-assistant').value,
  status: selStatus
});
      $('#s-msg').textContent='Created ✅';
      $('#s-name').value=''; $('#s-email').value=''; $('#s-phone').value=''; $('#s-course').value=''; $('#s-unit').value='';$('#s-assistant').value = '';
$('#s-status').value = 'Active';
      await Promise.all([loadStudents(), loadEnrollments(), fillStudentSelect($('#e-studentId'))]);
    const created = (state.admin.students||[]).find(ss => ss.email===email && ss.studentName===name);
    if (created) {
      await syncEnrollmentsFromStudent(created.studentId, selStatus);
      await Promise.all([loadStudents(), loadEnrollments()]); // show the new status pills everywhere
    }
    }catch(e){ $('#s-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#s-update')?.addEventListener('click', async()=>{
    const btn = $('#s-update'); const spin = $('#s-update-spin');
    setLoading(btn,true,spin);
    try{
      const id = $('#s-id').value;
      const patch = {
  studentName: $('#s-name').value.trim(),
  email: $('#s-email').value.trim(),
  phone: $('#s-phone').value.trim(),
  course: $('#s-course').value,
  unit: $('#s-unit').value.trim(),
  assistantId: $('#s-assistant').value,
  status: $('#s-status').value
};
      await api('admin.students.update',{studentId:id, patch});
      await syncEnrollmentsFromStudent(id, $('#s-status').value);
      $('#s-msg').textContent='Updated ✅';
      $('#s-titlebar').textContent='Create Student';
      $('#s-edit-hint').classList.add('hidden');
      show($('#s-create')); hide($('#s-update')); hide($('#s-cancel'));
      $('#s-id').value=''; $('#s-name').value=''; $('#s-email').value=''; $('#s-phone').value=''; $('#s-course').value=''; $('#s-unit').value='';
      await loadStudents(); fillStudentSelect($('#e-studentId'));
    }catch(e){ $('#s-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#s-cancel')?.addEventListener('click', ()=>{
    $('#s-titlebar').textContent='Create Student';
    $('#s-edit-hint').classList.add('hidden');
    show($('#s-create')); hide($('#s-update')); hide($('#s-cancel'));
    $('#s-id').value=''; $('#s-name').value=''; $('#s-email').value=''; $('#s-phone').value=''; $('#s-course').value=''; $('#s-unit').value='';$('#s-assistant').value = '';
$('#s-status').value = 'Active';
  });
  $('#s-refresh')?.addEventListener('click', loadStudents);
  $('#s-search')?.addEventListener('input', ()=>{
    const q = $('#s-search').value.toLowerCase();
    const tbody = $('#s-table tbody');
    Array.from(tbody.rows).forEach(row=>{
      const text = row.innerText.toLowerCase();
      row.style.display = text.includes(q)? '' : 'none';
    });
  });
  $('#s-course')?.addEventListener('change', ()=>{
  fillAssistantSelectForCourse($('#s-assistant'), $('#s-course').value);
});
}
function wireCourseEvents(){
  $('#c-create')?.addEventListener('click', async()=>{
    const btn = $('#c-create'); const spin = $('#c-create-spin');
    setLoading(btn,true,spin);
    try{
      await api('admin.courses.create',{name:$('#c-name').value.trim(), code:$('#c-code').value.trim(), status:$('#c-status').value});
      $('#c-msg').textContent='Created ✅';
      $('#c-name').value=''; $('#c-code').value='';
      await loadCourses(); fillCourseSelect($('#u-course')); fillCourseSelect($('#s-course')); fillCourseSelect($('#e-courseId'));
    }catch(e){ $('#c-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#c-update')?.addEventListener('click', async()=>{
    const btn = $('#c-update'); const spin = $('#c-update-spin');
    setLoading(btn,true,spin);
    try{
      const id = $('#c-id').value;
      const patch = { name: $('#c-name').value.trim(), code: $('#c-code').value.trim(), status: $('#c-status').value };
      await api('admin.courses.update',{courseId:id, patch});
      $('#c-msg').textContent='Updated ✅';
      $('#c-titlebar').textContent='Create Course';
      $('#c-edit-hint').classList.add('hidden');
      show($('#c-create')); hide($('#c-update')); hide($('#c-cancel'));
      $('#c-id').value=''; $('#c-name').value=''; $('#c-code').value=''; $('#c-status').value='Active';
      await loadCourses(); fillCourseSelect($('#u-course')); fillCourseSelect($('#s-course')); fillCourseSelect($('#e-courseId'));
    }catch(e){ $('#c-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#c-cancel')?.addEventListener('click', ()=>{
    $('#c-titlebar').textContent='Create Course';
    $('#c-edit-hint').classList.add('hidden');
    show($('#c-create')); hide($('#c-update')); hide($('#c-cancel'));
    $('#c-id').value=''; $('#c-name').value=''; $('#c-code').value=''; $('#c-status').value='Active';
  });
}
function wireEnrollEvents(){
  $('#e-create')?.addEventListener('click', async()=>{
    const btn = $('#e-create'); const spin = $('#e-create-spin');
    setLoading(btn,true,spin);
    try{
      const studentId=$('#e-studentId').value, courseId=$('#e-courseId').value;
      const subgroupId=$('#e-subgroupId').value.trim(), startDate=$('#e-start').value, endDate=$('#e-end').value;
      if(!studentId || !courseId){ $('#e-msg').textContent='Student & Course required'; return; }
      await api('admin.enroll.create',{
  studentId, courseId, subgroupId, startDate, endDate,
  status: $('#e-status').value || 'Active'
});
      await syncStudentFromEnrollment($('#e-studentId').value, $('#e-status').value || 'Active');
      await Promise.all([loadEnrollments(), loadStudents()]);
      $('#e-msg').textContent='Created ✅';
      $('#e-id').value=''; $('#e-studentId').value=''; $('#e-courseId').value=''; $('#e-subgroupId').value=''; $('#e-start').value=''; $('#e-end').value='';$('#e-status').value = 'Active';
    }catch(e){ $('#e-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#e-update')?.addEventListener('click', async()=>{
  const btn = $('#e-update'); const spin = $('#e-update-spin');
  setLoading(btn,true,spin);
  try{
    const id = $('#e-id').value;
    const patch = {
      studentId: $('#e-studentId').value,
      courseId: $('#e-courseId').value,
      subgroupId: $('#e-subgroupId').value.trim(),
      startDate: $('#e-start').value,
      endDate: $('#e-end').value,
      status: $('#e-status').value || 'Active'
    };
    await api('admin.enroll.update', { enrollmentId:id, patch }); // ✅ correct shape
    await syncStudentFromEnrollment($('#e-studentId').value, $('#e-status').value || 'Active');
    await Promise.all([loadEnrollments(), loadStudents()]);

    $('#e-msg').textContent='Updated ✅';
    $('#e-titlebar').textContent='Create Enrollment';
    $('#e-edit-hint').classList.add('hidden');
    show($('#e-create')); hide($('#e-update')); hide($('#e-cancel'));
    $('#e-id').value=''; $('#e-studentId').value=''; $('#e-courseId').value='';
    $('#e-subgroupId').value=''; $('#e-start').value=''; $('#e-end').value='';
    $('#e-status').value='Active';
  }catch(e){ $('#e-msg').textContent='Failed: '+e.message; }
  finally{ setLoading(btn,false,spin); }
});
  $('#e-cancel')?.addEventListener('click', ()=>{
    $('#e-titlebar').textContent='Create Enrollment';
    $('#e-edit-hint').classList.add('hidden');
    show($('#e-create')); hide($('#e-update')); hide($('#e-cancel'));
    $('#e-id').value=''; $('#e-studentId').value=''; $('#e-courseId').value=''; $('#e-subgroupId').value=''; $('#e-start').value=''; $('#e-end').value='';$('#e-status').value = 'Active';
  });
  $('#e-refresh')?.addEventListener('click', async ()=>{
    const btn = $('#e-refresh'); const spin = $('#e-refresh-spin');
    setLoading(btn, true, spin);
    try{
      await loadEnrollments();
    } finally {
      setLoading(btn, false, spin);
    }
  });
}
function wirePermsEvents(){
  $('#p-load')?.addEventListener('click', async ()=>{
    const role = $('#p-role').value;
    if (!role) return;
    state.admin.currentRole = role;
    await loadPerms(role);
  });
}
function wireDataIOEvents(){
  $('#io-import')?.addEventListener('click', async()=>{
    const btn = $('#io-import'); const spin = $('#io-import-spin');
    setLoading(btn,true,spin);
    try{
      const type = $('#io-type').value;
      const csv = $('#io-csv').value;
      if (type==='users'){ await api('admin.import.users',{csv}); }
      else { await api('admin.import.students',{csv}); }
      $('#io-msg').textContent='Imported ✅';
      await Promise.all([loadUsers(), loadStudents()]);
    }catch(e){ $('#io-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
  $('#io-export-users')?.addEventListener('click', async()=>{
    const r = await api('admin.export.users',{}); downloadCSV('users', r.csv||'');
  });
  $('#io-export-students')?.addEventListener('click', async()=>{
    const r = await api('admin.export.students',{}); downloadCSV('students', r.csv||'');
  });
  $('#io-template-users')?.addEventListener('click', async()=>{
    const r = await api('admin.export.templateUsers',{}); downloadCSV('users_template', r.csv||'');
  });
  $('#io-template-students')?.addEventListener('click', async()=>{
    const r = await api('admin.export.templateStudents',{}); downloadCSV('students_template', r.csv||'');
  });
}
function wireBrandingCorsEvents(){
  $('#b-save')?.addEventListener('click', async ()=>{
    const btn = $('#b-save'); const spin = $('#b-save-spin');
    setLoading(btn,true,spin);
    try{
      let logoUrl = state.branding.logoUrl || '';
      const file = $('#b-logo-file').files?.[0];
      if (file){
        const up = await uploadFileBase64(file, { action:'admin.uploadBrandAsset' });
        logoUrl = up.fileUrl || logoUrl;
      }
      const branding = {
        primaryColor: $('#b-primary').value || '#1F3C88',
        accentColor:  $('#b-accent').value || '#6BCB77',
        dateFormat:   $('#b-date').value   || 'yyyy-MM-dd',
        logoUrl:      logoUrl
      };
      await api('admin.branding.set',{branding});
      applyBranding(branding);
      $('#b-msg').textContent = 'Saved & applied ✅';
    }catch(e){ $('#b-msg').textContent = 'Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); if($('#b-logo-file')) $('#b-logo-file').value=''; }
  });

  $('#cors-save')?.addEventListener('click', async ()=>{
    const btn = $('#cors-save'); const spin = $('#cors-save-spin');
    setLoading(btn,true,spin);
    try{
      const list = ($('#cors-origins').value||'').split(',').map(s=>s.trim()).filter(Boolean);
      await api('admin.cors.set',{origins:list});
      $('#cors-msg').textContent='Saved ✅';
    }catch(e){ $('#cors-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
  });
}

// HTML LOADER
async function loadTabHtml(tabId, path){
  const host = document.getElementById(tabId);
  if (!host.dataset.loaded){
    host.innerHTML = await (await fetch(path)).text();
    host.dataset.loaded = '1';
  }
}

export async function init(){
  showPageLoader(true);
  try{
    await loadTabHtml('adm-users',    'views/roles/admin/tabs/users.html');
    await loadTabHtml('adm-students', 'views/roles/admin/tabs/students.html');
    await loadTabHtml('adm-courses',  'views/roles/admin/tabs/courses.html');
    await loadTabHtml('adm-enroll',   'views/roles/admin/tabs/enrollments.html');
    await loadTabHtml('adm-perms',    'views/roles/admin/tabs/perms.html');
    await loadTabHtml('adm-data',     'views/roles/admin/tabs/data.html');
    await loadTabHtml('adm-brand',    'views/roles/admin/tabs/brand.html');

    wireTabs('#view-admin');

    // initial loads (same sequence as original loadAdmin)
    await Promise.all([loadBrandingUI(), loadCors(), loadCourses(), loadAssistants(), loadUsers(), loadStudents(), loadEnrollments(), loadRoles()]);
    fillCourseSelect($('#u-course'));
    fillCourseSelect($('#s-course'));
    fillAssistantSelectForCourse($('#s-assistant'), $('#s-course').value);
    fillCourseSelect($('#e-courseId'));
    fillStudentSelect($('#e-studentId'));

    // wire everything
    wireUserEvents();
    wireStudentEvents();
    wireCourseEvents();
    wireEnrollEvents();
    wirePermsEvents();
    wireDataIOEvents();
    wireBrandingCorsEvents();
  } finally { showPageLoader(false); }
}
