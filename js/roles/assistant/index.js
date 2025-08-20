import { wireTabs } from '../../core/tabs.js';
import { $, $$, show, hide, showPageLoader } from '../../core/dom.js';
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
    const stuDL = formatDateDisplay(x.studentDeadline || x.deadline, state.branding.dateFormat);
    const asstDL = formatDateDisplay(x.assistantDeadline || '', state.branding.dateFormat);
    const statusBadge = assistantOpenNow(x)?'<span class="badge ok">Open</span>':'<span class="badge warn">Closed</span>';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${x.title}</td><td>${x.course}</td><td>${x.unit}</td><td>${stuDL}</td><td>${asstDL}</td><td>${statusBadge}</td>`;
    tb.appendChild(tr);
  });
}

function enforceGradeRules(){
  const status = $('#a-status').value.trim().toLowerCase();
  const gradeEl = $('#a-grade');
  const id = $('#a-assignmentSelect').value;
  const asg = state.assistant.assignments.find(x=> x.assignmentId===id);
  const gradeRequired = !asg ? true : (asg.requireGrade===true || String(asg.requireGrade)==='true');

  if (!gradeRequired){ gradeEl.value=''; gradeEl.disabled = true; gradeEl.placeholder = 'Disabled for this assignment'; return; }
  if (status === 'missing'){ gradeEl.value = ''; gradeEl.disabled = true; gradeEl.placeholder = 'Disabled for Missing'; }
  else { gradeEl.disabled = false; gradeEl.placeholder = 'e.g. 18/20 or 90%'; }
}

function applyAssignmentPolicyToForm(){
  const id = $('#a-assignmentSelect').value;
  const asg = state.assistant.assignments.find(x=> x.assignmentId===id);
  const gradeWrap = $('#a-grade-field'); const gradeEl = $('#a-grade'); const msg = $('#a-assignment-policy');
  let notes = [];
  if (!asg){ gradeWrap.classList.remove('hidden'); gradeEl.disabled=false; msg.textContent=''; return; }
  if (String(asg.requireGrade)==='false' || asg.requireGrade===false){
    gradeWrap.classList.add('hidden');
    gradeEl.value=''; gradeEl.disabled=true;
    notes.push('Grades are disabled for this assignment.');
  } else { gradeWrap.classList.remove('hidden'); gradeEl.disabled=false; }
  const openNow = assistantOpenNow(asg); let blocked = !openNow;
  if (!openNow){
    if (!(asg.assistantOpen===true || String(asg.assistantOpen)==='true')) notes.push('Assistant submissions are closed.');
    const dl = parseMaybeISO(asg.assistantDeadline);
    if (dl && new Date() > dl) notes.push('Assistant deadline has passed.');
  }
  $('#a-submit').disabled = blocked;
  msg.textContent = notes.join(' ');
  enforceGradeRules();
}

function refreshAssistantStudentLists(){
  const a = state.assistant;
  const assignmentId = $('#a-assignmentSelect').value;
  const sSel = $('#a-studentSelect'); sSel.innerHTML='';
  const existing = a.checks.filter(c=> c.assignmentId===assignmentId);
  const withRecord = new Set(existing.map(c=> c.studentId));
  const studentsNoRecord = a.students.filter(s=> !withRecord.has(s.studentId));
  const existingTable = $('#a-existing-table tbody'); existingTable.innerHTML='';

  studentsNoRecord.forEach(s=>{
    const opt=document.createElement('option'); opt.value=s.studentId; opt.textContent=s.studentName; sSel.appendChild(opt);
  });

  existing.forEach(c=>{
    const student = a.students.find(s=>s.studentId===c.studentId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${student?student.studentName:c.studentId}</td>
      <td>${c.status||''}</td>
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
  });

  $('#a-cancel')?.addEventListener('click', ()=>{
    $('#a-edit-hint').classList.add('hidden'); $('#a-cancel').classList.add('hidden'); $('#a-submit-msg').textContent='';
    $('#a-status').value = 'Checked'; $('#a-grade').value=''; $('#a-comment').value='';
  });

  $('#a-submit')?.addEventListener('click', async()=>{
    const assignmentId = $('#a-assignmentSelect').value;
    const asg = state.assistant.assignments.find(x=> x.assignmentId===assignmentId);
    const studentId = $('#a-studentSelect').value;
    const status = $('#a-status').value; const grade = $('#a-grade').value.trim();
    const comment = $('#a-comment').value.trim();
    const fileInput = $('#a-file');
    let fileUrl = '';

    try{
      if (!assignmentId) { $('#a-submit-msg').textContent = 'Choose an assignment.'; return; }
      if (!studentId) { $('#a-submit-msg').textContent = 'Choose a student.'; return; }
      const open = (asg?.assistantOpen===true || String(asg?.assistantOpen)==='true');
      const dl = parseMaybeISO(asg?.assistantDeadline);
      if (!open){ $('#a-submit-msg').textContent='Assistant submissions are closed by head.'; return; }
      if (dl && new Date() > dl){ $('#a-submit-msg').textContent='Assistant deadline has passed.'; return; }
      if((status.toLowerCase()==='missing' || (asg && (asg.requireGrade===false || String(asg.requireGrade)==='false'))) && grade){
        $('#a-submit-msg').textContent='Grade not allowed for this status/assignment.'; return;
      }
      if(fileInput?.files && fileInput.files[0]){
        fileUrl = (await uploadFileBase64(fileInput.files[0], { action:'uploadFile', studentId, assignmentId })).fileUrl;
      }
      const r = await api('submitCheck',{ assignmentId, studentId, status, grade, comment, fileUrl });
      $('#a-submit-msg').textContent = r?.updated ? 'Updated ✏️' : (r?.created ? 'Created ✅' : 'Saved ✅');
      await init(false); // refresh
      if ($('#a-file')) $('#a-file').value='';
      $('#a-edit-hint')?.classList.add('hidden'); $('#a-cancel')?.classList.add('hidden');
    }catch(err){ $('#a-submit-msg').textContent = 'Failed to save: '+err.message; }
  });
}

export async function init(demo){
  showPageLoader(true);
  try{
    // load tab shells
    await loadTabHtml('a-home',        'views/roles/assistant/tabs/home.html');
    await loadTabHtml('a-students',    'views/roles/assistant/tabs/students.html');
    await loadTabHtml('a-performance', 'views/roles/assistant/tabs/performance.html');

    wireTabs('#view-assistant');
    await loadAssistantData(demo);
    renderHome();
    // you can initialize charts here for performance tab, etc.
    wireEvents();

    // fill selects for students tab
    const asSel = $('#a-assignmentSelect'); asSel.innerHTML='';
    state.assistant.assignments.filter(assistantOpenNow).forEach(x=>{
      const opt=document.createElement('option'); opt.value=x.assignmentId;
      const dl = x.assistantDeadline ? ` · DL ${formatDateDisplay(x.assistantDeadline)}` : '';
      opt.textContent=`${x.title} · ${x.unit}${dl}`; asSel.appendChild(opt);
    });
    refreshAssistantStudentLists();
    applyAssignmentPolicyToForm();
  } finally { showPageLoader(false); }
}
