import { wireTabs } from '../../core/tabs.js';
import { $, $$, show, hide, showPageLoader, bindAsyncClick } from '../../core/dom.js';
import { api, uploadFileBase64 } from '../../core/api.js';
import { state } from '../../core/state.js';
import { formatDateDisplay, formatDateForInput, parseMaybeISO } from '../../core/date.js';

async function loadTabHtml(tabId, path){
  const host = document.getElementById(tabId);
  if (!host.dataset.loaded){
    host.innerHTML = await (await fetch(path)).text();
    host.dataset.loaded = '1';
  }
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

function latestCheck(asgId, studentId){
  const list = (state.assistant?.checks || []).filter(c => c.assignmentId===asgId && c.studentId===studentId);
  if (!list.length) return null;
  return list.slice().sort((a,b)=>{
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  })[0];
}

// A student (or any student) still has an outstanding Redo on this assignment
function hasOutstandingRedo(asg, studentId){
  const asgId = asg?.assignmentId;
  if (!asgId) return false;

  // If a student is specified, use ONLY their latest check
  if (studentId){
    const lc = latestCheck(asgId, studentId);
    const s = (lc?.status||'').trim().toLowerCase();
    return s === 'redo';
  }

  // Otherwise: does ANY student have latest === 'redo'?
  const students = state.assistant?.students || [];
  for (const st of students){
    const lc = latestCheck(asgId, st.studentId);
    if (String(lc?.status||'').trim().toLowerCase() === 'redo') return true;
  }
  return false;
}

function latestSubmission(asgId, studentId){
  const list = (state.assistant?.submissions || []).filter(s => s.assignmentId===asgId && s.studentId===studentId);
  if (!list.length) return null;
  return list.slice().sort((a,b)=>{
    const ta = new Date(a.submittedAt || a.submittedAtISO || a.createdAt || a.updatedAt || 0).getTime();
    const tb = new Date(b.submittedAt || b.submittedAtISO || b.createdAt || b.updatedAt || 0).getTime();
    return tb - ta;
  })[0];
}

function studentStatusMirrorStudent(asg, studentId){
  const stuDL  = parseMaybeISO(asg.studentDeadline || asg.deadline);
  const asstDL = parseMaybeISO(asg.assistantDeadline || '');
  const now    = new Date();

  const sub   = latestSubmission(asg.assignmentId, studentId);
  const check = latestCheck(asg.assignmentId, studentId);

  const subTime = sub ? parseMaybeISO(sub.submittedAt || sub.submittedAtISO || sub.createdAt || sub.updatedAt) : null;
  const chkTime = check ? parseMaybeISO(check.updatedAt || check.createdAt) : null;
  const chkStatus = (check && String(check.status||'').trim().toLowerCase()) || '';

  // --- Redo overlay (exactly like student home/table rules) ---
  if (chkStatus === 'redo') {
    if (subTime && chkTime && subTime > chkTime) {
      return 'resubmitted';     // green
    }
    return 'pending-redo';       // yellow
  }

  // --- Normal submission logic ---
  if (subTime){
    if (stuDL && subTime > stuDL) return 'late';
    return 'submitted';
  }

  // No submission yet:
  if (stuDL && now > stuDL){
    if (asstDL && now <= asstDL) return 'pending'; // still allowed (late window)
    return 'missing';
  }
  return 'pending';
}

function findStudentSubmission(asg, studentId){
  const list = state.assistant?.submissions || [];
  return list.find(s => s.assignmentId === asg.assignmentId && s.studentId === studentId) || null;
}

function studentSubmissionStatus(asg, submission){
  const stuDL = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (submission){
    const t = parseMaybeISO(submission.submittedAt || submission.submittedAtISO || submission.createdAt || submission.updatedAt);
    const late = stuDL && t && t > stuDL;
    return late ? 'late' : 'submitted';
  }
  if (stuDL && new Date() > stuDL) return 'missing';
  return 'pending';
}

/**
 * Checked column rules:
 * - If a check record exists, mirror its status (checked/missing/redo/...).
 * - If NO check record:
 *    • "Unchecked" if there WAS a student submission and the assistant deadline has passed.
 *    • Otherwise "Pending".
 */
function checkedStatus(asg, studentId){
  const c = (state.assistant?.checks || []).find(
    x => x.assignmentId===asg.assignmentId && x.studentId===studentId
  );
  if (c){
    const s = String(c.status||'').trim().toLowerCase();
    if (s==='checked') return 'checked';
    if (s==='missing') return 'missing';
    if (s==='redo')    return 'redo';
    return s || 'checked';
  }

  const submission = findStudentSubmission(asg, studentId); // null for now
  const asstDL = parseMaybeISO(asg.assistantDeadline);
  const deadlinePassed = !!(asstDL && new Date() > asstDL);

  // No check + no submission
  if (!submission) return deadlinePassed ? '-' : 'pending';

  // Submission exists + no check
  if (deadlinePassed) return 'unchecked';
  return 'pending';
}

function buildPerStudentAssignmentsTable(st){
  const a = state.assistant;
  const asgs = a.assignments.filter(x => (x.course||'') === (st.course||''));

  let rows = '';
  asgs.forEach(asg => {
    // Real submission-based status
    const submission = findStudentSubmission(asg, st.studentId);
    const subKey = studentStatusMirrorStudent(asg, st.studentId);
    
    // Check (if any) for the student+assignment
    const check = (a.checks || []).find(c => c.assignmentId===asg.assignmentId && c.studentId===st.studentId) || null;

    // Checking status pill (Checked / Redo / Missing / Pending / Unchecked / —)
    const checkingKey = check
      ? (String(check.status||'').trim().toLowerCase() || 'checked')
      : checkedStatus(asg, st.studentId);

    const grade   = check?.grade || '<span class="muted">—</span>';
    const comment = check?.comment ? String(check.comment).replace(/</g,'&lt;') : '<span class="muted">—</span>';
    const chkFile = check?.fileUrl
      ? `<a href="${check.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';
    const studentFile = submission?.fileUrl
      ? `<a href="${submission.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';

    const stuDL = formatDateDisplay(asg.studentDeadline || asg.deadline, state.branding?.dateFormat) || '<span class="muted">—</span>';

    rows += `
      <tr>
        <td>${asg.title}</td>
        <td>${badgeHtmlByKey(subKey)}</td>
        <td>${studentFile}</td>
        <td>${checkBadgeFromStatus(checkingKey)}</td>
        <td>${grade}</td>
        <td>${comment}</td>
        <td>${chkFile}</td>
        <td>${stuDL}</td>
      </tr>`;
  });

  return `
    <div class="table-wrapper" style="margin:8px 0">
      <table class="table compact">
        <thead>
          <tr>
            <th>Assignment</th>
            <th>Submission Status</th>
            <th>Student Submission File</th>
            <th>Checking Status</th>
            <th>Grade</th>
            <th>Comment</th>
            <th>Checked File</th>
            <th>Student Deadline</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7"><span class="muted">No assignments found.</span></td></tr>'}</tbody>
      </table>
    </div>`;
}

function studentStatusFor(asg, check){
  const dl = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (check && String(check.status||'').trim()){
    const t = new Date(check.updatedAt || check.createdAt || 0);
    const late = dl && t > dl;
    return { key: late ? 'late' : 'submitted', label: late ? 'Submitted Late' : 'Submitted' };
  }
  if (dl && new Date() > dl) return { key:'missing', label:'Missing' };
  return { key:'pending', label:'Pending' };
}

function badgeHtmlByKey(key, fallback=''){
  const k = String(key||'').toLowerCase();
  if (k === 'submitted') return '<span class="badge ok">Submitted</span>';
  if (k === 'late')      return '<span class="badge warn">Submitted Late</span>';
  if (k === 'missing')   return '<span class="badge danger">Missing</span>';
  if (k === 'unchecked') return '<span class="badge danger">Unchecked</span>';
  if (k === 'pending')   return '<span class="badge info">Pending</span>';
  if (k === 'checked')   return '<span class="badge ok">Checked</span>';   // ← add
  if (k === 'redo')      return '<span class="badge warn">Redo</span>';    // ← add
  if (k === 'open')      return '<span class="badge ok">Open</span>';
  if (k === 'closed')    return '<span class="badge warn">Closed</span>';
  if (k === 'pending-redo') return '<span class="badge warn">Pending Redo</span>';
  if (k === 'resubmitted')  return '<span class="badge ok">Resubmitted</span>';
  return fallback || '<span class="badge">Pending</span>';
}

function checkBadgeFromStatus(s=''){
  const k = String(s).trim().toLowerCase();
  if (!k)            return '<span class="muted">—</span>';
  if (k==='-')       return '<span class="muted">—</span>';
  if (k==='checked') return '<span class="badge ok">Checked</span>';
  if (k==='missing') return '<span class="badge danger">Missing</span>';
  if (k==='redo')    return '<span class="badge warn">Redo</span>';
  if (k==='unchecked') return '<span class="badge danger">Unchecked</span>'; // ← add
  if (k==='pending')   return '<span class="badge info">Pending</span>';     // ← add
  if (k === 'pending-redo') return '<span class="badge warn">Pending Redo</span>';
  if (k === 'resubmitted')  return '<span class="badge ok">Resubmitted</span>';
  return `<span class="badge">${s}</span>`;
}

function buildStudentTableHtml(asg){
  const a = state.assistant;
  const students = a.students.filter(s => (s.course||'') === (asg.course||''));

  let rows = '';
  students.forEach(st => {
    // Use submission data for status + file
    const submission   = latestSubmission(asg.assignmentId, st.studentId);
    const stStatusKey = studentStatusMirrorStudent(asg, st.studentId);

    // Student File should be the student's submission file (not the check)
    const studentFile = submission?.fileUrl
      ? `<a href="${submission.fileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';
    rows += `
      <tr>
        <td>${st.studentName}</td>
        <td>${badgeHtmlByKey(stStatusKey)}</td>
        <td>${studentFile}</td>
      </tr>`;
  });

  return `
    <div class="table-wrapper" style="margin:8px 0">
      <table class="table compact">
        <thead>
          <tr>
            <th>Student</th>
            <th>Status</th>
            <th>Student Submission File</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="3"><span class="muted">No students in this course.</span></td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderHome(){
  const a = state.assistant;
  const openAssignments = a.assignments.filter(assistantOpenNow);
  $('#a-kpi-students').textContent = a.students.length;
  $('#a-kpi-assignments').textContent = openAssignments.length;
  $('#a-kpi-week').textContent = a.checks.filter(x=>{
    const created = new Date(x.createdAt||x.updatedAt||0).getTime();
    const recent = Date.now() - created < 7*86400e3;
    const ok = (x.status||'').trim().toLowerCase() === 'checked';
    return recent && ok;
  }).length;

  const tb = $('#a-assignments-table tbody'); tb.innerHTML='';
  a.assignments.forEach(x=>{
    const openNow = assistantOpenNow(x);
    const stuDL = formatDateDisplay(x.studentDeadline || x.deadline, state.branding.dateFormat);
    const asstDL = formatDateDisplay(x.assistantDeadline || '', state.branding.dateFormat);
    const statusBadge = openNow ? badgeHtmlByKey('open') : badgeHtmlByKey('closed');
    const headFile = x.studentFileUrl
      ? `<a href="${x.studentFileUrl}" target="_blank" rel="noopener">file</a>`
      : '<span class="muted">—</span>';

    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td><button class="btn ghost a-expand" data-id="${x.assignmentId}" aria-expanded="false" title="Expand">►</button></td>
      <td>${x.title}</td>
      <td>${x.course}</td>
      <td>${x.unit || ''}</td>
      <td>${stuDL}</td>
      <td>${asstDL}</td>
      <td>${headFile}</td>
      <td>${statusBadge}</td>`;
    tb.appendChild(tr);

    // Detail row (initially hidden)
    const tr2=document.createElement('tr');
    tr2.className='a-expand-row hidden';
    tr2.dataset.for = x.assignmentId;
    tr2.innerHTML = `<td colspan="8">${buildStudentTableHtml(x)}</td>`;
    tb.appendChild(tr2);
  });

  // Toggle logic (event delegation on the tbody)
  tb.addEventListener('click', (e)=>{
    const btn = e.target.closest('.a-expand');
    if (!btn) return;
    const id = btn.dataset.id;
    const row = tb.querySelector(`tr.a-expand-row[data-for="${id}"]`);
    if (!row) return;
    const isHidden = row.classList.contains('hidden');
    row.classList.toggle('hidden', !isHidden);
    btn.textContent = isHidden ? '▼' : '►';
    btn.setAttribute('aria-expanded', String(isHidden));
  }, { once:true });

  // Rebind for future re-renders (ensure delegation persists)
  tb.addEventListener('click', (e)=>{
    const btn = e.target.closest('.a-expand');
    if (!btn) return;
    const id = btn.dataset.id;
    const row = tb.querySelector(`tr.a-expand-row[data-for="${id}"]`);
    if (!row) return;
    const isHidden = row.classList.contains('hidden');
    row.classList.toggle('hidden', !isHidden);
    btn.textContent = isHidden ? '▼' : '►';
    btn.setAttribute('aria-expanded', String(isHidden));
  });
}

function renderRoster(){
  // 0) Data guards
  if (!state.assistant) {
    console.warn('[Roster] state.assistant is missing');
    const host = document.getElementById('a-roster');
    if (host) host.innerHTML = '<div class="card"><div class="muted">No assistant data loaded.</div></div>';
    return;
  }

  // 1) DOM guards — if HTML not yet loaded, do nothing (caller will re-run after load)
  const table = document.querySelector('#a-roster-table tbody');
  const empty = document.getElementById('a-roster-empty');

  if (!table || !empty) {
    console.warn('[Roster] Missing DOM (#a-roster-table or #a-roster-empty). Did roster.html load?');
    return;
  }

  const q = (document.getElementById('a-roster-search')?.value || '').trim().toLowerCase();

  let students = (state.assistant.students || []).slice();
  if (q) {
    students = students.filter(s =>
      (s.studentName||'').toLowerCase().includes(q) ||
      (s.email||'').toLowerCase().includes(q)
    );
  }

  table.innerHTML = '';
  empty.style.display = students.length ? 'none' : 'block';

  students.forEach(st=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><button class="btn ghost a-roster-expand" data-id="${st.studentId}" aria-expanded="false" title="Expand">►</button></td>
      <td>${st.studentName}</td>
      <td>${st.email || ''}</td>
      <td>${st.course || ''}</td>
      <td>${st.unit || ''}</td>
      <td><span class="badge ${String(st.status||'Active').toLowerCase()==='active' ? 'ok' : 'warn'}">${st.status||'Active'}</span></td>
    `;
    table.appendChild(tr);

    const tr2 = document.createElement('tr');
    tr2.className = 'a-roster-expand-row hidden';
    tr2.dataset.for = st.studentId;
    tr2.innerHTML = `<td colspan="6">${buildPerStudentAssignmentsTable(st)}</td>`;
    table.appendChild(tr2);
  });

  // Event delegation: toggle expanders
  // Event delegation: toggle expanders (bind ONCE per render)
if (!table._wiredExpand) {
  table._wiredExpand = true;
  table.addEventListener('click', (e)=>{
    const btn = e.target.closest('.a-roster-expand');
    if (!btn) return;
    const id = btn.dataset.id;
    // scope to the SAME <tbody>, not parentElement (was flaky)
    const row = table.querySelector(`tr.a-roster-expand-row[data-for="${id}"]`);
    if (!row) return;
    const isHidden = row.classList.contains('hidden');
    row.classList.toggle('hidden', !isHidden);
    btn.textContent = isHidden ? '▼' : '►';
    btn.setAttribute('aria-expanded', String(isHidden));
  });
}
}
// --- Charts: Assistant / Performance tab ---
function renderPerformance(){
  const a = state.assistant || { checks: [], assignments: [] };

  // ----- Line: Weekly checks over the last 7 days -----
  const days = [];
  const counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    days.push(d);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const n = a.checks.filter(c=>{
      const t = new Date(c.updatedAt || c.createdAt || 0);
      return t >= d && t < next && String((c.status||'').trim()).length;
    }).length;
    counts.push(n);
  }
  const lineLabels = days.map(d => {
    // Short, readable labels: e.g., "Tue" or "9/01"
    return d.toLocaleDateString(undefined, { weekday:'short' });
  });

  const lineEl = $('#a-line');
  if (lineEl) {
    if (lineEl._chart) lineEl._chart.destroy();
    // eslint-disable-next-line no-undef
    lineEl._chart = new Chart(lineEl, {
      type: 'line',
      data: {
        labels: lineLabels,
        datasets: [{
          label: 'Checks (last 7 days)',
          data: counts,
          tension: 0.3,
          fill: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
      }
    });
  }

  // ----- Donut: Status breakdown (all checks) -----
  const statusCounts = { Checked:0, Missing:0, Redo:0, Other:0 };
  a.checks.forEach(c=>{
    const s = String(c.status||'').trim().toLowerCase();
    if (s === 'checked') statusCounts.Checked++;
    else if (s === 'missing') statusCounts.Missing++;
    else if (s === 'redo') statusCounts.Redo++;
    else if (s) statusCounts.Other++;
  });

  const donutEl = $('#a-donut');
  if (donutEl) {
    if (donutEl._chart) donutEl._chart.destroy();
    // eslint-disable-next-line no-undef
    donutEl._chart = new Chart(donutEl, {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusCounts),
        datasets: [{ data: Object.values(statusCounts) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
}

function enforceGradeRules(){
  const status = $('#a-status').value.trim().toLowerCase();
  const gradeEl = $('#a-grade');
  const id = $('#a-assignmentSelect').value;
  const asg = state.assistant.assignments.find(x=> x.assignmentId===id);
  const gradeRequired = !asg ? true : (asg.requireGrade===true || String(asg.requireGrade)==='true');

  if (!gradeRequired){
    gradeEl.value=''; gradeEl.disabled = true;
    gradeEl.placeholder = 'Disabled for this assignment';
    return;
  }
  if (status === 'missing'){
    gradeEl.value = '';
    gradeEl.disabled = true;
    gradeEl.placeholder = 'Disabled for Missing';
  } else {
    gradeEl.disabled = false;
    gradeEl.placeholder = 'e.g. 18/20 or 90%';
  }
}

function applyAssignmentPolicyToForm(){
  const id = $('#a-assignmentSelect').value;
  const asg = state.assistant.assignments.find(x=> x.assignmentId===id);
  const gradeWrap = $('#a-grade-field'); const gradeEl = $('#a-grade'); const msg = $('#a-assignment-policy');
  let notes = [];
  if (!asg){ gradeWrap.classList.remove('hidden'); gradeEl.disabled=false; msg.textContent=''; return; }

  // grade required?
  if (String(asg.requireGrade)==='false' || asg.requireGrade===false){
    gradeWrap.classList.add('hidden');
    gradeEl.value=''; gradeEl.disabled=true;
    notes.push('Grades are disabled for this assignment.');
  } else {
    gradeWrap.classList.remove('hidden');
    gradeEl.disabled=false;
  }

  // assistant phase open & deadline
  const openNow = assistantOpenNow(asg);
  const selectedStudentId = $('#a-studentSelect')?.value || '';
  const allowRedo = hasOutstandingRedo(asg, selectedStudentId);
  let blocked = !(openNow || allowRedo);
  if (!openNow){
    if (!(asg.assistantOpen===true || String(asg.assistantOpen)==='true')) notes.push('Assistant submissions are closed.');
    const dl = parseMaybeISO(asg.assistantDeadline);
    if (dl && new Date() > dl) notes.push('Assistant deadline has passed.');
    if (allowRedo) notes.push('Action allowed due to outstanding Redo for this student.');
  }
  $('#a-submit').disabled = blocked;
  msg.textContent = notes.join(' ');
  enforceGradeRules();
}

function refreshAssistantStudentLists(){
  const curLine = $('#a-file-current');
  if (curLine) curLine.textContent = '';
  const finput = $('#a-file');
  if (finput) { finput.value = ''; delete finput.dataset.currentUrl; }
  const a = state.assistant;
  const assignmentId = $('#a-assignmentSelect').value;
  const sSel = $('#a-studentSelect'); sSel.innerHTML='';
  const existing = a.checks.filter(c=> c.assignmentId===assignmentId);
  const withRecord = new Set(existing.map(c=> c.studentId));
  const asg = a.assignments.find(x=> x.assignmentId===assignmentId);
  const isOpen = asg ? assistantOpenNow(asg) : true;
  const existingTable = $('#a-existing-table tbody'); existingTable.innerHTML='';

  // If open: keep current behavior (new records only).
  // If closed: only show students whose latest check is 'Redo'.
  const listForSelect = isOpen
    ? a.students.filter(s => !withRecord.has(s.studentId))
    : a.students.filter(s => hasOutstandingRedo(asg, s.studentId));
  
  listForSelect.forEach(s=>{
    const opt=document.createElement('option');
    opt.value=s.studentId; opt.textContent=s.studentName;
    sSel.appendChild(opt);
  });

  // Table of existing records:
  // If closed: show only outstanding Redo rows for this assignment
  const rowsForTable = isOpen
    ? existing
    : existing.filter(c => String(c.status||'').trim().toLowerCase()==='redo');
  
  rowsForTable.forEach(c=>{
    const student = a.students.find(s=>s.studentId===c.studentId);
    const tr = document.createElement('tr');
    const status = (c.status || '').trim().toLowerCase();
    const statusBadge =
      status === 'checked' ? '<span class="badge ok">Checked</span>' :
      status === 'missing' ? '<span class="badge danger">Missing</span>' :
      status === 'redo'    ? '<span class="badge warn">Redo</span>' :
                         `<span class="badge">${c.status||''}</span>`;
    tr.innerHTML = `
      <td>${student?student.studentName:c.studentId}</td>
      <td>${statusBadge}</td>
      <td>${c.grade||''}</td>
      <td>${c.comment||''}</td>
      <td>${c.fileUrl?`<a href="${c.fileUrl}" target="_blank">file</a>`:''}</td>
      <td><button class="btn ghost a-edit" data-st="${c.studentId}" data-as="${c.assignmentId}">Edit</button></td>`;
    existingTable.appendChild(tr);
  });

  $$('.a-edit').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const studentId = btn.getAttribute('data-st');
      const assignmentId = btn.getAttribute('data-as');
      const rec = state.assistant.checks.find(r=> r.studentId===studentId && r.assignmentId===assignmentId);
      if (!rec) return;
      $('#a-assignmentSelect').value = assignmentId;
      $('#a-status').value = rec.status || 'Checked';
      $('#a-grade').value = rec.grade || '';
      $('#a-comment').value = rec.comment || '';
      const finput = $('#a-file');
      if (finput) {
        finput.value = ''; // cannot prefill for security
        finput.dataset.currentUrl = rec.fileUrl || '';
      }
      const cur = $('#a-file-current');
      if (cur) {
        cur.innerHTML = rec.fileUrl
          ? `Current: <a href="${rec.fileUrl}" target="_blank" rel="noopener">file</a>`
          : `<span class="muted">No file uploaded</span>`;
      }
      if (![...$('#a-studentSelect').options].some(o=>o.value===studentId)){
        const st = state.assistant.students.find(s=> s.studentId===studentId);
        const opt=document.createElement('option');
        opt.value=studentId; opt.textContent=st?st.studentName:studentId;
        $('#a-studentSelect').appendChild(opt);
      }
      $('#a-studentSelect').value = studentId;
      $('#a-edit-hint').classList.remove('hidden');
      $('#a-cancel').classList.remove('hidden');
      $('#a-submit-msg').textContent = 'Editing existing record. Saving will update it.';
      applyAssignmentPolicyToForm();
    });
  });
}

async function loadAssistantData(demo=false){
  if(demo){
    state.assistant.students=[
      {studentId:'s1', studentName:'Omar Hassan', course:'Math', unit:'U1'},
      {studentId:'s2', studentName:'Mariam Adel', course:'Math', unit:'U1'},
      {studentId:'s3', studentName:'Youssef N.', course:'Math', unit:'U2'},
    ];
    state.assistant.assignments=[
      {assignmentId:'as1', title:'Homework 5', course:'Math', unit:'U1', deadline:'2025-09-10', assistantDeadline:'2025-09-12', assistantOpen:true, requireGrade:true, studentOpen:true},
      {assignmentId:'as2', title:'Quiz 2 Review', course:'Math', unit:'U2', deadline:'2025-09-15', assistantDeadline:'', assistantOpen:true, requireGrade:false, studentOpen:true},
    ];
    state.assistant.checks=[
      {checkId:'c1', assignmentId:'as1', studentId:'s1', status:'Checked', grade:'18/20', fileUrl:'', createdAt:new Date(Date.now()-2*86400e3).toISOString()},
      {checkId:'c2', assignmentId:'as1', studentId:'s2', status:'Redo', grade:'', fileUrl:'', createdAt:new Date(Date.now()-1*86400e3).toISOString()},
    ];
  } else {
    const res = await api('getAssistantDashboard',{});
    Object.assign(state.assistant,res);
  }
}

function wireEvents(){
  // status -> grade rule
  document.addEventListener('change', (e)=>{
    if(e.target && e.target.id==='a-status') enforceGradeRules();
    if(e.target && e.target.id==='a-assignmentSelect'){ refreshAssistantStudentLists(); applyAssignmentPolicyToForm(); }
    if(e.target && e.target.id==='a-studentSelect'){ applyAssignmentPolicyToForm(); }
  });

  $('#a-cancel')?.addEventListener('click', ()=>{
    $('#a-edit-hint').classList.add('hidden'); $('#a-cancel').classList.add('hidden'); $('#a-submit-msg').textContent='';
    $('#a-status').value = 'Checked'; $('#a-grade').value=''; $('#a-comment').value='';
    if ($('#a-file')) { $('#a-file').value=''; delete $('#a-file').dataset.currentUrl; }
    const curLine = $('#a-file-current'); if (curLine) curLine.textContent='';
  });

  // Save (Check/Edit) — with loading + dedupe + correct success message
  bindAsyncClick('#a-submit', async ()=>{
    const assignmentId = $('#a-assignmentSelect').value;
    const asg = state.assistant.assignments.find(x=> x.assignmentId===assignmentId);
    const studentId = $('#a-studentSelect').value;
    const status = $('#a-status').value;
    const grade = $('#a-grade').value.trim();
    const comment = $('#a-comment').value.trim();
    const fileInput = $('#a-file');

    const msg = $('#a-submit-msg');

    // Validations (unchanged)
    if (!assignmentId){ msg.textContent = 'Choose an assignment.'; return; }
    if (!studentId){ msg.textContent = 'Choose a student.'; return; }
    const open = (asg?.assistantOpen===true || String(asg?.assistantOpen)==='true');
    const dl = parseMaybeISO(asg?.assistantDeadline);
    const allowRedo = hasOutstandingRedo(asg, studentId);
    if (!open && !allowRedo){ msg.textContent='Assistant submissions are closed by head.'; return; }
    if (dl && new Date() > dl && !allowRedo){ msg.textContent='Assistant deadline has passed.'; return; }
    if((status.toLowerCase()==='missing' || (asg && (asg.requireGrade===false || String(asg.requireGrade)==='false'))) && grade){
      msg.textContent='Grade not allowed for this status/assignment.'; return;
    }

    // Build payload; only include fileUrl if user picked a new file
    const payload = { assignmentId, studentId, status, grade, comment };
    if (fileInput?.files && fileInput.files[0]) {
      const up = await uploadFileBase64(fileInput.files[0], { action:'uploadFile', studentId, assignmentId });
      if (up?.fileUrl) payload.fileUrl = up.fileUrl;
    }
    const r = await api('submitCheck', payload);

    // Prefer "Created" over "Updated" to stop the flicker
    if (r?.created)      msg.textContent = 'Created ✅';
    else if (r?.updated) msg.textContent = 'Updated ✏️';
    else                 msg.textContent = 'Saved ✅';

    if ($('#a-file')) {
      $('#a-file').value='';
      delete $('#a-file').dataset.currentUrl;
    }
    const curLine = $('#a-file-current'); if (curLine) curLine.textContent='';
    $('#a-edit-hint')?.classList.add('hidden');
    $('#a-cancel')?.classList.add('hidden');

    // If you want a full refresh keep this; bindAsyncClick prevents double-binding
    await init(false);
  });
}

export async function init(demo){
  showPageLoader(true);
  try{
    // load tab shells
    await loadTabHtml('a-home',        'views/roles/assistant/tabs/home.html');
    await loadTabHtml('a-roster',      'views/roles/assistant/tabs/roster.html'); // NEW
    console.log('[Roster] HTML loaded');
    await loadTabHtml('a-students',    'views/roles/assistant/tabs/students.html');
    await loadTabHtml('a-performance', 'views/roles/assistant/tabs/performance.html');

    wireTabs('#view-assistant');
    await loadAssistantData(demo);
    renderHome();
    renderPerformance();
    wireEvents();
    renderRoster();
    $('#a-roster-search')?.addEventListener('input', renderRoster);

    // fill selects for students tab
    const asSel = $('#a-assignmentSelect'); if (asSel) asSel.innerHTML='';
    state.assistant.assignments
      .filter(x => assistantOpenNow(x) || hasOutstandingRedo(x))
      .forEach(x=>{
      const opt=document.createElement('option'); opt.value=x.assignmentId;
      const dl = x.assistantDeadline ? ` · DL ${formatDateDisplay(x.assistantDeadline)}` : '';
      opt.textContent=`${x.title} · ${x.unit}${dl}`; asSel?.appendChild(opt);
    });
    refreshAssistantStudentLists();
    applyAssignmentPolicyToForm();
  } finally {
    showPageLoader(false);
  }
}
