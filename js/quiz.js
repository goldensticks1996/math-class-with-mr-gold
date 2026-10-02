// === STUDENT QUIZ MODULE ===
// Students see the tests assigned to them (assessment_assignments) that they
// have not yet submitted, pick one, and take it. Each attempt is a row in
// `attempts`; each answer given is a row in `answers`.
//
// While a test is open, answers live in memory only (quizState.answers) so the
// student can move freely, skip, go back and change answers. Everything is
// written to the database together, once, when the test is submitted.

let quizState = {
    assessmentId: null,
    attemptId: null,
    questions: [],
    index: 0,
    answers: {},          // questionId -> 'A'..'E'
    endTime: 0,           // timestamp (ms) when time runs out
    timerInterval: null,
    allowCalculator: false,
    submitting: false,
    pendingResult: null   // result text held back while the "time is up" pop-up is showing
};

const QUIZ_LETTERS = ['A', 'B', 'C', 'D', 'E'];

function isMissingColumnError(error, column) {
    return !!error && (error.code === '42703' || new RegExp(column).test(error.message || ''));
}

async function loadAssignedAssessments() {
    const listEl = document.getElementById('available-tests-list');
    const quizContainer = document.getElementById('quiz-container');
    const resultsContainer = document.getElementById('quiz-results');
    quizContainer.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    listEl.innerHTML = "<p style='color:#888;'>Loading your tests...</p>";

    try {
        let { data: assignments, error } = await window.mySupabase
            .from('assessment_assignments')
            .select('assessment_id, assessment(id, title, subject, duration_minutes, allow_calculator)')
            .eq('student_id', window.APP.currentUserId);

        // Database not updated with the calculator column yet - load tests without it.
        if (error && isMissingColumnError(error, 'allow_calculator')) {
            ({ data: assignments, error } = await window.mySupabase
                .from('assessment_assignments')
                .select('assessment_id, assessment(id, title, subject, duration_minutes)')
                .eq('student_id', window.APP.currentUserId));
        }

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
                    <p style="font-size:13px;color:#666;">${test.subject} · ${test.duration_minutes} minutes${test.allow_calculator ? ' · Calculator allowed' : ''}</p>
                    <button class="btn-gold" onclick="startQuiz(${test.id}, ${test.duration_minutes}, ${test.allow_calculator ? 'true' : 'false'})">Start Test</button>`;
            }
            listEl.appendChild(card);
        });
    } catch (err) {
        listEl.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
    }
}

async function startQuiz(assessmentId, durationMinutes, allowCalculator) {
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

        // Who made this test (so they can be told when it is finished)
        let teacherId = null, testTitle = 'a test';
        try {
            const { data: meta } = await window.mySupabase.from('assessment').select('teacher_id, title').eq('id', assessmentId).single();
            if (meta) { teacherId = meta.teacher_id; testTitle = meta.title || testTitle; }
        } catch (e) { /* notification is optional */ }

        if (quizState.timerInterval) clearInterval(quizState.timerInterval);
        quizState = {
            assessmentId, attemptId: attempt.id, questions, index: 0, answers: {},
            endTime: Date.now() + durationMinutes * 60 * 1000,
            timerInterval: null, allowCalculator: !!allowCalculator, submitting: false, pendingResult: null,
            teacherId, testTitle
        };

        document.getElementById('quiz-container').classList.remove('hidden');
        document.getElementById('quiz-results').classList.add('hidden');
        document.getElementById('available-tests-list').innerHTML = "";
        document.getElementById('quiz-submit-btn').disabled = false;

        // The calculator only exists on the page when the teacher allowed it for this test.
        const calcBtn = document.getElementById('calc-toggle-btn');
        calcBtn.classList.toggle('hidden', !quizState.allowCalculator);
        removeCalculator();

        refreshQuizUi();
        updateTimerDisplay();
        quizState.timerInterval = setInterval(updateTimerDisplay, 1000);
        window.totalExamTimer = quizState.timerInterval;
    } catch (err) {
        alert("Unable to connect to database.");
    }
}

function updateTimerDisplay() {
    if (quizState.submitting) return;
    const remaining = Math.max(0, Math.ceil((quizState.endTime - Date.now()) / 1000));
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    document.getElementById('timer-text').innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (remaining <= 0) {
        // Time is up: submit immediately, no confirmation.
        finishQuiz(true);
    }
}

// ---------- Rendering ----------
function refreshQuizUi() {
    renderQuizNav();
    loadQuestion();
}

function answeredCount() {
    return quizState.questions.filter(q => quizState.answers[q.id]).length;
}

function updateQuizProgress() {
    const total = quizState.questions.length;
    const answered = answeredCount();
    document.getElementById('quiz-progress-label').innerText =
        `Question ${quizState.index + 1} of ${total} · ${answered} answered`;
    document.getElementById('quiz-progress-fill').style.width = `${total ? Math.round((answered / total) * 100) : 0}%`;
}

// Numbered squares: red = not answered, green = answered, ring = current question.
function renderQuizNav() {
    const nav = document.getElementById('quiz-nav');
    nav.innerHTML = '';
    quizState.questions.forEach((q, i) => {
        const answered = !!quizState.answers[q.id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qnav-btn ' + (answered ? 'answered' : 'unanswered') + (i === quizState.index ? ' current' : '');
        btn.innerText = i + 1;
        btn.setAttribute('aria-label', `Question ${i + 1}, ${answered ? 'answered' : 'not answered'}`);
        if (i === quizState.index) btn.setAttribute('aria-current', 'true');
        btn.onclick = () => goToQuestion(i);
        nav.appendChild(btn);
    });
}

function loadQuestion() {
    const q = quizState.questions[quizState.index];
    document.getElementById('question-title').innerHTML = `Q${quizState.index + 1}: ${formatQText(q.question_text)}`;

    // Reading passage (shown on every question the teacher tied it to)
    const passageBox = document.getElementById('question-passage');
    if (q.passage) {
        passageBox.innerHTML = `<div class="q-passage-label">📖 Read the passage</div>${formatPassageHtml(q.passage)}`;
        passageBox.classList.remove('hidden');
    } else {
        passageBox.classList.add('hidden');
    }
    updateQuizProgress();

    const imgBox = document.getElementById('question-image-box');
    if (q.image) {
        document.getElementById('question-img').src = q.image;
        imgBox.classList.remove('hidden');
    } else {
        imgBox.classList.add('hidden');
    }

    const optsContainer = document.getElementById('options-container');
    optsContainer.innerHTML = "";
    const opts = [q.option_a, q.option_b, q.option_c, q.option_d, q.option_e];
    const chosen = quizState.answers[q.id];
    opts.forEach((optText, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option-btn' + (chosen === QUIZ_LETTERS[i] ? ' selected' : '');
        btn.setAttribute('aria-pressed', chosen === QUIZ_LETTERS[i] ? 'true' : 'false');
        btn.innerHTML = `${QUIZ_LETTERS[i]}. ${formatQText(optText)}`;
        btn.onclick = () => selectAnswer(QUIZ_LETTERS[i]);
        optsContainer.appendChild(btn);
    });

    document.getElementById('quiz-prev-btn').disabled = quizState.index === 0;
    document.getElementById('quiz-next-btn').disabled = quizState.index === quizState.questions.length - 1;
}

// ---------- Answering + moving around ----------
// Picking an option only records it (and turns it blue). It never moves to the
// next question and never submits anything, so a double-click can't skip or lose an answer.
function selectAnswer(selectedLetter) {
    if (quizState.submitting) return;
    const q = quizState.questions[quizState.index];
    quizState.answers[q.id] = selectedLetter;
    refreshQuizUi();
}

function goToQuestion(i) {
    if (quizState.submitting) return;
    if (i < 0 || i >= quizState.questions.length) return;
    quizState.index = i;
    refreshQuizUi();
}
function quizPrev() { goToQuestion(quizState.index - 1); }
function quizNext() { goToQuestion(quizState.index + 1); }

// ---------- Submitting ----------
function requestSubmitQuiz() {
    if (quizState.submitting) return;
    const unanswered = quizState.questions.length - answeredCount();
    const warn = document.getElementById('quiz-confirm-unanswered');
    if (unanswered > 0) {
        warn.innerText = `You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'} (shown in red).`;
        warn.classList.remove('hidden');
    } else {
        warn.classList.add('hidden');
    }
    document.getElementById('quiz-confirm-overlay').classList.remove('hidden');
}

function cancelSubmitQuiz() {
    document.getElementById('quiz-confirm-overlay').classList.add('hidden');
}

function confirmSubmitQuiz() {
    document.getElementById('quiz-confirm-overlay').classList.add('hidden');
    finishQuiz(false);
}

async function finishQuiz(autoSubmitted) {
    if (quizState.submitting) return; // already submitting - ignore repeat clicks / timer ticks
    quizState.submitting = true;
    clearInterval(quizState.timerInterval);
    cancelSubmitQuiz();
    removeCalculator();
    document.getElementById('quiz-submit-btn').disabled = true;

    const total = quizState.questions.length;
    let score = 0;
    const answerRows = [];
    quizState.questions.forEach(q => {
        const picked = quizState.answers[q.id];
        if (!picked) return;
        const isCorrect = picked === q.correct_answer;
        if (isCorrect) score++;
        answerRows.push({ attempt_id: quizState.attemptId, question_id: q.id, selected_answer: picked, is_correct: isCorrect });
    });
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    const resultText = `You scored ${score} out of ${total} (${percentage}%)`;
    const emoji = percentage >= 80 ? '🎉' : percentage >= 50 ? '👍' : '💪';

    // Lock the test screen straight away so nothing more can be answered.
    document.getElementById('quiz-container').classList.add('hidden');

    if (autoSubmitted) {
        quizState.pendingResult = { resultText, emoji };
        document.getElementById('quiz-auto-overlay').classList.remove('hidden');
    }

    // Submit the whole test at once.
    try {
        if (answerRows.length > 0) await window.mySupabase.from('answers').insert(answerRows);
    } catch (e) { /* the attempt total below is still recorded */ }
    try {
        await window.mySupabase.from('attempts').update({
            score, total, percentage, status: 'submitted', submitted_at: new Date().toISOString()
        }).eq('id', quizState.attemptId);
    } catch (e) { /* score still shown locally even if the update fails */ }

    // Tell the teacher this student has finished and their report card is ready for review.
    if (quizState.teacherId) {
        await sendNotification('teacher', quizState.teacherId, 'test_submitted', 'Test completed',
            `${window.APP.currentUser || 'A student'} has completed "${quizState.testTitle}" and their report card is ready for review.`,
            { student_id: window.APP.currentUserId, assessment_id: quizState.assessmentId, attempt_id: quizState.attemptId });
    }

    if (!autoSubmitted) showQuizResults(resultText, emoji);
}

function showQuizResults(resultText, emoji) {
    document.getElementById('quiz-container').classList.add('hidden');
    document.getElementById('quiz-results').classList.remove('hidden');
    document.getElementById('score-text').innerText = resultText;
    document.getElementById('result-emoji').innerText = emoji;
}

function acknowledgeAutoSubmit() {
    document.getElementById('quiz-auto-overlay').classList.add('hidden');
    const r = quizState.pendingResult;
    quizState.pendingResult = null;
    if (r) showQuizResults(r.resultText, r.emoji);
}

function restartQuiz() {
    document.getElementById('quiz-results').classList.add('hidden');
    loadAssignedAssessments();
}

// Called on logout so nothing from one student's test leaks into the next session.
function resetQuizUi() {
    if (quizState.timerInterval) clearInterval(quizState.timerInterval);
    quizState.submitting = true;
    quizState.pendingResult = null;
    ['quiz-confirm-overlay', 'quiz-auto-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    removeCalculator();
}

// ============================================================
// SCIENTIFIC CALCULATOR
// Built on the page only when the teacher ticked "Allow Calculator" for the test.
// Expressions are parsed by a small hand-written parser - nothing is passed to eval().
// ============================================================

const calcState = { expr: '', deg: true, ans: 0, justEvaluated: false };

// [label, text to insert (or action:name), style class]
const CALC_KEYS = [
    ['DEG', 'action:deg', 'ck-fn'], ['(', '(', 'ck-fn'], [')', ')', 'ck-fn'], ['⌫', 'action:back', 'ck-clear'], ['AC', 'action:clear', 'ck-clear'],
    ['sin', 'sin(', 'ck-fn'], ['cos', 'cos(', 'ck-fn'], ['tan', 'tan(', 'ck-fn'], ['π', 'π', 'ck-fn'], ['e', 'e', 'ck-fn'],
    ['sin⁻¹', 'asin(', 'ck-fn'], ['cos⁻¹', 'acos(', 'ck-fn'], ['tan⁻¹', 'atan(', 'ck-fn'], ['x²', '^2', 'ck-fn'], ['√', '√(', 'ck-fn'],
    ['log', 'log(', 'ck-fn'], ['ln', 'ln(', 'ck-fn'], ['10ˣ', '10^(', 'ck-fn'], ['eˣ', 'e^(', 'ck-fn'], ['xʸ', '^', 'ck-fn'],
    ['7', '7', 'ck-num'], ['8', '8', 'ck-num'], ['9', '9', 'ck-num'], ['÷', '÷', 'ck-op'], ['%', '%', 'ck-op'],
    ['4', '4', 'ck-num'], ['5', '5', 'ck-num'], ['6', '6', 'ck-num'], ['×', '×', 'ck-op'], ['n!', '!', 'ck-op'],
    ['1', '1', 'ck-num'], ['2', '2', 'ck-num'], ['3', '3', 'ck-num'], ['−', '−', 'ck-op'], ['Ans', 'ans', 'ck-fn'],
    ['0', '0', 'ck-num'], ['.', '.', 'ck-num'], ['1/x', '1/(', 'ck-fn'], ['+', '+', 'ck-op'], ['=', 'action:eq', 'ck-eq']
];

function buildCalculator() {
    if (document.getElementById('quiz-calc')) return;
    const panel = document.createElement('div');
    panel.id = 'quiz-calc';
    panel.className = 'calc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Scientific calculator');
    panel.innerHTML = `
        <div class="calc-head">
            <span>Scientific Calculator</span>
            <button type="button" class="calc-close" aria-label="Close calculator" onclick="toggleCalculator(false)">✕</button>
        </div>
        <div class="calc-screen">
            <div class="calc-expr" id="calc-expr"></div>
            <div class="calc-result" id="calc-result">0</div>
        </div>
        <div class="calc-grid">
            ${CALC_KEYS.map(([label, val, cls]) =>
                `<button type="button" class="ck ${cls}" data-val="${val}" ${val === 'action:deg' ? 'id="calc-deg-btn"' : ''}>${label}</button>`).join('')}
        </div>`;
    panel.querySelector('.calc-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('.ck');
        if (btn) calcPress(btn.dataset.val);
    });
    document.body.appendChild(panel);
    calcRender();
}

function removeCalculator() {
    const panel = document.getElementById('quiz-calc');
    if (panel) panel.remove();
    calcState.expr = ''; calcState.ans = 0; calcState.justEvaluated = false; calcState.deg = true;
}

function toggleCalculator(force) {
    if (!quizState.allowCalculator || quizState.submitting) return;
    const exists = !!document.getElementById('quiz-calc');
    const open = typeof force === 'boolean' ? force : !exists;
    if (open) buildCalculator();
    else { const p = document.getElementById('quiz-calc'); if (p) p.remove(); }
}

function calcRender(resultText) {
    const exprEl = document.getElementById('calc-expr');
    const resEl = document.getElementById('calc-result');
    if (!exprEl) return;
    exprEl.innerText = calcState.expr || '';
    if (resultText !== undefined) resEl.innerText = resultText;
    const degBtn = document.getElementById('calc-deg-btn');
    if (degBtn) degBtn.innerText = calcState.deg ? 'DEG' : 'RAD';
}

function calcPress(val) {
    if (val === 'action:deg') { calcState.deg = !calcState.deg; calcRender(); return; }
    if (val === 'action:clear') { calcState.expr = ''; calcState.justEvaluated = false; calcRender('0'); return; }
    if (val === 'action:back') {
        // Remove a whole function name like "sin(" in one press, otherwise one character.
        calcState.expr = calcState.expr.replace(/(asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|log\(|ln\(|√\(|ans|.)$/, '');
        calcState.justEvaluated = false;
        calcRender(); return;
    }
    if (val === 'action:eq') {
        if (!calcState.expr.trim()) return;
        try {
            const v = calcEvaluate(calcState.expr, calcState.deg, calcState.ans);
            calcState.ans = v;
            calcState.justEvaluated = true;
            calcRender(calcFormat(v));
        } catch (e) {
            calcState.justEvaluated = false;
            calcRender('Error');
        }
        return;
    }
    // After "=", an operator continues from the answer; anything else starts fresh.
    if (calcState.justEvaluated) {
        const continuesFromAnswer = /^[÷×−+^%!]/.test(val);
        calcState.expr = continuesFromAnswer ? calcFormat(calcState.ans) : '';
        calcState.justEvaluated = false;
    }
    calcState.expr += val;
    calcRender();
}

function calcFormat(v) {
    return String(parseFloat(v.toPrecision(12)));
}

function calcEvaluate(src, deg, ans) {
    // Close any brackets the student left open.
    let s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/\s+/g, '');
    const open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    if (open > 0) s += ')'.repeat(open);

    // --- tokenise ---
    const toks = [];
    let i = 0;
    while (i < s.length) {
        const rest = s.slice(i);
        let m;
        if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) { toks.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; }
        else if ((m = /^(asin|acos|atan|sin|cos|tan|log|ln)/.exec(rest))) { toks.push({ t: 'f', name: m[0] }); i += m[0].length; }
        else if ((m = /^(pi|ans|e)/.exec(rest))) {
            toks.push({ t: 'n', v: m[0] === 'pi' ? Math.PI : m[0] === 'e' ? Math.E : ans });
            i += m[0].length;
        }
        else if ('+-*/^()!%√'.includes(rest[0])) { toks.push({ t: rest[0] }); i++; }
        else throw new Error('bad character');
    }

    // --- parse (recursive descent) ---
    let p = 0;
    const peek = () => toks[p];
    const startsOperand = (t) => t && (t.t === 'n' || t.t === 'f' || t.t === '(' || t.t === '√');

    function expect(sym) { if (!peek() || peek().t !== sym) throw new Error('expected ' + sym); p++; }

    function parseExpr() {
        let v = parseTerm();
        while (peek() && (peek().t === '+' || peek().t === '-')) {
            const op = toks[p++].t;
            const r = parseTerm();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    }
    function parseTerm() {
        let v = parseUnary();
        for (;;) {
            const t = peek();
            if (!t) break;
            if (t.t === '*' || t.t === '/') {
                p++;
                const r = parseUnary();
                v = t.t === '*' ? v * r : v / r;
            } else if (startsOperand(t)) {      // implicit multiplication: 2π, 3(4+1)
                v *= parseUnary();
            } else break;
        }
        return v;
    }
    function parseUnary() {
        if (peek() && peek().t === '-') { p++; return -parseUnary(); }
        if (peek() && peek().t === '+') { p++; return parseUnary(); }
        return parsePower();
    }
    function parsePower() {
        const base = parsePostfix();
        if (peek() && peek().t === '^') { p++; return Math.pow(base, parseUnary()); }
        return base;
    }
    function parsePostfix() {
        let v = parsePrimary();
        while (peek() && (peek().t === '!' || peek().t === '%')) {
            const op = toks[p++].t;
            if (op === '%') v = v / 100;
            else {
                if (v < 0 || v !== Math.floor(v) || v > 170) throw new Error('factorial');
                let f = 1;
                for (let k = 2; k <= v; k++) f *= k;
                v = f;
            }
        }
        return v;
    }
    function parsePrimary() {
        const t = toks[p++];
        if (!t) throw new Error('unexpected end');
        if (t.t === 'n') return t.v;
        if (t.t === '(') { const v = parseExpr(); expect(')'); return v; }
        if (t.t === '√') {
            const v = parsePrimary();
            if (v < 0) throw new Error('sqrt');
            return Math.sqrt(v);
        }
        if (t.t === 'f') {
            expect('(');
            const arg = parseExpr();
            expect(')');
            return applyFn(t.name, arg);
        }
        throw new Error('unexpected token');
    }
    function applyFn(name, x) {
        const toRad = (v) => deg ? v * Math.PI / 180 : v;
        const fromRad = (v) => deg ? v * 180 / Math.PI : v;
        const clean = (v) => Math.abs(v) < 1e-12 ? 0 : v;
        switch (name) {
            case 'sin': return clean(Math.sin(toRad(x)));
            case 'cos': return clean(Math.cos(toRad(x)));
            case 'tan':
                if (deg && Math.abs(((x - 90) % 180)) < 1e-9) throw new Error('tan undefined');
                return clean(Math.tan(toRad(x)));
            case 'asin': if (x < -1 || x > 1) throw new Error('domain'); return fromRad(Math.asin(x));
            case 'acos': if (x < -1 || x > 1) throw new Error('domain'); return fromRad(Math.acos(x));
            case 'atan': return fromRad(Math.atan(x));
            case 'log': if (x <= 0) throw new Error('domain'); return Math.log10(x);
            case 'ln': if (x <= 0) throw new Error('domain'); return Math.log(x);
        }
        throw new Error('unknown function');
    }

    const result = parseExpr();
    if (p !== toks.length) throw new Error('unexpected input');
    if (!isFinite(result)) throw new Error('not finite');
    return result;
}
