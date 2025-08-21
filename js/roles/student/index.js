// js/roles/student/index.js
import { wireTabs } from '../../core/tabs.js';
import { $, $$, show, hide, showPageLoader, bindAsyncClick } from '../../core/dom.js';
import { api, uploadFileBase64 } from '../../core/api.js';
import { state } from '../../core/state.js';
import { formatDateDisplay, formatDateForInput, parseMaybeISO } from '../../core/date.js';

// ===================== partial loader ===================== //
async function loadTabHtml(tabId, path){
  const host = document.getElementById(tabId);
  if (!host) return;
  if (!host.dataset.loaded){
    host.innerHTML = await (await fetch(path)).text();
    host.dataset.loaded = '1';
  }
}

// ===================== helpers ===================== //
function studentOpenNow(asg){
  const open = (asg.studentOpen === true || String(asg.studentOpen) === 'true');
  if (!open) return false;
  const dl = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (dl && new Date() > dl) return false;
  return true;
}
function assistantOpenNow(asg){
  const open = (asg.assistantOpen===true || String(asg.assistantOpen)==='true');
  if (!open) return false;
  if (asg.assistantDeadline){
    const dl = parseMaybeISO(asg.assistantDeadline);
    if (dl && new Date() > dl) return false;
  }
  return true;
}

// Show submission status from the student's perspective
// submission = { fileUrl, submittedAtISO }
// checks[] are assistant feedback records for this student/assignment
function submissionStatus(asg, submission){
  const dl = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (submission){
    const t = parseMaybeISO(submission.submittedAtISO || submission.createdAt || submission.updatedAt);
    const late = dl && t && t > dl;
    return late ? 'late' : 'submitted';
  }
  if (dl && new Date() > dl) return 'missing';
  return 'pending';
}

// Mirrors style in other roles
function badgeHtmlByKey(key, fallback=''){
  const k = String(key||'').toLowerCase();
  if (k==='submitted') return '<span class="badge ok">Submitted</span>';
  if (k==='late')      return '<span class="badge warn">Submitted Late</span>';
  if (k==='missing')   return '<span class="badge danger">Missing</span>';
  if (k==='pending')   return '<span class="badge info">Pending</span>';
  if (k==='checked')   return '<span class="badge ok">Checked</span>';
  if (k==='redo')      return '<span class="badge warn">Redo</span>';
  if (k==='unchecked') return '<span class="badge danger">Unchecked</span>'; // for visibility if shown
  if (k==='open')      return '<span class="badge ok">Open</span>';
  if (k==='closed')    return '<span class="badge warn">Closed</span>';
  if (k==='-')         return '<span class="muted">—</span>';
  return fallback || '<span class="badge">—</span>';
}

// ===================== data ===================== //
// state.student shape (server): { me:{studentId, name, course}, assignments[], submissions[], checks[] }
async function loadStudentData(demo=false){
  if (demo){
    state.student = state.student || {};
    state.student.me = { studentId:'s1', studentName:'Omar Hassan', course:'Math' };
    state.student.assignments = [
      { assignmentId:'as1', title:'Homework 5', course:'Math', unit:'U1',
        requireGrade:true, studentOpen:true, assistantOpen:true,
        studentDeadline:'2025-09-10', assistantDeadline:'2025-09-12', studentFileUrl:'' },
      { assignmentId:'as2', title:'Quiz 2 Review', course:'Math', unit:'U2',
        requireGrade:false, studentOpen:true, assistantOpen:true,
        studentDeadline:'2025-09-15', assistantDeadline:'', studentFileUrl:'' },
    ];
    // One submitted, one not
    state.student.submissions = [
      { assignmentId:'as1', studentId:'s1', fileUrl:'', submittedAtISO:new Date(Date.now()-1*86400e3).toISOString() }
    ];
    // Assistant feedback on as1
    state.student.checks = [
      { checkId:'c1', assignmentId:'as1', studentId:'s1', status:'Checked', grade:'18/20', comment:'Great work', fileUrl:'' }
    ];
    return;
  }
  const res = await api('getStudentDashboard',{}); // <- implement server
  Object.assign(state.student, res);
}

function mySubmissionFor(asg){
  return (state.student?.submissions || []).find(s => s.assignmentId===asg.assignmentId) || null;
}
function myCheckFor(asg){
  return (state.student?.checks || []).find(c => c.assignmentId===asg.assignmentId) || null;
}

// ===================== renderers ===================== //
function renderHome(){
  const st = state.student || { assignments:[], submissions:[], checks:[] };
  const asgs = st.assignments || [];
  const subs = st.submissions || [];
  const checks = st.checks || [];

  const openCount = asgs.filter(studentOpenNow).length;
  const submittedThisWeek = subs.filter(s=>{
    const t = new Date(s.submittedAtISO || s.createdAt || 0).getTime();
    return Date.now() - t < 7*86400e3;
  }).length;
  const missingNow = asgs.filter(a=>{
    const dl = parseMaybeISO(a.studentDeadline || a.deadline);
    const hasSub = !!mySubmissionFor(a);
    return (dl && new Date() > dl && !hasSub);
  }).length;

  $('#s-kpi-open')?.replaceChildren(document.createTextNode(openCount));
  $('#s-kpi-week')?.replaceChildren(document.createTextNode(submittedThisWeek));
  $('#s-kpi-missing')?.replaceChildren(document.createTextNode(missingNow));

  // Recent feedback list (optional, if a container exists)
  const fb = $('#s-recent-feedback');
  if (fb){
    fb.innerHTML = '';
    // sort by recency
    const recent = [...checks].sort((a,b)=>{
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    }).slice(0,5);
    if (!recent.length){
      fb.innerHTML = '<div class="muted">No feedback yet.</div>';
    } else {
      recent.forEach(c=>{
        const asg = asgs.find(a=>a.assignmentId===c.assignmentId);
        const li = document.createElement('div');
        li.className='item';
        li.innerHTML = `<b>${asg?asg.title:c.assignmentId}</b>
                        <div>${badgeHtmlByKey((c.status||'').toLowerCase())} · ${c.grade||'—'}</div>
                        <div class="muted">${c.comment||''}</div>`;
        fb.appendChild(li);
      });
    }
  }
}

// Assignments list (read + submit inline)
function renderAssignments(){
  const st = state.student || { assignments:[] };
  const tbody = $('#s-assignments-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  (st.assignments||[]).forEach(asg=>{
    const mySub = mySubmissionFor(asg);
    const myChk = myCheckFor(asg);
    const subKey = submissionStatus(asg, mySub);

    const stuDL  = formatDateDisplay(asg.studentDeadline || asg.deadline, state.branding?.dateFormat);
    const asstDL = formatDateDisplay(asg.assistantDeadline || '', state.branding?.dateFormat);

    const myFile = mySub?.fileUrl
      ? `<a href="${mySub.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';

    const grade = myChk?.grade || '<span class="muted">—</span>';
    const comment = myChk?.comment ? String(myChk.comment).replace(/</g,'&lt;') : '<span class="muted">—</span>';
    const checkFile = myChk?.fileUrl
      ? `<a href="${myChk.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';

    // upload control enabled only if student side is open
    const open = studentOpenNow(asg);
    const uploadCell = `
      <div class="s-upload-wrap">
        <input type="file" class="s-file" data-as="${asg.assignmentId}" ${open?'':'disabled'} />
        <button class="btn s-upload" data-as="${asg.assignmentId}" ${open?'':'disabled'}>Submit</button>
        <div class="muted s-upload-msg" data-as="${asg.assignmentId}"></div>
      </div>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${asg.title}</b><div class="muted">${asg.course} · ${asg.unit||''}</div></td>
      <td>${badgeHtmlByKey(subKey)}</td>
      <td>${myFile}</td>
      <td>${grade}</td>
      <td>${comment}</td>
      <td>${checkFile}</td>
      <td>${stuDL || '<span class="muted">—</span>'}</td>
      <td>${asstDL || '<span class="muted">—</span>'}</td>
      <td>${uploadCell}</td>`;
    tbody.appendChild(tr);
  });
}

// Simple performance: donut of my statuses + list of grades
function renderPerformance(){
  const st = state.student || { assignments:[], submissions:[], checks:[] };
  const asgs = st.assignments || [];
  const subs = st.submissions || [];

  const counts = { Submitted:0, Late:0, Missing:0, Pending:0 };
  asgs.forEach(a=>{
    const s = submissionStatus(a, subs.find(x => x.assignmentId===a.assignmentId));
    if (s==='submitted') counts.Submitted++;
    else if (s==='late') counts.Late++;
    else if (s==='missing') counts.Missing++;
    else counts.Pending++;
  });

  const donutEl = $('#s-donut');
  if (donutEl) {
    if (donutEl._chart) donutEl._chart.destroy();
    // eslint-disable-next-line no-undef
    donutEl._chart = new Chart(donutEl, {
      type: 'doughnut',
      data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  // Grades table (if present)
  const gt = $('#s-grades-table tbody');
  if (gt){
    gt.innerHTML='';
    (st.checks || []).forEach(c=>{
      const asg = asgs.find(a=>a.assignmentId===c.assignmentId);
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${asg?asg.title:c.assignmentId}</td>
        <td>${c.grade||'—'}</td>
        <td>${(c.status||'')}</td>
        <td>${formatDateDisplay(c.updatedAt || c.createdAt || '') || '—'}</td>`;
      gt.appendChild(tr);
    });
  }
}

// ===================== actions/events ===================== //
function wireEvents(){
  // Submit buttons (delegated)
  $('#s-assignments-table')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.s-upload');
    if (!btn) return;

    const assignmentId = btn.getAttribute('data-as');
    const asg = (state.student?.assignments || []).find(a=>a.assignmentId===assignmentId);
    if (!asg) return;

    const fileInput = $('#s-assignments-table').querySelector(`.s-file[data-as="${assignmentId}"]`);
    const msgEl = $('#s-assignments-table').querySelector(`.s-upload-msg[data-as="${assignmentId}"]`);
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      if (msgEl) msgEl.textContent = 'Pick a file first.';
      return;
    }

    // Guard: still open?
    if (!studentOpenNow(asg)){
      if (msgEl) msgEl.textContent = 'Submission window is closed.';
      return;
    }

    try{
      // upload and submit
      const up = await uploadFileBase64(fileInput.files[0], { action:'student.uploadSubmission', assignmentId });
      const payload = { assignmentId, fileUrl: up?.fileUrl || '' };
      await api('submitStudentWork', payload); // implement server endpoint

      if (msgEl) msgEl.textContent = 'Submitted ✅';
      fileInput.value = '';
      // refresh data + rerender
      await init(false);
    }catch(err){
      if (msgEl) msgEl.textContent = 'Failed: '+ (err?.message || err);
    }
  });
}

// ===================== lifecycle ===================== //
export async function init(demo=false){
  showPageLoader(true);
  try{
    // Load tab shells (create these HTML files similar to other roles)
    await loadTabHtml('s-home',        'views/roles/student/tabs/home.html');
    await loadTabHtml('s-assignments', 'views/roles/student/tabs/assignments.html');
    await loadTabHtml('s-performance', 'views/roles/student/tabs/performance.html');

    wireTabs('#view-student');

    await loadStudentData(demo);
    renderHome();
    renderAssignments();
    renderPerformance();
    wireEvents();
  } finally {
    showPageLoader(false);
  }
}
