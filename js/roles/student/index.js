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
  const isOpenFlag = (asg.studentOpen === true || String(asg.studentOpen) === 'true');
  if (!isOpenFlag) return false;

  const now    = new Date();
  const stuDL  = parseMaybeISO(asg.studentDeadline || asg.deadline);
  const asstDL = parseMaybeISO(asg.assistantDeadline || '');

  // If any check says "Redo", ignore deadlines (student may resubmit anytime until status changes)
  const hasRedo = Array.isArray(state.student?.checks) &&
                  state.student.checks.some(c => c.assignmentId === asg.assignmentId &&
                    String(c.status||'').trim().toLowerCase() === 'redo');
  if (hasRedo) return true;

  // Normal/late window: open until student deadline; after that, keep open until assistant deadline
  if (stuDL && now > stuDL){
    if (asstDL && now <= asstDL) return true;  // late window
    return false;                               // fully closed
  }
  return true; // before student deadline
}

function mySubmissionFor(asg){
  // Placeholder: when wired, search state.student.submissions
  // return { fileUrl, submittedAtISO } if exists
  if (!Array.isArray(state.student?.submissions)) return null;
  return state.student.submissions.find(s => s.assignmentId===asg.assignmentId) || null;
}

function mySubmissionStatus(asg){
  const sub   = mySubmissionFor(asg);
  const stuDL = parseMaybeISO(asg.studentDeadline || asg.deadline);
  const asstDL= parseMaybeISO(asg.assistantDeadline || '');

  if (sub){
    // NOTE: backend uses "submittedAt"
    const t = parseMaybeISO(sub.submittedAt || sub.submittedAtISO || sub.createdAt || sub.updatedAt);
    if (t && stuDL && t > stuDL){
      // Late if turned in after student deadline (even if after stuDL), we still show "Late".
      // If you ever want to treat > assistant deadline differently, add a branch here.
      return 'late';
    }
    return 'submitted';
  }

  // No submission yet: if past student DL but before assistant DL, it’s still allowed late
  // (status remains "pending" so the Upload button is offered).
  const now = new Date();
  if (stuDL && now > stuDL){
    if (asstDL && now <= asstDL) return 'pending';
    return 'missing';
  }
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
  // show: open OR redo
  const open = s.assignments.filter(a => {
    const fb = feedbackFor(a);
    const redo = fb && String(fb.status||'').trim().toLowerCase()==='redo';
    return redo || studentOpenNow(a);
  });


  // KPIs
  const dueThisWeek = open.filter(a=>{
    const dl = parseMaybeISO(a.studentDeadline || a.deadline);
    if (!dl) return false;
    const now = new Date();
    const in7 = new Date(); in7.setDate(now.getDate()+7);
    return dl >= now && dl <= in7;
  }).length;

  const submittedCount = s.assignments.filter(a => mySubmissionStatus(a)==='submitted' || mySubmissionStatus(a)==='late').length;

  $('#s-kpi-open').textContent = String(open.length);
  $('#s-kpi-due').textContent = String(dueThisWeek);
  $('#s-kpi-submitted').textContent = String(submittedCount);

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
      const lateDL = formatDateDisplay(asg.assistantDeadline || '', state.branding?.dateFormat) || '—';
      const statusKey = mySubmissionStatus(asg);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${asg.title}</b></td>
        <td>${asg.course||''}</td>
        <td>${asg.unit||''}</td>
        <td>${due||''}</td>
        <td>${lateDL}</td>
        <td>${badgeHtmlByKey(statusKey)}</td>
        <td>
        <label class="btn">
        Upload
        <input type="file" class="s-upload-home" data-asg="${asg.assignmentId}" style="display:none;">
        </label>
        </td>
      `;
      tbody.appendChild(tr);
    });
  $$('.s-upload-home').forEach(inp=>{
    inp.onchange = async ()=>{
      const assignmentId = inp.getAttribute('data-asg');
      const file = inp.files?.[0];
      if (!file) return;
      const btn = inp.closest('label.btn');
      setLoading(btn, true, null);
      try{
        const up = await uploadFileBase64(file, { action:'student.uploadSubmission', assignmentId });
        const payload = { assignmentId, fileUrl: up?.fileUrl || null };
        await api('submitStudentSubmission', payload);
        $('#s-submit-msg').textContent = 'Uploaded ✅';
        await reloadStudentUI();
      }catch(e){
        $('#s-submit-msg').textContent = 'Upload failed: ' + e.message;
      }finally{
        setLoading(btn, false, null);
        inp.value = '';
      }
    };
  });
}

function renderProfile(){
  const u = state.user || {};
  $('#s-prof-name') && ($('#s-prof-name').value = u.displayName || u.name || '');
  $('#s-prof-email') && ($('#s-prof-email').value = u.email || '');
  $('#s-prof-phone') && ($('#s-prof-phone').value = state.student?.student?.phone || '');
  $('#s-prof-course') && ($('#s-prof-course').value = u.course || '');
  $('#s-prof-unit') && ($('#s-prof-unit').value = u.unit || '');
  
  // Save
  const save = $('#s-prof-save');
  if (save && !save._wired){
    save._wired = true;
    save.onclick = async ()=>{
      const btn = save;
      const spin = $('#s-prof-spin'); setLoading(btn, true, spin);
      try{
        const displayName = $('#s-prof-name')?.value.trim();
        const email = $('#s-prof-email')?.value.trim();
        const phone = $('#s-prof-phone')?.value.trim();
        const r = await api('student.updateProfile', { displayName, email, phone });
        // reflect in client state immediately
        state.user.displayName = displayName || state.user.displayName;
        if (email && email !== state.user.email) state.user.email = email;
        $('#s-prof-msg').textContent = r.changedEmail ? 'Saved. Email changed — password cleared for security.' : 'Saved.';
      }catch(e){
        $('#s-prof-msg').textContent = 'Could not save: ' + e.message;
      }finally{
        setLoading(btn, false, spin);
      }
    };
  }
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
    const fbBadge = fbStatus ? badgeHtmlByKey(fbStatus) : '<span class="muted">No feedback yet</span>';
    const assistantName = fb?.assistantName || '';
    const updated = fb ? (formatDateDisplay(fb.updatedAt || fb.createdAt || '', state.branding?.dateFormat) || '') : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${asg.title}</td>
      <td>${asg.course||''}</td>
      <td>${asg.unit||''}</td>
      <td>${due||''}</td>
      <td>${badgeHtmlByKey(subKey)}</td>
      <td>${myFile}</td>
      <td>
      <button class="btn ghost s-fb-toggle" data-asg="${asg.assignmentId}">View Feedback</button>
      </td>
    `;
    tbody.appendChild(tr);
    // details row
    const tr2 = document.createElement('tr');
    tr2.className = 's-fb-row hidden';
    tr2.dataset.for = asg.assignmentId;
    tr2.innerHTML = `<td colspan="7">
    ${
      fb ? `
      <div class="grid" style="grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px">
      <div><b>Status</b><div>${fbBadge}</div></div>
      <div><b>Grade</b><div>${fb.grade || '<span class="muted">—</span>'}</div></div>
      <div><b>Assistant</b><div>${assistantName || '<span class="muted">—</span>'}</div></div>
      <div><b>Updated</b><div>${updated || '<span class="muted">—</span>'}</div></div>
      </div>
      <div style="margin-top:10px"><b>Comment</b><div>${fb.comment ? String(fb.comment).replace(/</g,'&lt;') : '<span class="muted">—</span>'}</div></div>
      <div style="margin-top:10px"><b>Feedback File</b><div>${
        fb.fileUrl ? `<a href="${fb.fileUrl}" target="_blank" rel="noopener">file</a>` : '<span class="muted">—</span>'
      }</div></div>
      ` : `<span class="muted">No feedback yet</span>`
    }
    </td>`;
    tbody.appendChild(tr2);
  });

  // wire uploads
  // Toggle feedback rows
  tbody.onclick = (e)=>{
    const btn = e.target.closest('.s-fb-toggle'); if (!btn) return;
    const id = btn.dataset.asg;
    const row = tbody.querySelector(`tr.s-fb-row[data-for="${id}"]`);
    if (!row) return;
    const hid = row.classList.contains('hidden');
    row.classList.toggle('hidden', !hid);
    btn.textContent = hid ? 'Hide Feedback' : 'View Feedback';
  };
}

function renderAnalytics(){
  const s = state.student || { assignments:[], submissions:[], checks:[] };

  // Build status buckets
  const counts = { Submitted:0, 'Submitted Late':0, Missing:0, Pending:0 };
  (s.assignments||[]).forEach(asg=>{
    const st = mySubmissionStatus(asg);
    if (st==='submitted') counts.Submitted++;
    else if (st==='late') counts['Submitted Late']++;
    else if (st==='missing') counts.Missing++;
    else counts.Pending++;
  });

  // Donut
  const el = document.getElementById('s-donut');
  if (el && window.Chart){
    if (el._chart) el._chart.destroy();
    el._chart = new Chart(el, {
      type:'doughnut',
      data:{ labels:Object.keys(counts), datasets:[{ data:Object.values(counts) }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }
    });
  }

  // Grades table (use checks)
  const tb = document.querySelector('#s-grades-table tbody');
  if (!tb) return;
  tb.innerHTML = '';
  (s.checks||[]).forEach(c=>{
    const asg = (s.assignments||[]).find(a=> a.assignmentId===c.assignmentId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${asg?.title || c.assignmentId}</td>
      <td>${c.grade || '<span class="muted">—</span>'}</td>
      <td>${badgeHtmlByKey(c.status || '').replace(/<[^>]+>/g,'$&')}</td>
      <td>${formatDateDisplay(c.updatedAt || c.createdAt || '', state.branding?.dateFormat) || ''}</td>
    `;
    tb.appendChild(tr);
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
  renderAnalytics();
  renderProfile();
}

export async function mount(){
  showPageLoader(true);
  try{
    await loadTabHtml('s-home',         'views/roles/student/tabs/home.html');
    await loadTabHtml('s-assignments',  'views/roles/student/tabs/assignments.html');
    await loadTabHtml('s-analytics',  'views/roles/student/tabs/performance.html');
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
    renderAnalytics();
    renderProfile();
  } finally {
    showPageLoader(false);
  }
}
