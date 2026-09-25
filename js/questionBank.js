// === QUESTION BANK MODULE ===
// A "bank question" is a row in `questions` with assessment_id = null,
// owned by the logged-in teacher (teacher_id). Once a question is added
// to a test (see assessments.js), its assessment_id is set and it moves
// out of the bank view into that test.

async function nextQuestionNumber() {
    const { data } = await window.mySupabase
        .from('questions')
        .select('question_number')
        .eq('teacher_id', window.APP.currentUserId)
        .order('question_number', { ascending: false })
        .limit(1);
    if (data && data.length > 0 && data[0].question_number) return data[0].question_number + 1;
    return 1;
}

async function saveManualQuestion() {
    const msg = document.getElementById('teacher-msg');
    const text = document.getElementById('q-text').value.trim();
    const a = document.getElementById('opt-a').value.trim();
    const b = document.getElementById('opt-b').value.trim();
    const c = document.getElementById('opt-c').value.trim();
    const d = document.getElementById('opt-d').value.trim();
    const e = document.getElementById('opt-e').value.trim();
    const correctIndex = parseInt(document.getElementById('correct-opt').value, 10);
    const correctLetter = ['A', 'B', 'C', 'D', 'E'][correctIndex];

    if (!text || !a || !b || !c || !d || !e) {
        msg.innerText = "Please fill in the question and all five options.";
        msg.style.color = "#d9534f";
        return;
    }

    try {
        if (editingQId) {
            const { error } = await window.mySupabase.from('questions').update({
                question_text: text, option_a: a, option_b: b, option_c: c, option_d: d, option_e: e,
                correct_answer: correctLetter,
                image: currentImageBase64 !== undefined ? currentImageBase64 : null
            }).eq('id', editingQId);
            if (error) { msg.innerText = `Save failed: ${error.message}`; msg.style.color = "#d9534f"; return; }
            msg.innerText = "Question updated successfully!";
        } else {
            const qNum = await nextQuestionNumber();
            const { error } = await window.mySupabase.from('questions').insert([{
                teacher_id: window.APP.currentUserId,
                assessment_id: null,
                question_text: text, option_a: a, option_b: b, option_c: c, option_d: d, option_e: e,
                correct_answer: correctLetter,
                question_number: qNum,
                image: currentImageBase64,
                source: 'manual'
            }]);
            if (error) { msg.innerText = `Save failed: ${error.message}`; msg.style.color = "#d9534f"; return; }
            msg.innerText = "Question saved to bank!";
        }
        msg.style.color = "#28a745";
        cancelQuestionEdit();
        renderQuestionBank();
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
}

function cancelQuestionEdit() {
    editingQId = null;
    currentImageBase64 = null;
    document.getElementById('edit-q-id').value = "";
    document.getElementById('manual-form-title').innerText = "Create Question (Options A to E)";
    document.getElementById('q-text').value = "";
    document.getElementById('opt-a').value = "";
    document.getElementById('opt-b').value = "";
    document.getElementById('opt-c').value = "";
    document.getElementById('opt-d').value = "";
    document.getElementById('opt-e').value = "";
    document.getElementById('correct-opt').value = "0";
    document.getElementById('q-image-file').value = "";
    showImagePreview(null);
    document.getElementById('save-q-btn').innerText = "Save Question to Quiz";
    document.getElementById('cancel-edit-btn').classList.add('hidden');
}

async function editQuestion(qId) {
    const { data, error } = await window.mySupabase.from('questions').select('*').eq('id', qId).single();
    if (error || !data) return;
    editingQId = qId;
    currentImageBase64 = data.image || null;
    document.getElementById('edit-q-id').value = qId;
    document.getElementById('manual-form-title').innerText = "Edit Question";
    document.getElementById('q-text').value = data.question_text;
    document.getElementById('opt-a').value = data.option_a;
    document.getElementById('opt-b').value = data.option_b;
    document.getElementById('opt-c').value = data.option_c;
    document.getElementById('opt-d').value = data.option_d;
    document.getElementById('opt-e').value = data.option_e;
    const letterToIndex = { A: 0, B: 1, C: 2, D: 3, E: 4 };
    document.getElementById('correct-opt').value = letterToIndex[data.correct_answer] ?? 0;
    showImagePreview(data.image);
    document.getElementById('save-q-btn').innerText = "Update Question";
    document.getElementById('cancel-edit-btn').classList.remove('hidden');
    switchTeacherTab('manual');
}

// --- Question Bank tab: list + select + delete ---
async function renderQuestionBank() {
    const container = document.getElementById('qb-questions-list');
    if (!window.APP.currentUserId) { container.innerHTML = ""; return; }
    container.innerHTML = "<p style='text-align:center;color:#888;'>Loading...</p>";

    try {
        const { data, error } = await window.mySupabase
            .from('questions')
            .select('*')
            .eq('teacher_id', window.APP.currentUserId)
            .is('assessment_id', null)
            .order('question_number');

        if (error) { container.innerHTML = `<p style="color:#d9534f;">Failed to load: ${error.message}</p>`; return; }
        if (!data || data.length === 0) {
            container.innerHTML = "<p style='text-align:center;color:#888;'>No unassigned questions in your bank yet. Create some above, or import a PDF.</p>";
            return;
        }

        container.innerHTML = "";
        const letters = ['A', 'B', 'C', 'D', 'E'];
        data.forEach(q => {
            const opts = [q.option_a, q.option_b, q.option_c, q.option_d, q.option_e];
            const card = document.createElement('div');
            card.className = 'qb-card';
            const hasImg = !!q.image;
            card.innerHTML = `
                <div class="qb-card-header">
                    <div class="qb-card-header-left">
                        <input type="checkbox" class="qb-select" data-id="${q.id}">
                        <div>
                            <div class="qb-q-title">Q${q.question_number}: ${q.question_text}</div>
                            <span style="font-size:11px;color:#888;">source: ${q.source}${q.batch_id ? ' · batch ' + q.batch_id : ''}</span>
                        </div>
                    </div>
                    <div class="action-btn-group">
                        <button class="btn-secondary" style="width:auto;" onclick="editQuestion('${q.id}')">Edit</button>
                        <button class="btn-danger" style="width:auto;" onclick="deleteSingleQuestion('${q.id}')">Delete</button>
                    </div>
                </div>
                ${hasImg ? `<div class="q-diagram-container"><img class="q-diagram-img" src="${q.image}"></div>` : ''}
                <ul class="qb-opts-list">
                    ${letters.map((l, i) => `<li>${l}. ${opts[i]} ${q.correct_answer === l ? '<span class="qb-correct-badge">CORRECT</span>' : ''}</li>`).join('')}
                </ul>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
    }
}

function toggleSelectAll(isChecked) {
    document.querySelectorAll('.qb-select').forEach(cb => cb.checked = isChecked);
}

function getSelectedQuestionIds() {
    return Array.from(document.querySelectorAll('.qb-select:checked')).map(cb => cb.dataset.id);
}

async function deleteSingleQuestion(qId) {
    if (!confirm("Delete this question permanently?")) return;
    const { error } = await window.mySupabase.from('questions').delete().eq('id', qId);
    if (!error) renderQuestionBank();
}

async function deleteSelectedQuestions() {
    const ids = getSelectedQuestionIds();
    if (ids.length === 0) { alert("No questions selected."); return; }
    if (!confirm(`Delete ${ids.length} selected question(s) permanently?`)) return;
    const { error } = await window.mySupabase.from('questions').delete().in('id', ids);
    if (!error) renderQuestionBank();
}

async function deleteAllStudentQuestions() {
    if (!confirm("Delete ALL unassigned bank questions for you as a teacher? This cannot be undone.")) return;
    const { error } = await window.mySupabase
        .from('questions').delete()
        .eq('teacher_id', window.APP.currentUserId)
        .is('assessment_id', null);
    if (!error) renderQuestionBank();
}
