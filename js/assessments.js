// === ASSESSMENTS MODULE ===
// A "test" is a row in `assessment`. Turning bank questions into a test means
// updating those questions' assessment_id. Assigning a test to a student is a
// row in `assessment_assignments`.

async function createTestFromSelected() {
    const msg = document.getElementById('teacher-msg');
    const ids = getSelectedQuestionIds();
    const title = document.getElementById('test-title').value.trim();
    const subject = document.getElementById('test-subject').value.trim();
    const assessmentType = document.getElementById('test-assessment-type').value;
    const minutes = parseInt(document.getElementById('quiz-duration').value, 10);
    const allowCalculator = !!(document.getElementById('test-allow-calculator') || {}).checked;

    if (ids.length === 0) { msg.innerText = "Select at least one question first."; msg.style.color = "#d9534f"; return; }
    if (!title) { msg.innerText = "Give the test a title."; msg.style.color = "#d9534f"; return; }
    if (!subject) { msg.innerText = "Pick a subject - add one in My Subjects if you haven't yet."; msg.style.color = "#d9534f"; return; }
    if (!minutes || minutes < 1) { msg.innerText = "Enter a valid time limit."; msg.style.color = "#d9534f"; return; }

    try {
        const newTest = { title, subject, duration_minutes: minutes, teacher_id: window.APP.currentUserId, assessment_type: assessmentType };
        if (allowCalculator) newTest.allow_calculator = true; // only sent when ticked, so tests without it work even before the column exists
        const { data: created, error: createErr } = await window.mySupabase
            .from('assessment')
            .insert([newTest])
            .select()
            .single();
        if (createErr && /allow_calculator/.test(createErr.message || '')) {
            msg.innerText = "The calculator option needs a one-time database update first (add the allow_calculator column to the assessment table). The test was not created.";
            msg.style.color = "#d9534f"; return;
        }
        if (createErr || !created) { msg.innerText = `Failed to create test: ${createErr?.message}`; msg.style.color = "#d9534f"; return; }

        const { error: updateErr } = await window.mySupabase
            .from('questions').update({ assessment_id: created.id }).in('id', ids);
        if (updateErr) { msg.innerText = `Test created but failed to attach questions: ${updateErr.message}`; msg.style.color = "#d9534f"; return; }

        // Deliberately NOT assigned to anyone: no student sees a test until the teacher assigns it.
        msg.innerText = `"${title}" created with ${ids.length} question(s). It is not assigned to any student yet - assign it under My Tests below.`;
        msg.style.color = "#28a745";
        document.getElementById('test-title').value = "";
        document.getElementById('test-allow-calculator').checked = false;
        renderQuestionBank();
        renderMyAssessments();
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
}

let eligibleBySubject = {};        // subject name -> [{id, name, username}] students who ticked it
let assignedByAssessment = {};     // assessmentId -> Set of student ids already assigned
let nameById = {};                 // studentId -> display name (covers eligible AND already-assigned students)
let subjectByAssessment = {};      // assessmentId -> subject name, so setAssignMode() knows which eligible list to use

function escHtml(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

async function renderMyAssessments() {
    const container = document.getElementById('my-assessments-list');
    if (!container || !window.APP.currentUserId) return;
    container.innerHTML = "<p style='color:#888;'>Loading...</p>";

    try {
        const { data: assessments, error } = await window.mySupabase
            .from('assessment').select('*').eq('teacher_id', window.APP.currentUserId).order('created_at', { ascending: false });
        if (error) { container.innerHTML = `<p style="color:#d9534f;">${error.message}</p>`; return; }
        if (!assessments || assessments.length === 0) {
            container.innerHTML = "<p style='color:#888;'>No tests created yet.</p>";
            return;
        }

        // One eligible-students lookup per distinct subject among these tests (a student
        // only ever shows up here if they ticked that subject on their own profile).
        eligibleBySubject = {};
        nameById = {};
        const subjectsNeeded = [...new Set(assessments.map(a => a.subject))];
        for (const subjectName of subjectsNeeded) {
            const students = await getStudentsForSubjectName(subjectName);
            eligibleBySubject[subjectName] = students;
            students.forEach(st => { nameById[st.id] = st.name || st.username; });
        }

        const { data: assignments } = await window.mySupabase
            .from('assessment_assignments').select('assessment_id, student_id')
            .in('assessment_id', assessments.map(a => a.id));
        assignedByAssessment = {};
        (assignments || []).forEach(r => {
            if (!assignedByAssessment[r.assessment_id]) assignedByAssessment[r.assessment_id] = new Set();
            assignedByAssessment[r.assessment_id].add(r.student_id);
        });

        // A student assigned earlier might have since unticked the subject - still need
        // their name for the chip, even though they'd no longer appear in a fresh pick list.
        const allAssignedIds = [...new Set((assignments || []).map(r => r.student_id))].filter(id => !(id in nameById));
        if (allAssignedIds.length > 0) {
            const { data: extra } = await window.mySupabase.from('students').select('id, name, username').in('id', allAssignedIds);
            (extra || []).forEach(st => { nameById[st.id] = st.name || st.username; });
        }

        container.innerHTML = "";
        for (const a of assessments) {
            const eligible = eligibleBySubject[a.subject] || [];
            subjectByAssessment[a.id] = a.subject;
            const assignedIds = Array.from(assignedByAssessment[a.id] || []);
            const chips = assignedIds.map(id => `<span style="display:inline-flex;align-items:center;gap:6px;background:#eef2ff;border-radius:20px;padding:3px 6px 3px 12px;margin:3px 4px 0 0;font-size:12px;color:#2c46b8;">${escHtml(nameById[id] || 'Unknown')}<span title="Remove from this test" style="cursor:pointer;color:#c0392b;font-weight:bold;padding:0 4px;" onclick="unassignStudent(${a.id}, ${id})">✕</span></span>`).join('');
            const statusHtml = assignedIds.length === 0
                ? `<span style="color:#c0392b;">Not assigned to any student yet</span>`
                : `Assigned to (${assignedIds.length}):<div style="max-height:96px;overflow-y:auto;margin-top:2px;">${chips}</div>`;
            const typeLabel = a.assessment_type === 'pop_quiz' ? 'Pop Quiz' : 'Monthly';

            const assignBlock = eligible.length === 0
                ? `<p style="font-size:13px;color:#888;">No students have ticked "${escHtml(a.subject)}" yet, so there's no one to assign this to.</p>`
                : `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin:0;cursor:pointer;">
                        <input type="radio" name="assign-mode-${a.id}" value="single" style="width:auto;" checked onchange="setAssignMode(${a.id}, 'single')"> Single student
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin:0;cursor:pointer;">
                        <input type="radio" name="assign-mode-${a.id}" value="multi" style="width:auto;" onchange="setAssignMode(${a.id}, 'multi')"> Multiple students
                    </label>
                </div>

                <div id="assign-single-${a.id}" style="display:flex;gap:8px;align-items:center;">
                    <select id="reassign-select-${a.id}" style="flex:1;">
                        ${eligible.map(st => `<option value="${st.id}">${escHtml(st.name || st.username)}</option>`).join('')}
                    </select>
                    <button class="btn-gold" style="width:auto;margin-top:0;" onclick="assignExistingTest(${a.id}, document.getElementById('reassign-select-${a.id}').value)">Assign</button>
                </div>

                <div id="assign-multi-${a.id}" class="hidden" data-rendered="0">
                    <input type="text" id="assign-search-${a.id}" placeholder="Search students..." oninput="filterAssignList(${a.id})" style="margin-bottom:6px;">
                    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin:4px 0;cursor:pointer;">
                        <input type="checkbox" style="width:auto;" onchange="toggleAssignShown(${a.id}, this.checked)"> Select all shown
                    </label>
                    <div id="assign-multi-list-${a.id}" style="max-height:200px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px;background:#fff;"></div>
                    <button class="btn-gold" style="margin-top:8px;" onclick="assignTestToMany(${a.id})">Assign To Selected Students</button>
                </div>`;

            const card = document.createElement('div');
            card.className = 'qb-card';
            card.innerHTML = `
                <div class="qb-q-title">${escHtml(a.title)} <span style="font-weight:normal;font-size:12px;color:#888;">(${escHtml(a.subject)} · ${typeLabel} · ${a.duration_minutes} min${a.allow_calculator ? ' · Calculator allowed' : ''})</span></div>
                <p style="font-size:13px;color:#555;margin:6px 0 10px;">${statusHtml}</p>
                ${assignBlock}
                <button class="btn-danger" style="width:auto;margin-top:12px;" onclick="deleteTest(${a.id})">Delete Test</button>
            `;
            container.appendChild(card);
        }
    } catch (err) {
        container.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
    }
}

function setAssignMode(assessmentId, mode) {
    const single = document.getElementById(`assign-single-${assessmentId}`);
    const multi = document.getElementById(`assign-multi-${assessmentId}`);
    if (mode === 'multi') {
        single.style.display = 'none';
        multi.classList.remove('hidden');
        if (multi.dataset.rendered !== '1') {   // build the long list only when it is actually needed
            const already = assignedByAssessment[assessmentId] || new Set();
            const eligible = eligibleBySubject[subjectByAssessment[assessmentId]] || [];
            document.getElementById(`assign-multi-list-${assessmentId}`).innerHTML = eligible.map(st => {
                const label = escHtml(st.name || st.username);
                const isAssigned = already.has(st.id);
                return `<label class="assign-row-${assessmentId}" data-name="${label.toLowerCase()}" style="display:flex;align-items:center;gap:8px;font-weight:normal;margin:5px 0;${isAssigned ? 'opacity:0.55;' : 'cursor:pointer;'}">
                    <input type="checkbox" class="assign-multi-${assessmentId}" value="${st.id}" style="width:auto;" ${isAssigned ? 'disabled' : ''}>
                    ${label}${isAssigned ? ' <em style="font-size:11px;">(already assigned)</em>' : ''}
                </label>`;
            }).join('') || "<p style='color:#888;'>No students have ticked this subject yet.</p>";
            multi.dataset.rendered = '1';
        }
    } else {
        multi.classList.add('hidden');
        single.style.display = 'flex';
    }
}

function filterAssignList(assessmentId) {
    const term = document.getElementById(`assign-search-${assessmentId}`).value.trim().toLowerCase();
    document.querySelectorAll(`.assign-row-${assessmentId}`).forEach(row => {
        row.style.display = row.dataset.name.includes(term) ? 'flex' : 'none';
    });
}

function toggleAssignShown(assessmentId, checked) {
    document.querySelectorAll(`.assign-row-${assessmentId}`).forEach(row => {
        if (row.style.display === 'none') return;
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb && !cb.disabled) cb.checked = checked;
    });
}

async function assignTestToMany(assessmentId) {
    const msg = document.getElementById('teacher-msg');
    const chosen = Array.from(document.querySelectorAll(`.assign-multi-${assessmentId}:checked`)).map(cb => cb.value);
    if (chosen.length === 0) {
        msg.innerText = "Tick at least one student first.";
        msg.style.color = "#d9534f";
        return;
    }
    try {
        const { error } = await window.mySupabase
            .from('assessment_assignments')
            .insert(chosen.map(studentId => ({ assessment_id: assessmentId, student_id: studentId })));
        if (error) {
            msg.innerText = error.code === '23505' ? "Some of those students were already assigned - refresh and try again." : `Failed to assign: ${error.message}`;
            msg.style.color = "#d9534f";
            return;
        }
        msg.innerText = `Test assigned to ${chosen.length} student(s)!`;
        msg.style.color = "#28a745";
        renderMyAssessments();
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
}

async function assignExistingTest(assessmentId, studentId) {
    const msg = document.getElementById('teacher-msg');
    if (!studentId) return;
    const { error } = await window.mySupabase
        .from('assessment_assignments')
        .insert([{ assessment_id: assessmentId, student_id: studentId }]);
    if (error) {
        // unique constraint = already assigned to this student, which is fine
        msg.innerText = error.code === '23505' ? "Already assigned to that student." : `Failed: ${error.message}`;
    } else {
        msg.innerText = "Test assigned!";
    }
    msg.style.color = "#28a745";
    renderMyAssessments();
}

const DELETE_BLOCKED_MSG = "The database blocked this delete (missing delete permission). Nothing was changed. " +
    "Run the 'delete policies' SQL block, then try again.";

async function deleteTest(assessmentId) {
    if (!confirm("Are you sure you want to delete this test?")) return;
    const msg = document.getElementById('teacher-msg');
    const db = window.mySupabase;

    try {
        // Questions must be detached first (they point at the test). Their content is kept - they go back to the bank.
        const { data: attached } = await db.from('questions').select('id').eq('assessment_id', assessmentId);
        const questionIds = (attached || []).map(q => q.id);
        if (questionIds.length > 0) {
            await db.from('questions').update({ assessment_id: null }).in('id', questionIds);
        }

        const { data: attempts } = await db.from('attempts').select('id').eq('assessment_id', assessmentId);
        const attemptIds = (attempts || []).map(a => a.id);
        if (attemptIds.length > 0) {
            await db.from('answers').delete().in('attempt_id', attemptIds);
            await db.from('attempts').delete().in('id', attemptIds);
        }
        await db.from('assessment_assignments').delete().eq('assessment_id', assessmentId);
        await db.from('assessment').delete().eq('id', assessmentId);

        // Verify it is really gone - a blocked delete does not raise an error, it just deletes nothing.
        const { data: stillThere } = await db.from('assessment').select('id').eq('id', assessmentId);
        if (stillThere && stillThere.length > 0) {
            if (questionIds.length > 0) {
                await db.from('questions').update({ assessment_id: assessmentId }).in('id', questionIds); // roll back
            }
            msg.innerText = DELETE_BLOCKED_MSG;
            msg.style.color = "#d9534f";
            renderMyAssessments();
            renderQuestionBank();
            return;
        }

        msg.innerText = "Test deleted. Its questions have been returned to your Question Bank.";
        msg.style.color = "#28a745";
        renderMyAssessments();
        renderQuestionBank();
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
}

async function unassignStudent(assessmentId, studentId) {
    const name = nameById[studentId] || 'this student';
    if (!confirm(`Remove ${name} from this test? They will no longer see it in their portal.`)) return;
    const msg = document.getElementById('teacher-msg');
    try {
        const { data: removed, error } = await window.mySupabase
            .from('assessment_assignments').delete()
            .eq('assessment_id', assessmentId).eq('student_id', studentId).select();
        if (error) { msg.innerText = `Failed to remove: ${error.message}`; msg.style.color = "#d9534f"; return; }
        if (!removed || removed.length === 0) { msg.innerText = DELETE_BLOCKED_MSG; msg.style.color = "#d9534f"; return; }
        msg.innerText = `${name} removed from the test.`;
        msg.style.color = "#28a745";
        renderMyAssessments();
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
}
