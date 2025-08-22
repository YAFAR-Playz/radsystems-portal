// js/roles/head/index.js
import { wireTabs } from '../../core/tabs.js';
import { $, $$, show, hide, showPageLoader, setLoading } from '../../core/dom.js';
import { api, uploadFileBase64 } from '../../core/api.js';
import { state } from '../../core/state.js';
import { formatDateDisplay, formatDateForInput, parseMaybeISO } from '../../core/date.js';

// ===================== module state/guards ===================== //
let _wired = false;          // ensure we wire events only once
let _lastDemo = false;       // remember whether we booted in demo mode
const inflight = {           // in-flight locks per action
  create: false,
  update: false,
  delete: false,
  reassign: false,
  check: false,   // head checks save
};

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

// Compute one bucket exactly like Student "singleStatus" for Head
function _h_singleStatusFor(asg, studentId){
  const sub   = _latestSubmission(asg.assignmentId, studentId);
  const chk   = _latestCheck(asg.assignmentId, studentId);

  const tSub  = sub ? parseMaybeISO(sub.submittedAt || sub.submittedAtISO || sub.createdAt || sub.updatedAt) : null;
  const tChk  = chk ? parseMaybeISO(chk.updatedAt || chk.createdAt) : null;
  const stuDL = parseMaybeISO(asg.studentDeadline || asg.deadline);
  const asstDL= parseMaybeISO(asg.assistantDeadline || '');
  const now   = new Date();
  const lastStatus = (chk && String(chk.status||'').trim().toLowerCase()) || '';

  if (chk){
    if (lastStatus === 'checked') return 'checked';
    if (lastStatus === 'redo'){
      if (tSub && tChk && tSub > tChk) return 'resubmitted';
      return 'redo';
    }
    return lastStatus || 'pending';
  }

  if (!sub){
    if (stuDL && now > stuDL){
      if (asstDL && now <= asstDL) return 'pending';
      return 'missing';
    }
    return 'pending';
  }

  if (stuDL && tSub && tSub > stuDL) return 'late';
  return 'submitted';
}

// ===== Head Checks tab helpers =====
function _h_asgById(id){ return (state.head?.assignments||[]).find(a=> a.assignmentId===id); }
function _h_latestCheck(asgId, studentId){
  const list = (state.head?.checks || []).filter(c => c.assignmentId===asgId && c.studentId===studentId);
  if (!list.length) return null;
  return list.sort((a,b)=> new Date(b.updatedAt||b.createdAt||0) - new Date(a.updatedAt||a.createdAt||0))[0];
}
function _h_hasOutstandingRedo(asgId, studentId){
  const lc = _h_latestCheck(asgId, studentId);
  return String(lc?.status||'').trim().toLowerCase()==='redo';
}
function _h_enforceGradeRules(){
  const status = $('#hchk-status')?.value?.trim().toLowerCase();
  const gradeEl = $('#hchk-grade');
  const asg = _h_asgById($('#hchk-assignmentSelect')?.value);
  const gradeRequired = !asg ? true : (asg.requireGrade===true || String(asg.requireGrade)==='true');

  if (!gradeEl) return;
  if (!gradeRequired){
    gradeEl.value=''; gradeEl.disabled=true; gradeEl.placeholder='Disabled for this assignment';
    return;
  }
  if (status==='missing'){
    gradeEl.value=''; gradeEl.disabled=true; gradeEl.placeholder='Disabled for Missing';
  } else {
    gradeEl.disabled=false; gradeEl.placeholder='e.g. 18/20 or 90%';
  }
}
function _h_applyPolicyNote(){
  const asg = _h_asgById($('#hchk-assignmentSelect')?.value);
  const msg = $('#hchk-policy'); if (!msg) return;
  if (!asg){ msg.textContent=''; return; }
  const notes = [];
  // Unlike assistant, head can save even if closed; just show info notes
  if (!(asg.assistantOpen===true || String(asg.assistantOpen)==='true')) notes.push('Assistant window is closed (head override allowed).');
  const asstDL = parseMaybeISO(asg.assistantDeadline);
  if (asstDL && new Date()>asstDL) notes.push('Assistant deadline has passed (head override allowed).');
  if (String(asg.requireGrade)==='false' || asg.requireGrade===false) notes.push('Grades are disabled for this assignment.');
  msg.textContent = notes.join(' ');
  _h_enforceGradeRules();
}
function _h_fillAssistantFilter(){
  const sel = $('#hchk-assistantFilter'); if (!sel) return;
  // keep All/None then append assistants
  const already = new Set([ '__ALL__', '__NONE__' ]);
  const keep = Array.from(sel.options).filter(o => already.has(o.value));
  sel.innerHTML=''; keep.forEach(o => sel.appendChild(o));
  (state.head?.assistants||[]).forEach(a=>{
    const opt = document.createElement('option');
    opt.value = a.userId; opt.textContent = a.displayName || a.userId;
    sel.appendChild(opt);
  });
}
function _h_refreshStudentsForSelection(){
  const a = state.head;
  const asgId = $('#hchk-assignmentSelect')?.value;
  const assistantFilter = $('#hchk-assistantFilter')?.value || '__ALL__';
  const sSel = $('#hchk-studentSelect'); if (!sSel) return;
  sSel.innerHTML='';

  const byCourse = (a?.students||[]).filter(s => {
    // assistant filter
    if (assistantFilter==='__ALL__') return true;
    if (assistantFilter==='__NONE__') return !s.assistantId;
    return s.assistantId === assistantFilter;
  });

  // students with no record for asg OR latest is Redo
  const filtered = byCourse.filter(st=>{
    const lc = _h_latestCheck(asgId, st.studentId);
    if (!lc) return true;
    return String(lc.status||'').trim().toLowerCase()==='redo';
  });

  filtered.forEach(st=>{
    const opt=document.createElement('option');
    opt.value=st.studentId;
    opt.textContent=`${st.studentName}${st.assistantId ? '' : ' · (No assistant)'}`;
    sSel.appendChild(opt);
  });

  // bottom table refresh
  _h_renderExistingChecksTable();
}
function _h_renderExistingChecksTable(){
  const tbody = $('#hchk-existing-table tbody'); if (!tbody) return;
  const asgId = $('#hchk-assignmentSelect')?.value;
  tbody.innerHTML='';
  if (!asgId) return;

  // Show ALL checks for this assignment (across the head's course)
  const src = Array.isArray(state.head?.checksByCourse) ? state.head.checksByCourse : (state.head?.checks || []);
  const checks = src.filter(c => c.assignmentId===asgId);
  const students = new Map((state.head?.students||[]).map(s=> [s.studentId, s]));
  checks.forEach(c=>{
    const st = students.get(c.studentId);
    const status = String(c.status||'').trim().toLowerCase();
    const statusBadge =
      status==='checked' ? '<span class="badge ok">Checked</span>' :
      status==='missing' ? '<span class="badge danger">Missing</span>' :
      status==='redo'    ? '<span class="badge warn">Redo</span>' :
                           `<span class="badge">${c.status||''}</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${st ? st.studentName : c.studentId}</td>
      <td>${statusBadge}</td>
      <td>${c.grade||''}</td>
      <td>${c.comment||''}</td>
      <td>${c.fileUrl?`<a href="${c.fileUrl}" target="_blank" rel="noopener">file</a>`:'<span class="muted">—</span>'}</td>
      <td><button class="btn ghost hchk-edit" data-st="${c.studentId}" data-as="${c.assignmentId}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });

  $$('.hchk-edit').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const studentId = btn.getAttribute('data-st');
      const assignmentId = btn.getAttribute('data-as');
      const rec = (state.head?.checks||[]).find(r=> r.studentId===studentId && r.assignmentId===assignmentId);
      if (!rec) return;

      $('#hchk-assignmentSelect').value = assignmentId;
      $('#hchk-status').value = rec.status || 'Checked';
      $('#hchk-grade').value = rec.grade || '';
      $('#hchk-comment').value = rec.comment || '';

      const finput = $('#hchk-file');
      if (finput){ finput.value=''; finput.dataset.currentUrl = rec.fileUrl || ''; }
      const cur = $('#hchk-file-current');
      if (cur){
        cur.innerHTML = rec.fileUrl
          ? `Current: <a href="${rec.fileUrl}" target="_blank" rel="noopener">file</a>`
          : `<span class="muted">No file uploaded</span>`;
      }

      // ensure the student appears in select (if filtered out)
      if (![...$('#hchk-studentSelect').options].some(o=> o.value===studentId)){
        const st = (state.head?.students||[]).find(s=> s.studentId===studentId);
        const opt=document.createElement('option');
        opt.value=studentId; opt.textContent=st?st.studentName:studentId;
        $('#hchk-studentSelect').appendChild(opt);
      }
      $('#hchk-studentSelect').value = studentId;
      $('#hchk-edit-hint').classList.remove('hidden');
      $('#hchk-cancel').classList.remove('hidden');
      $('#hchk-submit-msg').textContent = 'Editing existing record. Saving will update it.';
      _h_applyPolicyNote();
    });
  });
}

// Mirror Student portal logic (needs submissions + checks)
function _latestCheck(asgId, studentId){
  const list = (state.head?.checks || []).filter(c => c.assignmentId===asgId && c.studentId===studentId);
  if (!list.length) return null;
  return list.slice().sort((a,b)=>{
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  })[0];
}

function _latestSubmission(asgId, studentId){
  const list = (state.head?.submissions || []).filter(s => s.assignmentId===asgId && s.studentId===studentId);
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
  
  const sub   = _latestSubmission(asg.assignmentId, studentId);
  const check = _latestCheck(asg.assignmentId, studentId);

  const subTime = sub ? parseMaybeISO(sub.submittedAt || sub.submittedAtISO || sub.createdAt || sub.updatedAt) : null;
  const chkTime = check ? parseMaybeISO(check.updatedAt || check.createdAt) : null;
  const chkStatus = (check && String(check.status||'').trim().toLowerCase()) || '';

  // Redo overlay (exactly like Student)
  if (chkStatus === 'redo') {
    if (subTime && chkTime && subTime > chkTime) return 'resubmitted';
    return 'pending-redo';
  }

  // Normal submission logic
  if (subTime){
    if (stuDL && subTime > stuDL) return 'late';
    return 'submitted';
  }

  // No submission yet
  if (stuDL && now > stuDL){
    if (asstDL && now <= asstDL) return 'pending';
    return 'missing';
  }
  return 'pending';
}

// ---------- Students tab helpers ----------
function _assistantNameByIdMap(){
  const map = new Map();
  (state.head?.assistants || []).forEach(a => map.set(a.userId, a.displayName || a.userId));
  return map;
}
function _latestCheckForStudent(studentId){
  const checks = (state.head?.checks || []).filter(c => c.studentId === studentId);
  if (!checks.length) return null;
  // pick most recent by updatedAt then createdAt
  const toTime = c => new Date(c.updatedAt || c.createdAt || 0).getTime();
  checks.sort((a,b)=> toTime(b) - toTime(a));
  return checks[0];
}
function _recentChecks(studentId, limit=3){
  const checks = (state.head?.checks || []).filter(c => c.studentId === studentId);
  const toTime = c => new Date(c.updatedAt || c.createdAt || 0).getTime();
  checks.sort((a,b)=> toTime(b) - toTime(a));
  return checks.slice(0, limit);
}
function _fmtDateShort(iso){
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const m = (d.getMonth()+1).toString().padStart(2,'0');
  const day = d.getDate().toString().padStart(2,'0');
  return `${m}/${day}`;
}

// --- HEAD Students: shared helpers (mirror Assistant) ---
function badgeHtmlByKey(key, fallback=''){
  const k = String(key||'').toLowerCase();
  if (k==='submitted') return '<span class="badge ok">Submitted</span>';
  if (k==='late')      return '<span class="badge warn">Submitted Late</span>';
  if (k==='missing')   return '<span class="badge danger">Missing</span>';
  if (k==='unchecked') return '<span class="badge danger">Unchecked</span>';
  if (k==='pending')   return '<span class="badge info">Pending</span>';
  if (k==='checked')   return '<span class="badge ok">Checked</span>';
  if (k==='redo')      return '<span class="badge warn">Redo</span>';
  if (k==='-')         return '<span class="muted">—</span>';   // ← dash, no pill
  if (k==='pending-redo') return '<span class="badge warn">Pending Redo</span>';
  if (k==='resubmitted')  return '<span class="badge ok">Resubmitted</span>';
  return fallback || '<span class="badge">—</span>';
}

// Placeholder for future student submissions table.
// For now returns null (no submission). When you wire the real table, return
// { fileUrl, submittedAtISO } if the student uploaded a submission.
function checkedStatus(asg, studentId){
  // If a check exists, mirror its status
  const c = (state.head?.checks || []).find(
    x => x.assignmentId===asg.assignmentId && x.studentId===studentId
  );
  if (c){
    const s = String(c.status||'').trim().toLowerCase();
    if (s==='checked') return 'checked';
    if (s==='missing') return 'missing';
    if (s==='redo')    return 'redo';
    return s || 'checked';
  }

  // No check
  const submission = _latestSubmission(asg.assignmentId, studentId);
  const asstDL = parseMaybeISO(asg.assistantDeadline);
  const deadlinePassed = !!(asstDL && new Date() > asstDL);

  if (!submission){
    // No submission + no check
    return deadlinePassed ? '-' : 'pending';
  }

  // submission exists but no check
  if (deadlinePassed) return 'unchecked';
  return 'pending';
}

// Builds the expanded table per student (assignment rows)
function buildPerStudentAssignmentsTable_Head(st){
  const a = state.head;
  const asgs = (a?.assignments || []).filter(x => (x.course||'') === (st.course||''));

  let rows = '';
  asgs.forEach(asg=>{
    const check = (state.head?.checks || []).find(x => x.assignmentId===asg.assignmentId && x.studentId===st.studentId) || null;
    const submission = _latestSubmission(asg.assignmentId, st.studentId);
    
    // Mirror Student portal status (incl. pending-redo / resubmitted)
    const stStatusKey = studentStatusMirrorStudent(asg, st.studentId);
    
    // Checking status pill
    const chkKey = check
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

    const stuDL  = formatDateDisplay(asg.studentDeadline || asg.deadline, state.branding?.dateFormat) || '<span class="muted">—</span>';
    const asstDL = formatDateDisplay(asg.assistantDeadline || '', state.branding?.dateFormat) || '<span class="muted">—</span>';

    rows += `
      <tr>
        <td>${asg.title}</td>
        <td>${badgeHtmlByKey(stStatusKey)}</td>
        <td>${studentFile}</td>
        <td>${badgeHtmlByKey(chkKey)}</td>
        <td>${grade}</td>
        <td>${comment}</td>
        <td>${chkFile}</td>
        <td>${stuDL}</td>
        <td>${asstDL}</td>
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
            <th>Student DL</th>
            <th>Assistant DL</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9"><span class="muted">No assignments found.</span></td></tr>'}</tbody>
      </table>
    </div>`;
}

// ---------- Students tab renderer ----------
function renderStudentsTab(){
  const byAsst = _assistantNameByIdMap();
  const tbody = document.querySelector('#h-students-table tbody');
  if (!tbody) return;

  const q = (document.querySelector('#h-stu-search')?.value || '').trim().toLowerCase();

  let students = (state.head?.students || []).slice();
  if (q) {
    students = students.filter(s =>
      (s.studentName||'').toLowerCase().includes(q) ||
      (s.email||'').toLowerCase().includes(q)
    );
  }

  tbody.innerHTML = '';

  students.forEach(st=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><button class="btn ghost h-roster-expand" data-id="${st.studentId}" aria-expanded="false" title="Expand">►</button></td>
      <td><b>${st.studentName || '—'}</b></td>
      <td>${st.email || ''}</td>
      <td>${byAsst.get(st.assistantId) || '—'}</td>
      <td>${st.course || ''}</td>
      <td>${st.unit || ''}</td>
      <td><span class="badge ${String(st.status||'Active').toLowerCase()==='active' ? 'ok' : 'warn'}">${st.status||'Active'}</span></td>
    `;
    tbody.appendChild(tr);

    const tr2 = document.createElement('tr');
    tr2.className = 'h-roster-expand-row hidden';
    tr2.dataset.for = st.studentId;
    tr2.innerHTML = `<td colspan="7">${buildPerStudentAssignmentsTable_Head(st)}</td>`;
    tbody.appendChild(tr2);
  });

  // Event delegation: toggle expanders
  // Event delegation: toggle expanders (bind ONCE)
if (!tbody._wiredExpand) {
  tbody._wiredExpand = true;
  tbody.addEventListener('click', (e)=>{
    const btn = e.target.closest('.h-roster-expand');
    if (!btn) return;
    const id = btn.dataset.id;
    const row = tbody.querySelector(`tr.h-roster-expand-row[data-for="${id}"]`);
    if (!row) return;
    const isHidden = row.classList.contains('hidden');
    row.classList.toggle('hidden', !isHidden);
    btn.textContent = isHidden ? '▼' : '►';
    btn.setAttribute('aria-expanded', String(isHidden));
  });
}

  // Wire search (only once)
  const search = document.querySelector('#h-stu-search');
  if (search && !search._wired){
    search._wired = true;
    search.addEventListener('input', renderStudentsTab);
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
function studentOpenNow(asg){
  const open = (asg.studentOpen === true || String(asg.studentOpen) === 'true');
  if (!open) return false;
  const dl = parseMaybeISO(asg.studentDeadline || asg.deadline);
  if (dl && new Date() > dl) return false;
  return true;
}

// ===================== render ===================== //

// --- Charts: Head / Analytics (real data) ---
function renderHeadAnalytics(){
  const h = state.head && typeof state.head === 'object' ? state.head : { assistants: [], checks: [] };
  h.assistants = Array.isArray(h.assistants) ? h.assistants : [];
  h.checks     = Array.isArray(h.checks) ? h.checks : [];

  // ---------- Helpers ----------
  const byId = new Map((h.assistants||[]).map(a => [a.userId, a.displayName || a.userId]));

  // Parse grade to 0..100 (supports "18/20", "90%", "87")
  const toPct = (g) => {
    if (!g) return null;
    const s = String(g).trim();
    if (!s) return null;
    if (s.endsWith('%')) {
      const n = parseFloat(s.slice(0, -1));
      return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    }
    if (s.includes('/')) {
      const [a,b] = s.split('/').map(x=>parseFloat(x));
      if (isFinite(a) && isFinite(b) && b > 0) return Math.max(0, Math.min(100, (a/b)*100));
      return null;
    }
    const n = parseFloat(s);
    return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  };

  // Month window for bar (same logic as backend summarizeAnalytics)
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

  // ---------- BAR: Checks per assistant (this month, by assignment.course) ----------
const checksForBar = Array.isArray(h.checksByCourse) ? h.checksByCourse : (h.checks || []);

const barAgg = {};
checksForBar.forEach(c=>{
  const t = new Date(c.updatedAt || c.createdAt || 0);
  if (t >= monthStart) {
    const id = c.assistantId || 'unknown';
    barAgg[id] = (barAgg[id] || 0) + 1;
  }
});

const barLabels = (h.assistants||[]).map(a => byId.get(a.userId));
const barData   = (h.assistants||[]).map(a => barAgg[a.userId] || 0);

  const barEl = $('#h-bar');
  if (barEl) {
    if (barEl._chart) barEl._chart.destroy();
    // eslint-disable-next-line no-undef
    barEl._chart = new Chart(barEl, {
      type: 'bar',
      data: { labels: barLabels, datasets: [{ label: 'Checks (this month)', data: barData }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

    // ---------- DOUGHNUT: Status breakdown (ALL submission statuses like Student) ----------
  const donutCounts = { Submitted:0, 'Submitted Late':0, Resubmitted:0, Missing:0, Pending:0, Checked:0, Redo:0 };

  // Iterate across student × assignment pairs in the head's course
  const checksForGrades = Array.isArray(h.checksByCourse) ? h.checksByCourse : (h.checks || []);
  checksForGrades.forEach(c=>{
    const theseStudents = (h.students || []).filter(s => (s.course||'') === (asg.course||''));
    theseStudents.forEach(st => {
      const k = _h_singleStatusFor(asg, st.studentId);
      if (k === 'submitted') donutCounts.Submitted++;
      else if (k === 'late') donutCounts['Submitted Late']++;
      else if (k === 'resubmitted') donutCounts.Resubmitted++;
      else if (k === 'missing') donutCounts.Missing++;
      else if (k === 'checked') donutCounts.Checked++;
      else if (k === 'redo') donutCounts.Redo++;
      else donutCounts.Pending++;
    });
  });

  const donutEl = $('#h-donut');
  if (donutEl) {
    if (donutEl._chart) donutEl._chart.destroy();
    // eslint-disable-next-line no-undef
    donutEl._chart = new Chart(donutEl, {
      type: 'doughnut',
      data: { labels: Object.keys(donutCounts), datasets: [{ data: Object.values(donutCounts) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  // ---------- LINE: Avg grade by week (last 8 weeks) ----------
  const weeks = [];
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate() - 7*7); // ~7 weeks back, we’ll produce 8 buckets
  start.setHours(0,0,0,0);

  // Build week buckets starting from start’s Monday (or locale week start)
  const weekStart = new Date(start);
  const day = weekStart.getDay(); // 0..6 (Sun..Sat)
  const deltaToMonday = (day === 0) ? -6 : (1 - day);
  weekStart.setDate(weekStart.getDate() + deltaToMonday);

  for (let i=0; i<8; i++){
    const ws = new Date(weekStart); ws.setDate(weekStart.getDate() + i*7);
    const we = new Date(ws); we.setDate(ws.getDate()+7);
    weeks.push({ ws, we, sum:0, n:0 });
  }

  (h.checks||[]).forEach(c=>{
    const t = new Date(c.updatedAt || c.createdAt || 0);
    const g = toPct(c.grade);
    if (g==null) return;
    for (const w of weeks){
      if (t >= w.ws && t < w.we){ w.sum += g; w.n += 1; break; }
    }
  });

  const lineLabels = weeks.map(w=> {
    const m = (w.ws.getMonth()+1).toString().padStart(2,'0');
    const d = w.ws.getDate().toString().padStart(2,'0');
    return `${m}/${d}`;
  });
  const lineData = weeks.map(w => w.n ? +(w.sum / w.n).toFixed(1) : 0);

  const lineEl = $('#h-line');
  if (lineEl) {
    if (lineEl._chart) lineEl._chart.destroy();
    // eslint-disable-next-line no-undef
    lineEl._chart = new Chart(lineEl, {
      type: 'line',
      data: { labels: lineLabels, datasets: [{ label: 'Avg grade (%)', data: lineData, tension: 0.3, fill: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });
  }
}

function renderHead(){
  const h = state.head;

  // KPIs
  const kAsst = $('#h-kpi-assistants'); if (kAsst) kAsst.textContent = h.assistants.length;
  const kStud = $('#h-kpi-students');   if (kStud) kStud.textContent = h.students.length;
  const openCount = h.assignments.filter(a=> assistantOpenNow(a)).length;
  const kAssign = $('#h-kpi-assignments'); if (kAssign) kAssign.textContent = openCount;

  // roster
  const rt = $('#h-roster tbody');
  if (rt){
    rt.innerHTML='';
    h.students.forEach(s=>{
      const asst = h.assistants.find(a=>a.userId===s.assistantId);
      const tr=document.createElement('tr');
      tr.innerHTML = `<td>${s.studentName}</td><td>${asst?asst.displayName:'—'}</td><td>${s.course}</td><td>${s.unit}</td>`;
      rt.appendChild(tr);
    });
  }

  // selectors
  const sSel = $('#h-studentSelect');
  if (sSel){
    sSel.innerHTML='';
    h.students.forEach(s=>{
      const o=document.createElement('option');
      o.value=s.studentId; o.textContent=`${s.studentName} · ${s.unit}`;
      sSel.appendChild(o);
    });
  }
  const aSel = $('#h-assistantSelect');
  if (aSel){
    aSel.innerHTML='';
    h.assistants.forEach(a=>{
      const o=document.createElement('option');
      o.value=a.userId; o.textContent=a.displayName;
      aSel.appendChild(o);
    });
  }

  // assignments table (read-only)
  const at = $('#h-assignments-table tbody');
  if (at){
    at.innerHTML='';
    h.assignments.forEach(x=>{
      const stuDL  = formatDateDisplay(x.studentDeadline || x.deadline || '', state.branding.dateFormat);
      const asstDL = formatDateDisplay(x.assistantDeadline || '', state.branding.dateFormat);
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td><b>${x.title}</b><div class="muted">${x.course} · ${x.unit||''}</div></td>
        <td>${x.unit||''}</td>
        <td>${stuDL}</td>
        <td>${asstDL}</td>
        <td>${x.requireGrade
              ? '<span class="badge ok">Yes</span>'
              : '<span class="badge danger">No</span>'}</td>
        <td>${ studentOpenNow(x) ? '<span class="badge ok">Active</span>' 
                         : '<span class="badge warn">Closed</span>' }</td>
        <td>${ assistantOpenNow(x) ? '<span class="badge ok">Active</span>' 
                           : '<span class="badge warn">Closed</span>' }</td>
        <td>${x.countInSalary
              ? '<span class="badge ok">Yes</span>'
              : '<span class="badge danger">No</span>'}</td>
        <td>${x.studentFileUrl? `<a href="${x.studentFileUrl}" target="_blank">File</a>` : '<span class="muted">none</span>'}</td>
        <td class="cell-actions">
          <button class="btn h-edit" data-id="${x.assignmentId}">Edit</button>
          <button class="btn ghost h-del" data-id="${x.assignmentId}">Delete</button>
        </td>`;
      at.appendChild(tr);
    });

    // attach row-level actions (kept here, but guarded)
    $$('.h-edit').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-id');
        const asg = state.head.assignments.find(a=>a.assignmentId===id);
        if (!asg) return;
        state.head.editingId = id;
        $('#h-a-titlebar').textContent = 'Edit Assignment';
        $('#h-a-edit-hint').classList.remove('hidden');
        hide($('#h-create-assignment')); show($('#h-update-assignment')); show($('#h-cancel-edit'));

        $('#h-a-title').value = asg.title || '';
        $('#h-a-unit').value = asg.unit || '';
        $('#h-a-stu-open').checked = !!(asg.studentOpen===true || String(asg.studentOpen)==='true');
        $('#h-a-asst-open').checked = !!(asg.assistantOpen===true || String(asg.assistantOpen)==='true');
        $('#h-a-stu-deadline').value = formatDateForInput(asg.studentDeadline || asg.deadline || '');
        $('#h-a-asst-deadline').value = formatDateForInput(asg.assistantDeadline || '');
        $('#h-a-requireGrade').checked = !!(asg.requireGrade===true || String(asg.requireGrade)==='true');
        $('#h-a-salary').checked = !!(asg.countInSalary===true || String(asg.countInSalary)==='true');
        $('#h-a-file').value = ''; // cannot prefill for security
        const cur = $('#h-a-file-current');
        if (cur) {
          cur.innerHTML = asg.studentFileUrl
            ? `Current: <a href="${asg.studentFileUrl}" target="_blank" rel="noopener">file</a>`
            : `<span class="muted">No file uploaded</span>`;
        }
        $('#h-create-msg').textContent = 'Editing…';
      });
    });

    $$('.h-del').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if (inflight.delete) return;
        if(!confirm('Delete this assignment?')) return;

        inflight.delete = true;
        const id = btn.getAttribute('data-id');
        try{
          btn.disabled = true;
          await api('deleteAssignment',{assignmentId:id});
          await reloadHeadUI(); // refresh data without rewiring
        }catch(e){
          alert('Delete failed: '+e.message);
        }finally{
          inflight.delete = false;
          btn.disabled = false;
        }
      });
    });
  }
  // charts (real data)
  renderHeadAnalytics();
  renderStudentsTab(); // ADDED
}
  

// ===================== small refresh (no rewiring) ===================== //
async function reloadHeadUI() {
  await loadHeadData(_lastDemo);
  renderHead();
}

// ===================== uploads ===================== //
async function headUploadFileMaybe(assignmentId){
  const inp = $('#h-a-file');
  if (inp && inp.files && inp.files[0]){
    const up = await uploadFileBase64(inp.files[0], { action:'head.uploadAssignmentFile', assignmentId });
    if (up && up.fileUrl){
      await api('updateAssignment',{assignmentId, patch:{ studentFileUrl: up.fileUrl }});
    }
  }
}

// ===================== events (wired once) ===================== //

function wireHeadChecksEvents(){
  // changes
  document.addEventListener('change', (e)=>{
    if (e.target?.id==='hchk-status') _h_enforceGradeRules();
    if (e.target?.id==='hchk-assignmentSelect') { _h_refreshStudentsForSelection(); _h_applyPolicyNote(); }
    if (e.target?.id==='hchk-assistantFilter') { _h_refreshStudentsForSelection(); }
  });

  // cancel
  $('#hchk-cancel')?.addEventListener('click', ()=>{
    $('#hchk-edit-hint')?.classList.add('hidden'); $('#hchk-cancel')?.classList.add('hidden');
    $('#hchk-submit-msg').textContent='';
    $('#hchk-status').value='Checked'; $('#hchk-grade').value=''; $('#hchk-comment').value='';
    if ($('#hchk-file')) { $('#hchk-file').value=''; delete $('#hchk-file').dataset.currentUrl; }
    const cur = $('#hchk-file-current'); if (cur) cur.textContent='';
  });

  // save
  $('#hchk-submit')?.addEventListener('click', async ()=>{
    if (inflight.check) return;
    inflight.check = true;
    const btn  = $('#hchk-submit');
    const spin = $('#hchk-spin'); // optional <span id="hchk-spin" class="spinner hidden"></span>
    setLoading(btn, true, spin);
    const assignmentId = $('#hchk-assignmentSelect')?.value;
    const studentId = $('#hchk-studentSelect')?.value;
    const status = $('#hchk-status')?.value;
    const gradeRaw = $('#hchk-grade')?.value?.trim();
    const comment = $('#hchk-comment')?.value?.trim();
    const fileInput = $('#hchk-file');
    const msg = $('#hchk-submit-msg');

    if (!assignmentId){ msg.textContent='Choose an assignment.'; 
                       setLoading(btn, false, spin); inflight.check = false;
                       return; }
    if (!studentId){ msg.textContent='Choose a student.'; 
                    setLoading(btn, false, spin); inflight.check = false;
                    return; }

    // enforce grade rules client-side
    const asg = _h_asgById(assignmentId);
    const requireGrade = !!(asg?.requireGrade===true || String(asg?.requireGrade)==='true');
    if ((String(status).toLowerCase()==='missing' || !requireGrade) && gradeRaw){
      msg.textContent='Grade not allowed for this status/assignment.'; 
      setLoading(btn, false, spin); inflight.check = false;
      return;
    }

    const payload = { assignmentId, studentId, status, grade: gradeRaw, comment };
    if (fileInput?.files && fileInput.files[0]){
      const up = await uploadFileBase64(fileInput.files[0], { action:'head.uploadCheckFile', studentId, assignmentId });
      if (up?.fileUrl) payload.fileUrl = up.fileUrl;
    }

    try{
      const r = await api('head.submitCheck', payload);
      if (r?.created)      msg.textContent = 'Created ✅';
      else if (r?.updated) msg.textContent = 'Updated ✏️';
      else                 msg.textContent = 'Saved ✅';

      // reset file line
      if (fileInput){ fileInput.value=''; delete fileInput.dataset.currentUrl; }
      const cur = $('#hchk-file-current'); if (cur) cur.textContent='';
      $('#hchk-edit-hint')?.classList.add('hidden'); $('#hchk-cancel')?.classList.add('hidden');

      // refresh dashboard data + UI
      await reloadHeadUI();
      // re-seed selects to preserve current assignment filter value
      $('#hchk-assignmentSelect').value = assignmentId;
      _h_refreshStudentsForSelection();
      _h_applyPolicyNote();
    }catch(err){
      msg.textContent = 'Failed: '+err.message;
    } finally {
      setLoading(btn, false, spin);
      inflight.check = false;
    }
  });
}

function seedHeadChecksTab(){
  // fill assignments: ALL in course (unfiltered)
  const asSel = $('#hchk-assignmentSelect'); if (asSel){
    asSel.innerHTML='';
    (state.head?.assignments||[]).forEach(x=>{
      const opt = document.createElement('option');
      const dl = x.assistantDeadline ? ` · Asst DL ${formatDateDisplay(x.assistantDeadline)}` : '';
      opt.value = x.assignmentId;
      opt.textContent = `${x.title} · ${x.unit||''}${dl}`;
      asSel.appendChild(opt);
    });
  }
  _h_fillAssistantFilter();
  _h_refreshStudentsForSelection();
  _h_applyPolicyNote();
  _h_enforceGradeRules();
}

function wireEvents(){
  if (_wired) return;     // guard against double-wiring
  _wired = true;

  $('#h-reassign')?.addEventListener('click', async()=>{
    if (inflight.reassign) return;
    inflight.reassign = true;

    const btn = $('#h-reassign'); const spin = $('#h-reassign-spin');
    setLoading(btn,true,spin);
    const studentId = $('#h-studentSelect').value;
    const assistantId = $('#h-assistantSelect').value;
    try{
      await api('reassignStudent',{studentId, assistantId});
      $('#h-reassign-msg').textContent='Reassigned ✅';
      await reloadHeadUI();
    }catch(err){
      $('#h-reassign-msg').textContent='Failed: '+err.message;
    }finally{
      inflight.reassign = false;
      setLoading(btn,false,spin);
    }
  });

  $('#h-create-assignment')?.addEventListener('click', async()=>{
    if (inflight.create) return;
    inflight.create = true;

    const btn = $('#h-create-assignment'); const spin = $('#h-create-spin');
    setLoading(btn,true,spin);
    const title=$('#h-a-title').value.trim();
    const course  = (state.user && state.user.course) || '';
    const unit=$('#h-a-unit').value.trim();
    const studentOpen = $('#h-a-stu-open').checked;
    const studentDeadline=$('#h-a-stu-deadline').value;
    const assistantOpen = $('#h-a-asst-open').checked;
    const assistantDeadline=$('#h-a-asst-deadline').value;
    const requireGrade=$('#h-a-requireGrade').checked;
    const countInSalary=$('#h-a-salary').checked;

    try{
      // idempotency key (good to pass through to backend)
      const clientRequestId =
        (crypto?.randomUUID?.() ?? `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      const createRes = await api('createAssignment',{
        title, course, unit,
        deadline: studentDeadline,
        studentOpen, studentDeadline,
        assistantOpen, assistantDeadline,
        requireGrade, countInSalary,
        clientRequestId
      });

      const assignmentId = createRes.assignmentId;
      await headUploadFileMaybe(assignmentId);

      $('#h-create-msg').textContent='Created ✅';
      $('#h-a-title').value=''; $('#h-a-unit').value='';
      $('#h-a-stu-deadline').value=''; $('#h-a-asst-deadline').value='';
      $('#h-a-stu-open').checked=true; $('#h-a-asst-open').checked=true;
      $('#h-a-requireGrade').checked=true; $('#h-a-salary').checked=false;
      $('#h-a-file').value='';

      await reloadHeadUI();
    }catch(err){
      $('#h-create-msg').textContent='Failed: '+err.message;
    }finally{
      inflight.create = false;
      setLoading(btn,false,spin);
    }
  });

  $('#h-update-assignment')?.addEventListener('click', async()=>{
    if (inflight.update) return;
    inflight.update = true;

    const btn = $('#h-update-assignment'); const spin = $('#h-update-spin');
    setLoading(btn,true,spin);
    try{
      const id = state.head.editingId;
      const patch = {
        title: $('#h-a-title').value.trim(),
        unit: $('#h-a-unit').value.trim(),
        studentOpen: $('#h-a-stu-open').checked,
        assistantOpen: $('#h-a-asst-open').checked,
        studentDeadline: $('#h-a-stu-deadline').value,
        assistantDeadline: $('#h-a-asst-deadline').value,
        requireGrade: $('#h-a-requireGrade').checked,
        countInSalary: $('#h-a-salary').checked
      };
      await api('updateAssignment',{assignmentId:id, patch});
      await headUploadFileMaybe(id);
      $('#h-create-msg').textContent='Updated ✅';

      // reset edit state
      state.head.editingId = null;
      $('#h-a-titlebar').textContent='Create Assignment';
      $('#h-a-edit-hint').classList.add('hidden');
      show($('#h-create-assignment')); hide($('#h-update-assignment')); hide($('#h-cancel-edit'));
      $('#h-a-title').value=''; $('#h-a-unit').value='';
      $('#h-a-stu-deadline').value=''; $('#h-a-asst-deadline').value='';
      $('#h-a-stu-open').checked=true; $('#h-a-asst-open').checked=true;
      $('#h-a-requireGrade').checked=true; $('#h-a-salary').checked=false;
      $('#h-a-file').value='';
      const cur = $('#h-a-file-current'); if (cur) cur.textContent='';

      await reloadHeadUI();
    }catch(e){
      $('#h-create-msg').textContent='Failed: '+e.message;
    }finally{
      inflight.update = false;
      setLoading(btn,false,spin);
    }
  });

  $('#h-cancel-edit')?.addEventListener('click', ()=>{
    state.head.editingId = null;
    $('#h-a-titlebar').textContent='Create Assignment';
    $('#h-a-edit-hint').classList.add('hidden');
    show($('#h-create-assignment')); hide($('#h-update-assignment')); hide($('#h-cancel-edit'));
    $('#h-create-msg').textContent='';
    $('#h-a-title').value=''; $('#h-a-unit').value='';
    $('#h-a-stu-deadline').value=''; $('#h-a-asst-deadline').value='';
    $('#h-a-stu-open').checked=true; $('#h-a-asst-open').checked=true;
    $('#h-a-requireGrade').checked=true; $('#h-a-salary').checked=false;
    $('#h-a-file').value='';
    const cur = $('#h-a-file-current'); if (cur) cur.textContent='';
  });
}

// ===================== data ===================== //
async function loadHeadData(demo=false){
  if(demo){
    state.head.assistants=[
      {userId:'a-1', displayName:'Sara Ali'},
      {userId:'a-2', displayName:'Khaled Samir'},
      {userId:'a-3', displayName:'Noura H.'},
    ];
    state.head.students=[
      {studentId:'s1', studentName:'Omar Hassan', course:'Math', unit:'U1', assistantId:'a-1'},
      {studentId:'s2', studentName:'Mariam Adel', course:'Math', unit:'U1', assistantId:'a-2'},
      {studentId:'s3', studentName:'Youssef N.', course:'Math', unit:'U2', assistantId:'a-1'},
    ];
    state.head.assignments=[
      {assignmentId:'as1', title:'Homework 5', course:'Math', unit:'U1', requireGrade:true, studentOpen:true, assistantOpen:true, studentDeadline:'2025-09-10', assistantDeadline:'2025-09-12', countInSalary:false, studentFileUrl:''},
    ];
    state.head.analytics={};
  } else {
    const res = await api('getHeadDashboard',{}); Object.assign(state.head,res);
  }
}

// ===================== lifecycle ===================== //
// 1) Mount: load the tab shells + wire tabs (no data yet)
export async function mount(){
  showPageLoader(true);
  try{
    await loadTabHtml('h-home',        'views/roles/head/tabs/home.html');
    await loadTabHtml('h-assign',      'views/roles/head/tabs/assign.html');
    await loadTabHtml('h-assignments', 'views/roles/head/tabs/assignments.html');
    await loadTabHtml('h-students',   'views/roles/head/tabs/students.html');
    await loadTabHtml('h-checks',     'views/roles/head/tabs/checks.html');   // ← NEW (before analytics)
    await loadTabHtml('h-analytics',   'views/roles/head/tabs/analytics.html');
    wireTabs('#view-head');
  } finally {
    showPageLoader(false);
  }
}

// 2) Boot: fetch data and render; wire events only once
export async function boot(demo=false){
  _lastDemo = !!demo;
  showPageLoader(true);
  try{
    await loadHeadData(_lastDemo);
    renderHead();
    wireEvents(); // guarded by _wired
    wireHeadChecksEvents();       // ← NEW
    // seed the head checks tab after data load
    seedHeadChecksTab();          // ← NEW
    if (state.user?.role === 'head') {
      const inp = $('#h-a-course'); if (inp) inp.value = state.user.course || '';
    }
  } finally {
    showPageLoader(false);
  }
}
