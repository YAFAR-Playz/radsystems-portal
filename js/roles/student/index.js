// js/roles/student/index.js
import { wireTabs } from '../../core/tabs.js';
import { $, $$, showPageLoader, setLoading } from '../../core/dom.js';
import { api, uploadFileBase64 } from '../../core/api.js';
import { state } from '../../core/state.js';
import { formatDateDisplay, parseMaybeISO } from '../../core/date.js';

async function loadTabHtml(tabId, path){
  const host = document.getElementById(tabId);
  if (!host?.dataset.loaded){
    host.innerHTML = await (await fetch(path)).text();
    host.dataset.loaded = '1';
  }
}

// ------------ helpers ------------
function badgeHtmlByKey(key, fallback=''){
  const k = String(key||'').toLowerCase();
  if (k==='submitted') return '<span class="badge ok">Submitted</span>';
  if (k==='late')      return '<span class="badge warn">Submitted Late</span>';
  if (k==='missing')   return '<span class="badge danger">Missing</span>';
  if (k==='pending')   return '<span class="badge info">Pending</span>';
  if (k==='checked')   return '<span class="badge ok">Checked</span>';
  if (k==='redo')      return '<span class="badge warn">Redo</span>';
  if (k==='open')      return '<span class="badge ok">Open</span>';
  if (k==='closed')    return '<span class="badge warn">Closed</span>';
  if (k==='-')         return '<span class="muted">—</span>';
  return fallback || '<span class="badge">—</span>';
}

function studentOpenNow(asg){
  const open = (asg.studentOpen === true || String(asg.studentOpen)==='true');
  if (!open) return false;
  const dl = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (dl && new Date() > dl) return false;
  return true;
}

function mySubmissionFor(asg){
  // Placeholder: when wired, search state.student.submissions
  // return { fileUrl, submittedAtISO } if exists
  if (!Array.isArray(state.student?.submissions)) return null;
  return state.student.submissions.find(s => s.assignmentId===asg.assignmentId) || null;
}

function mySubmissionStatus(asg){
  const sub = mySubmissionFor(asg);
  const dl = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (sub){
    const t = parseMaybeISO(sub.submittedAtISO || sub.createdAt || sub.updatedAt);
    const late = dl && t && t > dl;
    return late ? 'late' : 'submitted';
  }
  if (dl && new Date() > dl) return 'missing';
  return 'pending';
}

function feedbackFor(asg){
  // Assistant check visible to student
  if (!Array.isArray(state.student?.checks)) return null;
  return state.student.checks.find(c => c.assignmentId===asg.assignmentId) || null;
}

// ------------ renderers ------------
function renderHome(){
  const s = state.student || { assignments: [], submissions: [], checks: [] };
  const open = s.assignments.filter(studentOpenNow);

  // KPIs
  const dueThisWeek = open.filter(a=>{
    const dl = parseMaybeISO(a.studentDeadline || a.deadline);
    if (!dl) return false;
    const now = new Date();
    const in7 = new Date(); in7.setDate(now.getDate()+7);
    return dl >= now && dl <= in7;
  }).length;

  const submittedCount = s.assignments.filter(a => mySubmissionStatus(a)==='submitted' || mySubmissionStatus(a)==='late').length;

  $('#s-kpi-open')?.append(document.createTextNode(String(open.length)));
  $('#s-kpi-due')?.append(document.createTextNode(String(dueThisWeek)));
  $('#s-kpi-submitted')?.append(document.createTextNode(String(submittedCount)));

  // Upcoming table
  const tbody = $('#s-home-upcoming');
  if (!tbody) return;
  tbody.innerHTML = '';

  open
    .slice() // copy
    .sort((a,b)=>{
      const da = parseMaybeISO(a.studentDeadline||a.deadline)?.getTime() ?? 0;
      const db = parseMaybeISO(b.studentDeadline||b.deadline)?.getTime() ?? 0;
      return da - db;
    })
    .forEach(asg=>{
      const due = formatDateDisplay(asg.studentDeadline || asg.deadline, state.branding?.dateFormat);
      const statusKey = mySubmissionStatus(asg);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${asg.title}</b></td>
        <td>${asg.course||''}</td>
        <td>${asg.unit||''}</td>
        <td>${due||''}</td>
        <td>${badgeHtmlByKey(statusKey)}</td>
        <td><a class="btn" href="#/student/assignments">Open</a></td>
      `;
      tbody.appendChild(tr);
    });
}

function renderProfile(){
  const u = state.user || {};
  $('#s-prof-name')?.append(document.createTextNode(u.displayName || u.name || '—'));
  $('#s-prof-email')?.append(document.createTextNode(u.email || '—'));
  $('#s-prof-course')?.append(document.createTextNode(u.course || '—'));
  $('#s-prof-unit')?.append(document.createTextNode(u.unit || '—'));
}

function renderAssignments(){
  const s = state.student || { assignments: [] };
  const tbody = $('#s-assignments-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  s.assignments.forEach(asg=>{
    const sub = mySubmissionFor(asg);
    const fb  = feedbackFor(asg);

    const due = formatDateDisplay(asg.studentDeadline || asg.deadline, state.branding?.dateFormat);
    const subKey = mySubmissionStatus(asg);

    const myFile = sub?.fileUrl
      ? `<a href="${sub.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';

    const fbStatus = fb?.status ? String(fb.status).trim().toLowerCase() : '';
    const fbBadge =
      fbStatus ? badgeHtmlByKey(fbStatus) :
      '<span class="muted">—</span>';

    const fbFile = fb?.fileUrl
      ? `<a href="${fb.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${asg.title}</td>
      <td>${asg.course||''}</td>
      <td>${asg.unit||''}</td>
      <td>${due||''}</td>
      <td>${badgeHtmlByKey(subKey)}</td>
      <td>${myFile}</td>
      <td>${fbBadge}</td>
      <td>${fb?.grade || '<span class="muted">—</span>'}</td>
      <td>${fb?.comment ? String(fb.comment).replace(/</g,'&lt;') : '<span class="muted">—</span>'}</td>
      <td>${fbFile}</td>
      <td>
        <label class="btn">
          Upload
          <input type="file" class="s-upload" data-asg="${asg.assignmentId}" style="display:none;">
        </label>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // wire uploads
  $$('.s-upload').forEach(inp=>{
    inp.onchange = async ()=>{
      const assignmentId = inp.getAttribute('data-asg');
      const file = inp.files?.[0];
      if (!file) return;

      const btn = inp.closest('label.btn');
      const spin = null; // optional: add spinner span inside the label if you want
      setLoading(btn, true, spin);

      try{
        // Upload, then submit/update the student's submission record
        const up = await uploadFileBase64(file, { action:'student.uploadSubmission', assignmentId });
        const payload = { assignmentId, fileUrl: up?.fileUrl || null };
        // If you later support delete, send null fileUrl to clear.
        await api('submitStudentSubmission', payload);
        $('#s-submit-msg').textContent = 'Uploaded ✅';
        await reloadStudentUI();
      }catch(e){
        $('#s-submit-msg').textContent = 'Upload failed: ' + e.message;
      }finally{
        setLoading(btn, false, spin);
        inp.value = '';
      }
    };
  });
}

// ------------ data ------------
async function loadStudentData(demo=false){
  if (demo){
    // Demo data mirrors the patterns in head/assistant
    state.student = {
      assignments: [
        { assignmentId:'as1', title:'Homework 5', course:'Math', unit:'U1', studentOpen:true, assistantOpen:true, deadline:'2025-09-10', studentDeadline:'2025-09-10', assistantDeadline:'2025-09-12' },
        { assignmentId:'as2', title:'Quiz 2 Review', course:'Math', unit:'U2', studentOpen:true, assistantOpen:true, deadline:'2025-09-15', studentDeadline:'2025-09-15', assistantDeadline:'' },
      ],
      submissions: [
        { assignmentId:'as1', fileUrl:'', submittedAtISO: new Date(Date.now()-1*86400e3).toISOString() },
      ],
      checks: [
        // becomes visible to student after assistant checks
        { assignmentId:'as1', status:'Checked', grade:'18/20', comment:'Good job', fileUrl:'' },
      ],
    };
  } else {
    const res = await api('getStudentDashboard', {});
    state.student = Object.assign({}, res);
  }
}

// ------------ lifecycle ------------
async function reloadStudentUI(){
  await loadStudentData(reloadStudentUI._demo || false);
  renderHome();
  renderAssignments();
  renderProfile();
}

export async function mount(){
  showPageLoader(true);
  try{
    await loadTabHtml('s-home',         'views/roles/student/tabs/home.html');
    await loadTabHtml('s-assignments',  'views/roles/student/tabs/assignments.html');
    await loadTabHtml('s-assignments',  'views/roles/student/tabs/performance.html');
    await loadTabHtml('s-profile',      'views/roles/student/tabs/profile.html');
    wireTabs('#view-student');
  } finally {
    showPageLoader(false);
  }
}

export async function boot(demo=false){
  reloadStudentUI._demo = !!demo;
  showPageLoader(true);
  try{
    await loadStudentData(!!demo);
    renderHome();
    renderAssignments();
    renderProfile();
  } finally {
    showPageLoader(false);
  }
}
