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
    const studentId = document.getElementById('assign-student').value;

    if (ids.length === 0) { msg.innerText = "Select at least one question first."; msg.style.color = "#d9534f"; return; }
    if (!title) { msg.innerText = "Give the test a title."; msg.style.color = "#d9534f"; return; }
    if (!subject) { msg.innerText = "Enter a subject for this test."; msg.style.color = "#d9534f"; return; }
    if (!minutes || minutes < 1) { msg.innerText = "Enter a valid time limit."; msg.style.color = "#d9534f"; return; }
    if (!studentId) { msg.innerText = "Select a student to assign the test to."; msg.style.color = "#d9534f"; return; }

    try {
        const { data: created, error: createErr } = await window.mySupabase
            .from('assessment')
            .insert([{ title, subject, duration_minutes: minutes, teacher_id: window.APP.currentUserId, assessment_type: assessmentType }])
            .select()
            .single();
        if (createErr || !created) { msg.innerText = `Failed to create test: ${createErr?.message}`; msg.style.color = "#d9534f"; return; }

        const { error: updateErr } = await window.mySupabase
            .from('questions').update({ assessment_id: created.id }).in('id', ids);
        if (updateErr) { msg.innerText = `Test created but failed to attach questions: ${updateErr.message}`; msg.style.color = "#d9534f"; return; }

        const { error: assignErr } = await window.mySupabase
            .from('assessment_assignments').insert([{ assessment_id: created.id, student_id: studentId }]);
        if (assignErr) { msg.innerText = `Test created but failed to assign: ${assignErr.message}`; msg.style.color = "#d9534f"; return; }

        msg.innerText = `"${title}" created with ${ids.length} question(s) and assigned!`;
        msg.style.color = "#28a745";
        document.getElementById('test-title').value = "";
        document.getElementById('test-subject').value = "Mathematics";
        renderQuestionBank();
        renderMyAssessments();
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
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

        const { data: students } = await window.mySupabase.from('students').select('id, name, username').order('name');

        container.innerHTML = "";
        for (const a of assessments) {
            const { count } = await window.mySupabase
                .from('assessment_assignments').select('id', { count: 'exact', head: true }).eq('assessment_id', a.id);
            const card = document.createElement('div');
            card.className = 'qb-card';
            const selectId = `reassign-select-${a.id}`;
            card.innerHTML = `
                <div class="qb-q-title">${a.title} <span style="font-weight:normal;font-size:12px;color:#888;">(${a.subject}, ${a.duration_minutes} min · assigned to ${count || 0})</span></div>
                <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
                    <select id="${selectId}" style="flex:1;">
                        ${(students || []).map(s => `<option value="${s.id}">${s.name || s.username}</option>`).join('')}
                    </select>
                    <button class="btn-gold" style="width:auto;" onclick="assignExistingTest(${a.id}, document.getElementById('${selectId}').value)">Assign</button>
                </div>
            `;
            container.appendChild(card);
        }
    } catch (err) {
        container.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
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
