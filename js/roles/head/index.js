import { wireTabs } from '../core/tabs.js';
import { $, $$, show, hide, showPageLoader, setLoading } from '../core/dom.js';
import { api, uploadFileBase64 } from '../core/api.js';
import { state } from '../core/state.js';
import { formatDateDisplay, formatDateForInput, parseMaybeISO } from '../core/date.js';

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

function renderHead(){
  const h = state.head;
  $('#h-kpi-assistants').textContent = h.assistants.length;
  $('#h-kpi-students').textContent   = h.students.length;
  const openCount = h.assignments.filter(a=> assistantOpenNow(a)).length;
  $('#h-kpi-assignments').textContent = openCount;

  // roster
  const rt = $('#h-roster tbody'); if(rt){ rt.innerHTML='';
    h.students.forEach(s=>{
      const asst = h.assistants.find(a=>a.userId===s.assistantId);
      const tr=document.createElement('tr');
      tr.innerHTML = `<td>${s.studentName}</td><td>${asst?asst.displayName:'—'}</td><td>${s.course}</td><td>${s.unit}</td>`;
      rt.appendChild(tr);
    });
  }

  // selectors
  const sSel = $('#h-studentSelect'); if(sSel){ sSel.innerHTML='';
    h.students.forEach(s=>{ const o=document.createElement('option'); o.value=s.studentId; o.textContent=`${s.studentName} · ${s.unit}`; sSel.appendChild(o); });
  }
  const aSel = $('#h-assistantSelect'); if(aSel){ aSel.innerHTML='';
    h.assistants.forEach(a=>{ const o=document.createElement('option'); o.value=a.userId; o.textContent=a.displayName; aSel.appendChild(o); });
  }

  // assignments table (read-only view with actions)
  const at = $('#h-assignments-table tbody'); if(at){ at.innerHTML='';
    h.assignments.forEach(x=>{
      const stuDL = formatDateDisplay(x.studentDeadline || x.deadline || '', state.branding.dateFormat);
      const asstDL = formatDateDisplay(x.assistantDeadline || '', state.branding.dateFormat);
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td><b>${x.title}</b><div class="muted">${x.course} · ${x.unit||''}</div></td>
        <td>${x.unit||''}</td>
        <td>${stuDL}</td>
        <td>${asstDL}</td>
        <td>${(x.requireGrade?'Yes':'No')}</td>
        <td>${(x.studentOpen?'Yes':'No')}</td>
        <td>${(x.assistantOpen?'Yes':'No')}</td>
        <td>${(x.countInSalary?'Yes':'No')}</td>
        <td>${x.studentFileUrl? `<a href="${x.studentFileUrl}" target="_blank">File</a>` : '<span class="muted">none</span>'}</td>
        <td class="cell-actions">
          <button class="btn h-edit" data-id="${x.assignmentId}">Edit</button>
          <button class="btn ghost h-del" data-id="${x.assignmentId}">Delete</button>
        </td>`;
      at.appendChild(tr);
    });
  }

  // charts (demo)
  const ctx = $('#h-bar'); if(ctx){ if(ctx._chart) ctx._chart.destroy();
    const assistNames = h.assistants.map(a=>a.displayName);
    const counts = assistNames.map(()=> Math.floor(Math.random()*30)+5);
    ctx._chart = new Chart(ctx,{type:'bar',data:{labels:assistNames,datasets:[{label:'Checked papers',data:counts}]}})
  }
  const d1 = $('#h-donut'); if(d1){ if(d1._chart) d1._chart.destroy();
    d1._chart = new Chart(d1,{type:'doughnut',data:{labels:['Checked','Missing','Redo'],datasets:[{data:[60,25,15]}]}}) }
  const l1 = $('#h-line'); if(l1){ if(l1._chart) l1._chart.destroy();
    l1._chart = new Chart(l1,{type:'line',data:{labels:['W1','W2','W3','W4'],datasets:[{label:'Avg Grade',data:[72,78,81,85]}]}}) }

  // actions
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
      $('#h-a-file').value = '';
      $('#h-create-msg').textContent = 'Editing…';
    });
  });
  $$('.h-del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm('Delete this assignment?')) return;
      const id = btn.getAttribute('data-id');
      try{
        btn.disabled = true;
        await api('deleteAssignment',{assignmentId:id}); await init(); // reload
      }catch(e){ alert('Delete failed: '+e.message); }
      finally{ btn.disabled = false; }
    });
  });
}

async function headUploadFileMaybe(assignmentId){
  const inp = $('#h-a-file');
  if (inp && inp.files && inp.files[0]){
    const up = await uploadFileBase64(inp.files[0], { action:'head.uploadAssignmentFile', assignmentId });
    if (up && up.fileUrl){
      await api('updateAssignment',{assignmentId, patch:{ studentFileUrl: up.fileUrl }});
    }
  }
}

function wireEvents(){
  $('#h-reassign')?.addEventListener('click', async()=>{
    const btn = $('#h-reassign'); const spin = $('#h-reassign-spin');
    setLoading(btn,true,spin);
    const studentId = $('#h-studentSelect').value;
    const assistantId = $('#h-assistantSelect').value;
    try{
      await api('reassignStudent',{studentId, assistantId});
      $('#h-reassign-msg').textContent='Reassigned ✅';
      await init();
    }catch(err){
      $('#h-reassign-msg').textContent='Failed: '+err.message;
    }finally{
      setLoading(btn,false,spin);
    }
  });

  $('#h-create-assignment')?.addEventListener('click', async()=>{
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
      const createRes = await api('createAssignment',{
        title, course, unit,
        deadline: studentDeadline,
        studentOpen, studentDeadline,
        assistantOpen, assistantDeadline,
        requireGrade, countInSalary
      });
      const assignmentId = createRes.assignmentId;
      await headUploadFileMaybe(assignmentId);

      $('#h-create-msg').textContent='Created ✅';
      $('#h-a-title').value=''; $('#h-a-unit').value='';
      $('#h-a-stu-deadline').value=''; $('#h-a-asst-deadline').value='';
      $('#h-a-stu-open').checked=true; $('#h-a-asst-open').checked=true;
      $('#h-a-requireGrade').checked=true; $('#h-a-salary').checked=false;
      $('#h-a-file').value='';
      await init();
    }catch(err){ $('#h-create-msg').textContent='Failed: '+err.message }
    finally{ setLoading(btn,false,spin); }
  });

  $('#h-update-assignment')?.addEventListener('click', async()=>{
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
      state.head.editingId = null;
      $('#h-a-titlebar').textContent='Create Assignment';
      $('#h-a-edit-hint').classList.add('hidden');
      show($('#h-create-assignment')); hide($('#h-update-assignment')); hide($('#h-cancel-edit'));
      $('#h-a-title').value=''; $('#h-a-unit').value='';
      $('#h-a-stu-deadline').value=''; $('#h-a-asst-deadline').value='';
      $('#h-a-stu-open').checked=true; $('#h-a-asst-open').checked=true;
      $('#h-a-requireGrade').checked=true; $('#h-a-salary').checked=false;
      $('#h-a-file').value='';
      await init();
    }catch(e){ $('#h-create-msg').textContent='Failed: '+e.message; }
    finally{ setLoading(btn,false,spin); }
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
  });
}

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

export async function init(demo=false){
  showPageLoader(true);
  try{
    // load tab shells
    await loadTabHtml('h-home',        'views/roles/head/tabs/home.html');
    await loadTabHtml('h-assign',      'views/roles/head/tabs/assign.html');
    await loadTabHtml('h-assignments', 'views/roles/head/tabs/assignments.html');
    await loadTabHtml('h-analytics',   'views/roles/head/tabs/analytics.html');

    wireTabs('#view-head');
    await loadHeadData(demo);
    renderHead();
    wireEvents();

    // prefill course (same as original)
    if (state.user?.role === 'head') { const inp = $('#h-a-course'); if(inp) inp.value = state.user.course || ''; }
  } finally { showPageLoader(false); }
}
