// === MAIN UI GLUE: screens, tabs, image upload helpers, roster, gradebook ===

let currentImageBase64 = null;          // pending image for the manual-create form
let editingQbImageBase64 = null;        // pending image while editing a bank question
let editingQId = null;                  // question id currently being edited, or null

function showScreen(screenId) {
    ['login-screen', 'admin-dashboard', 'teacher-dashboard', 'student-dashboard'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
    document.body.classList.toggle('student-mode', screenId === 'student-dashboard');
    document.body.classList.toggle('shell-mode', screenId === 'student-dashboard' || screenId === 'teacher-dashboard');
    if (typeof onShellScreenChange === 'function') onShellScreenChange(screenId);
}

// Kept as a thin alias so existing call sites don't need to change -
// the actual student list is now built from the teacher's own subjects.
async function populateStudentDropdown() {
    await loadTeacherSubjects();
}

function handleStudentSelectionChange() {
    window.APP.selectedStudentId = document.getElementById('assign-student').value;
    cancelQuestionEdit();
    loadStudentGradebookData();
    renderRosterTable();
    renderQuestionBank();
    renderMyAssessments();
    if (!document.getElementById('report-tab').classList.contains('hidden')) refreshTeacherReportSubjects();
}

// Clears every piece of in-memory/DOM state left over from a previous
// session, so nothing from one teacher's workspace can ever bleed into
// the next teacher who logs in on the same browser tab.
function resetWorkspaceState() {
    if (document.getElementById('report-modal-overlay') && typeof closeReportModal === 'function') closeReportModal();
    editingQId = null;
    currentImageBase64 = null;
    editingQbImageBase64 = null;
    window._myProfilePhoto = null;
    const profileMsg = document.getElementById('profile-msg');
    if (profileMsg) profileMsg.innerText = '';
    if (typeof importReviewState !== 'undefined') {
        importReviewState = { questions: [], originalQuestions: [], leftoverImages: [] };
    }

    if (document.getElementById('q-text')) cancelQuestionEdit();

    const pdfInput = document.getElementById('pdf-file-input');
    if (pdfInput) pdfInput.value = '';
    const pdfSummary = document.getElementById('pdf-summary-box');
    if (pdfSummary) { pdfSummary.classList.add('hidden'); pdfSummary.innerHTML = ''; }
    const pdfReview = document.getElementById('pdf-review-list');
    if (pdfReview) pdfReview.innerHTML = '';
    const pdfSaveBtn = document.getElementById('pdf-save-all-btn');
    if (pdfSaveBtn) pdfSaveBtn.classList.add('hidden');

    const testTitle = document.getElementById('test-title');
    if (testTitle) testTitle.value = '';
    const testSubject = document.getElementById('test-subject');
    if (testSubject) testSubject.innerHTML = '';
    const testType = document.getElementById('test-assessment-type');
    if (testType) testType.value = 'monthly';
    const calcBox = document.getElementById('test-allow-calculator');
    if (calcBox) calcBox.checked = false;
    if (typeof resetQuizUi === 'function') resetQuizUi();
    const quizDuration = document.getElementById('quiz-duration');
    if (quizDuration) quizDuration.value = 15;
    const subjectFilter = document.getElementById('teacher-subject-filter');
    if (subjectFilter) subjectFilter.innerHTML = '';
    const subjectChips = document.getElementById('my-subjects-chips');
    if (subjectChips) subjectChips.innerHTML = '';
    myTeacherSubjects = [];

    ['teacher-msg', 'admin-msg', 'admin-error', 'login-error', 'login-msg'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '';
    });

    const selectAll = document.getElementById('qb-select-all');
    if (selectAll) selectAll.checked = false;

    if (document.getElementById('manual-tab')) switchTeacherTab('manual');
}

function switchStudentView(view) {
    document.getElementById('student-tests-view').classList.toggle('hidden', view !== 'tests');
    document.getElementById('student-reports-view').classList.toggle('hidden', view !== 'reports');
    document.getElementById('student-subjects-view').classList.toggle('hidden', view !== 'subjects');
    document.getElementById('student-profile-view').classList.toggle('hidden', view !== 'profile');
    document.querySelectorAll('#student-tab-bar button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    if (view === 'reports') loadMyReportCards();
    if (view === 'subjects') loadStudentSubjects();
    if (view === 'profile') loadStudentProfile();
}

function switchTeacherTab(tab) {
    ['manual-tab', 'pdf-tab', 'gradebook-tab', 'roster-tab', 'qbank-tab', 'report-tab', 'profile-tab'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(`${tab}-tab`).classList.remove('hidden');
    document.querySelectorAll('#teacher-tab-bar button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    if (tab === 'profile' && typeof renderTeacherProfile === 'function') renderTeacherProfile();

    // My Subjects + student selector are not needed on the Profile and Gradebook tabs.
    const hidePanels = (tab === 'profile' || tab === 'gradebook');
    document.getElementById('subjects-panel').classList.toggle('hidden', hidePanels);
    document.getElementById('target-panel').classList.toggle('hidden', hidePanels);

    if (tab === 'gradebook') loadStudentGradebookData();
    if (tab === 'roster') renderRosterTable();
    if (tab === 'qbank') { renderQuestionBank(); renderMyAssessments(); }
    if (tab === 'report') refreshTeacherReportSubjects();
}

async function renderRosterTable() {
    const list = document.getElementById('student-feed-list');
    list.innerHTML = "<p style='color:#888;text-align:center;'>Loading...</p>";
    try {
        if (myTeacherSubjects.length === 0) {
            list.innerHTML = "<p style='color:#888;'>Add a subject in My Subjects to see the students taking it.</p>";
            document.getElementById('total-student-count').innerText = 0;
            return;
        }
        const { data: subjRows } = await window.mySupabase.from('subjects').select('id, name').in('name', myTeacherSubjects.map(s => s.name));
        const subjectIds = (subjRows || []).map(r => r.id);
        const { data: links } = await window.mySupabase.from('student_subjects').select('student_id, subject_id').in('subject_id', subjectIds);
        const studentIds = [...new Set((links || []).map(l => l.student_id))];

        if (studentIds.length === 0) {
            list.innerHTML = "<p style='color:#888;'>No students have ticked any of your subjects yet.</p>";
            document.getElementById('total-student-count').innerText = 0;
            return;
        }

        const { data: students, error } = await window.mySupabase.from('students').select('id, name, username, password').in('id', studentIds).order('name');
        if (error || !students) { list.innerHTML = "<p style='color:#d9534f;'>Failed to load students.</p>"; return; }

        const { data: profiles } = await window.mySupabase.from('student_profiles').select('student_id, photo, class').in('student_id', studentIds);
        const profileById = {};
        (profiles || []).forEach(p => { profileById[p.student_id] = p; });

        const subjNameById = {};
        (subjRows || []).forEach(s => { subjNameById[s.id] = s.name; });
        const subjectsByStudent = {};
        (links || []).forEach(l => {
            if (!subjectsByStudent[l.student_id]) subjectsByStudent[l.student_id] = [];
            subjectsByStudent[l.student_id].push(subjNameById[l.subject_id]);
        });

        document.getElementById('total-student-count').innerText = students.length;
        list.innerHTML = students.map(s => {
            const photo = (profileById[s.id] && profileById[s.id].photo) || 'img/logo.png';
            const cls = (profileById[s.id] && profileById[s.id].class) || '';
            const subjects = (subjectsByStudent[s.id] || []).join(', ');
            return `
                <div class="student-feed-card" onclick="toggleStudentFeedCard(${s.id})">
                    <div class="student-feed-row">
                        <img src="${photo}" alt="">
                        <div>
                            <div class="student-feed-name">${s.name || s.username}</div>
                            <div class="student-feed-sub">${cls ? cls + ' · ' : ''}${subjects || 'No subjects listed'}</div>
                        </div>
                    </div>
                    <div class="student-feed-detail" id="feed-detail-${s.id}">
                        <p style="font-size:13px;color:#555;">Password: <strong>${s.password}</strong></p>
                        <p style="font-size:13px;color:#555;" id="feed-score-${s.id}">Loading latest test result...</p>
                        <button class="btn-info" style="width:auto;" onclick="event.stopPropagation(); goToGradebookFor(${s.id})">View Gradebook</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
    }
}

// --- Image upload helpers (manual-create form) ---
function handleManualImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        alert("Invalid image type. Please select a PNG, JPG, JPEG, or WEBP image.");
        event.target.value = "";
        return;
    }
    compressAndResizeImage(file, 800, 800, 0.85, (dataUrl) => {
        currentImageBase64 = dataUrl;
        showImagePreview(dataUrl);
    });
}

function showImagePreview(dataUrl) {
    const previewBox = document.getElementById('q-image-preview-box');
    const previewImg = document.getElementById('q-image-preview-img');
    if (dataUrl) {
        previewImg.src = dataUrl;
        previewBox.classList.remove('hidden');
    } else {
        previewImg.src = "";
        previewBox.classList.add('hidden');
    }
}

function removeManualImage() {
    currentImageBase64 = null;
    document.getElementById('q-image-file').value = "";
    showImagePreview(null);
}

function handleQbImageSelect(event, qId) {
    const file = event.target.files[0];
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        alert("Invalid image type. Please select a PNG, JPG, JPEG, or WEBP image.");
        event.target.value = "";
        return;
    }
    compressAndResizeImage(file, 800, 800, 0.85, (dataUrl) => {
        editingQbImageBase64 = dataUrl;
        const previewBox = document.getElementById(`qb-img-preview-box-${qId}`);
        const previewImg = document.getElementById(`qb-img-preview-img-${qId}`);
        if (previewBox && previewImg) {
            previewImg.src = dataUrl;
            previewBox.classList.remove('hidden');
        }
    });
}

function removeQbImage(qId) {
    editingQbImageBase64 = null;
    const fileInput = document.getElementById(`qb-img-file-${qId}`);
    if (fileInput) fileInput.value = "";
    const previewBox = document.getElementById(`qb-img-preview-box-${qId}`);
    const previewImg = document.getElementById(`qb-img-preview-img-${qId}`);
    if (previewBox && previewImg) {
        previewImg.src = "";
        previewBox.classList.add('hidden');
    }
}

function compressAndResizeImage(file, maxWidth, maxHeight, quality, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            let width = img.width, height = img.height;
            if (width > maxWidth || height > maxHeight) {
                if (width / height > maxWidth / maxHeight) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                } else {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- Gradebook (now reads real attempts for this teacher's assessments) ---
async function loadStudentGradebookData() {
    const studentId = document.getElementById('assign-student').value;
    const gbSel = document.getElementById('assign-student');
    const gbName = document.getElementById('gb-student-name');
    if (gbName) gbName.innerText = (studentId && gbSel.selectedIndex >= 0) ? gbSel.options[gbSel.selectedIndex].text : 'No student selected';
    const scoreDisplay = document.getElementById('gb-score-display');
    const dateDisplay = document.getElementById('gb-date-display');
    if (!studentId) { scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A"; return; }

    try {
        const { data: myAssessments } = await window.mySupabase
            .from('assessment').select('id, title').eq('teacher_id', window.APP.currentUserId);
        const ids = (myAssessments || []).map(a => a.id);
        if (ids.length === 0) { scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A"; return; }

        const { data: attempts, error } = await window.mySupabase
            .from('attempts')
            .select('score, total, percentage, submitted_at, assessment_id')
            .eq('student_id', studentId)
            .in('assessment_id', ids)
            .eq('status', 'submitted')
            .order('submitted_at', { ascending: false })
            .limit(1);

        if (error || !attempts || attempts.length === 0) {
            scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A";
            return;
        }
        const latest = attempts[0];
        scoreDisplay.innerText = `${latest.score} / ${latest.total} (${latest.percentage}%)`;
        dateDisplay.innerText = latest.submitted_at ? new Date(latest.submitted_at).toLocaleString() : 'N/A';
    } catch (e) {
        scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A";
    }
}

function downloadStudentReport() {
    const scoreText = document.getElementById('gb-score-display').innerText;
    const dateText = document.getElementById('gb-date-display').innerText;
    const studentName = document.getElementById('assign-student').selectedOptions[0]?.innerText || 'Student';
    const content = `Math Class with Mr. Gold - Academic Report\n\nStudent: ${studentName}\nLatest Score: ${scoreText}\nDate: ${dateText}\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${studentName}_report.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// Restore session on page load (survives a refresh within the same tab)
window.addEventListener('DOMContentLoaded', async () => {
    restoreSession();
    if (window.APP.currentRole === 'teacher') {
        await populateStudentDropdown();
        showScreen('teacher-dashboard');
    } else if (window.APP.currentRole === 'admin') {
        showScreen('admin-dashboard');
        loadPendingTeachers();
        populateAdminStudentDropdown();
    } else if (window.APP.currentRole === 'student') {
        document.getElementById('sticky-name').innerText = window.APP.currentUser;
        showScreen('student-dashboard');
        switchStudentView('tests');
        await loadAssignedAssessments();
        loadStudentProfile();
    }
});

async function toggleStudentFeedCard(studentId) {
    const detail = document.getElementById(`feed-detail-${studentId}`);
    if (!detail) return;
    const opening = !detail.classList.contains('open');
    detail.classList.toggle('open');
    if (opening && !detail.dataset.loaded) {
        detail.dataset.loaded = '1';
        try {
            const { data: myAssessments } = await window.mySupabase
                .from('assessment').select('id').eq('teacher_id', window.APP.currentUserId);
            const ids = (myAssessments || []).map(a => a.id);
            const scoreEl = document.getElementById(`feed-score-${studentId}`);
            if (ids.length === 0) { scoreEl.innerText = "No tests created yet."; return; }

            const { data: attempts } = await window.mySupabase
                .from('attempts').select('score, total, percentage, submitted_at')
                .eq('student_id', studentId).in('assessment_id', ids).eq('status', 'submitted')
                .order('submitted_at', { ascending: false }).limit(1);

            scoreEl.innerText = (attempts && attempts.length > 0)
                ? `Latest test: ${attempts[0].score}/${attempts[0].total} (${attempts[0].percentage}%)`
                : "No completed tests yet.";
        } catch (e) {
            const scoreEl = document.getElementById(`feed-score-${studentId}`);
            if (scoreEl) scoreEl.innerText = "Unable to load test result.";
        }
    }
}

async function goToGradebookFor(studentId) {
    try {
        // The assign-student dropdown only lists students for ONE selected subject filter.
        // Find a subject this student and this teacher actually share, switch the filter to
        // it, then select the student - otherwise a multi-subject teacher's click could
        // silently fail to select anyone.
        const { data: links } = await window.mySupabase.from('student_subjects').select('subject_id').eq('student_id', studentId);
        const studentSubjectIds = new Set((links || []).map(l => l.subject_id));
        const { data: subjRows } = await window.mySupabase.from('subjects').select('id, name').in('name', myTeacherSubjects.map(s => s.name));
        const shared = (subjRows || []).find(s => studentSubjectIds.has(s.id));

        const filter = document.getElementById('teacher-subject-filter');
        if (shared && filter.value !== shared.name) {
            filter.value = shared.name;
            await refreshSubjectFilteredStudents();
        }
        document.getElementById('assign-student').value = studentId;
        handleStudentSelectionChange();
        switchTeacherTab('gradebook');
    } catch (e) { /* if this lookup fails the teacher can still pick the student manually */ }
}
