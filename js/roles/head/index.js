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
  const h = state.head || { assistants: [], checks: [] };

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

  // ---------- BAR: Checks per assistant (this month) ----------
  const barAgg = {};
  (h.checks||[]).forEach(c=>{
    const t = new Date(c.updatedAt || c.createdAt || 0);
    if (t >= monthStart) {
      const id = c.assistantId || 'unknown';
      barAgg[id] = (barAgg[id] || 0) + 1;
    }
  });
  // keep assistants order consistent
  const barLabels = (h.assistants||[]).map(a => byId.get(a.userId));
  const barData = (h.assistants||[]).map(a => barAgg[a.userId] || 0);

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

  // ---------- DOUGHNUT: Status breakdown (all checks) ----------
  const statusCounts = { Checked:0, Missing:0, Redo:0, Other:0 };
  (h.checks||[]).forEach(c=>{
    const s = String(c.status||'').trim().toLowerCase();
    if (!s) return;
    if (s==='checked') statusCounts.Checked++;
    else if (s==='missing') statusCounts.Missing++;
    else if (s==='redo') statusCounts.Redo++;
    else statusCounts.Other++;
  });

  const donutEl = $('#h-donut');
  if (donutEl) {
    if (donutEl._chart) donutEl._chart.destroy();
    // eslint-disable-next-line no-undef
    donutEl._chart = new Chart(donutEl, {
      type: 'doughnut',
      data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts) }] },
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
    if (state.user?.role === 'head') {
      const inp = $('#h-a-course'); if (inp) inp.value = state.user.course || '';
    }
  } finally {
    showPageLoader(false);
  }
}
