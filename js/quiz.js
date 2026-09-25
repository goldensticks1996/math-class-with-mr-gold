// === STUDENT QUIZ MODULE ===
// Students see the tests assigned to them (assessment_assignments) that they
// have not yet submitted, pick one, and take it. Each attempt is a row in
// `attempts`; each answer given is a row in `answers`.

let quizState = {
    assessmentId: null,
    attemptId: null,
    questions: [],
    index: 0,
    score: 0,
    timerInterval: null,
    secondsRemaining: 0
};

async function loadAssignedAssessments() {
    const listEl = document.getElementById('available-tests-list');
    const quizContainer = document.getElementById('quiz-container');
    const resultsContainer = document.getElementById('quiz-results');
    quizContainer.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    listEl.innerHTML = "<p style='color:#888;'>Loading your tests...</p>";

    try {
        const { data: assignments, error } = await window.mySupabase
            .from('assessment_assignments')
            .select('assessment_id, assessment(id, title, subject, duration_minutes)')
            .eq('student_id', window.APP.currentUserId);

        if (error) { listEl.innerHTML = `<p style="color:#d9534f;">${error.message}</p>`; return; }
        if (!assignments || assignments.length === 0) {
            listEl.innerHTML = "<p style='color:#888;'>No tests have been assigned to you yet.</p>";
            return;
        }

        const { data: submitted } = await window.mySupabase
            .from('attempts')
            .select('assessment_id, score, total, percentage, submitted_at')
            .eq('student_id', window.APP.currentUserId)
            .eq('status', 'submitted');
        const submittedMap = {};
        (submitted || []).forEach(s => { submittedMap[s.assessment_id] = s; });

        listEl.innerHTML = "";
        assignments.forEach(a => {
            const test = a.assessment;
            if (!test) return;
            const done = submittedMap[test.id];
            const card = document.createElement('div');
            card.className = 'qb-card';
            if (done) {
                card.innerHTML = `
                    <div class="qb-q-title">${test.title}</div>
                    <p style="font-size:13px;color:#666;">${test.subject} · Completed: ${done.score}/${done.total} (${done.percentage}%)</p>`;
            } else {
                card.innerHTML = `
                    <div class="qb-q-title">${test.title}</div>
                    <p style="font-size:13px;color:#666;">${test.subject} · ${test.duration_minutes} minutes</p>
                    <button class="btn-gold" onclick="startQuiz(${test.id}, ${test.duration_minutes})">Start Test</button>`;
            }
            listEl.appendChild(card);
        });
    } catch (err) {
        listEl.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
    }
}

async function startQuiz(assessmentId, durationMinutes) {
    const msg = document.getElementById('available-tests-list');
    try {
        const { data: questions, error } = await window.mySupabase
            .from('questions').select('*').eq('assessment_id', assessmentId).order('question_number');
        if (error || !questions || questions.length === 0) {
            alert("This test has no questions yet - ask your teacher.");
            return;
        }

        const now = new Date().toISOString();
        const { data: attempt, error: attemptErr } = await window.mySupabase
            .from('attempts')
            .insert([{
                student_id: window.APP.currentUserId, assessment_id: assessmentId,
                started_at: now, submitted_at: now, status: 'in_progress',
                score: 0, total: questions.length, percentage: 0
            }])
            .select().single();
        if (attemptErr || !attempt) { alert(`Could not start test: ${attemptErr?.message}`); return; }

        quizState = {
            assessmentId, attemptId: attempt.id, questions, index: 0, score: 0,
            timerInterval: null, secondsRemaining: durationMinutes * 60
        };

        document.getElementById('quiz-container').classList.remove('hidden');
        document.getElementById('quiz-results').classList.add('hidden');
        document.getElementById('available-tests-list').innerHTML = "";
        loadQuestion();
        quizState.timerInterval = setInterval(updateTimerDisplay, 1000);
        window.totalExamTimer = quizState.timerInterval;
    } catch (err) {
        alert("Unable to connect to database.");
    }
}

function updateTimerDisplay() {
    quizState.secondsRemaining--;
    const m = Math.floor(quizState.secondsRemaining / 60);
    const s = quizState.secondsRemaining % 60;
    document.getElementById('timer-text').innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (quizState.secondsRemaining <= 0) {
        clearInterval(quizState.timerInterval);
        finishQuiz();
    }
}

function loadQuestion() {
    const q = quizState.questions[quizState.index];
    document.getElementById('question-title').innerText = `Q${quizState.index + 1}: ${q.question_text}`;

    const imgBox = document.getElementById('question-image-box');
    if (q.image) {
        document.getElementById('question-img').src = q.image;
        imgBox.classList.remove('hidden');
    } else {
        imgBox.classList.add('hidden');
    }

    const optsContainer = document.getElementById('options-container');
    optsContainer.innerHTML = "";
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const opts = [q.option_a, q.option_b, q.option_c, q.option_d, q.option_e];
    opts.forEach((optText, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerText = `${letters[i]}. ${optText}`;
        btn.onclick = () => selectAnswer(letters[i]);
        optsContainer.appendChild(btn);
    });
}

async function selectAnswer(selectedLetter) {
    const q = quizState.questions[quizState.index];
    const isCorrect = selectedLetter === q.correct_answer;
    if (isCorrect) quizState.score++;

    try {
        await window.mySupabase.from('answers').insert([{
            attempt_id: quizState.attemptId, question_id: q.id,
            selected_answer: selectedLetter, is_correct: isCorrect
        }]);
    } catch (e) { /* if this fails the attempt total still gets recorded at finish */ }

    quizState.index++;
    if (quizState.index < quizState.questions.length) {
        loadQuestion();
    } else {
        clearInterval(quizState.timerInterval);
        finishQuiz();
    }
}

async function finishQuiz() {
    clearInterval(quizState.timerInterval);
    const total = quizState.questions.length;
    const percentage = total > 0 ? Math.round((quizState.score / total) * 100) : 0;

    try {
        await window.mySupabase.from('attempts').update({
            score: quizState.score, total, percentage,
            status: 'submitted', submitted_at: new Date().toISOString()
        }).eq('id', quizState.attemptId);
    } catch (e) { /* score still shown locally even if the update fails */ }

    document.getElementById('quiz-container').classList.add('hidden');
    document.getElementById('quiz-results').classList.remove('hidden');
    document.getElementById('score-text').innerText = `You scored ${quizState.score} out of ${total} (${percentage}%)`;
    const emoji = percentage >= 80 ? '🎉' : percentage >= 50 ? '👍' : '💪';
    document.getElementById('result-emoji').innerText = emoji;
}

function restartQuiz() {
    document.getElementById('quiz-results').classList.add('hidden');
    loadAssignedAssessments();
}
