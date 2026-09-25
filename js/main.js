// === MAIN UI GLUE: screens, tabs, image upload helpers, roster, gradebook ===

let currentImageBase64 = null;          // pending image for the manual-create form
let editingQbImageBase64 = null;        // pending image while editing a bank question
let editingQId = null;                  // question id currently being edited, or null

function showScreen(screenId) {
    ['login-screen', 'admin-dashboard', 'teacher-dashboard', 'student-dashboard'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

async function populateStudentDropdown() {
    const drop = document.getElementById('assign-student');
    drop.innerHTML = "";
    try {
        const { data, error } = await window.mySupabase.from('students').select('id, name, username').order('name');
        if (error || !data) return;
        data.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = s.name || s.username;
            drop.appendChild(opt);
        });
        if (data.length > 0) {
            window.APP.selectedStudentId = data[0].id;
        }
    } catch (e) { /* network issue - dropdown just stays empty */ }
    handleStudentSelectionChange();
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

function switchStudentView(view) {
    document.getElementById('student-tests-view').classList.toggle('hidden', view !== 'tests');
    document.getElementById('student-reports-view').classList.toggle('hidden', view !== 'reports');
    if (view === 'reports') loadMyReportCards();
}

function switchTeacherTab(tab) {
    ['manual-tab', 'pdf-tab', 'gradebook-tab', 'roster-tab', 'qbank-tab', 'report-tab'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(`${tab}-tab`).classList.remove('hidden');

    if (tab === 'gradebook') loadStudentGradebookData();
    if (tab === 'roster') renderRosterTable();
    if (tab === 'qbank') { renderQuestionBank(); renderMyAssessments(); }
    if (tab === 'report') refreshTeacherReportSubjects();
}

async function renderRosterTable() {
    const tbody = document.getElementById('student-roster-body');
    tbody.innerHTML = "<tr><td colspan='2' style='text-align:center;'>Loading...</td></tr>";
    try {
        const { data, error } = await window.mySupabase.from('students').select('name, username, password').order('name');
        if (error || !data) { tbody.innerHTML = "<tr><td colspan='2'>Failed to load students.</td></tr>"; return; }
        document.getElementById('total-student-count').innerText = data.length;
        tbody.innerHTML = "";
        data.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${s.name || s.username}</td><td><strong>${s.password}</strong></td>`;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = "<tr><td colspan='2'>Unable to connect to database.</td></tr>";
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
let latestAttemptIdForRemark = null;

async function loadStudentGradebookData() {
    const studentId = document.getElementById('assign-student').value;
    const scoreDisplay = document.getElementById('gb-score-display');
    const dateDisplay = document.getElementById('gb-date-display');
    const remarkInput = document.getElementById('gb-remark-input');
    latestAttemptIdForRemark = null;
    remarkInput.value = "";
    if (!studentId) { scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A"; return; }

    try {
        const { data: myAssessments } = await window.mySupabase
            .from('assessment').select('id, title').eq('teacher_id', window.APP.currentUserId);
        const ids = (myAssessments || []).map(a => a.id);
        if (ids.length === 0) { scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A"; return; }

        const { data: attempts, error } = await window.mySupabase
            .from('attempts')
            .select('id, score, total, percentage, submitted_at, assessment_id, remark')
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
        latestAttemptIdForRemark = latest.id;
        scoreDisplay.innerText = `${latest.score} / ${latest.total} (${latest.percentage}%)`;
        dateDisplay.innerText = latest.submitted_at ? new Date(latest.submitted_at).toLocaleString() : 'N/A';
        remarkInput.value = latest.remark || "";
    } catch (e) {
        scoreDisplay.innerText = "No record"; dateDisplay.innerText = "N/A";
    }
}

async function saveGradebookRemark() {
    const msg = document.getElementById('teacher-msg');
    const remark = document.getElementById('gb-remark-input').value.trim();

    if (!latestAttemptIdForRemark) {
        msg.innerText = "This student has no completed test yet - a remark attaches to their most recent attempt.";
        msg.style.color = "#d9534f";
        setTimeout(() => msg.innerText = "", 5000);
        return;
    }

    try {
        const { error } = await window.mySupabase
            .from('attempts').update({ remark }).eq('id', latestAttemptIdForRemark);
        if (error) {
            msg.innerText = `Failed to save remark: ${error.message}`;
            msg.style.color = "#d9534f";
        } else {
            msg.innerText = "Performance remark saved!";
            msg.style.color = "#28a745";
        }
    } catch (e) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
    setTimeout(() => msg.innerText = "", 4000);
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
        document.getElementById('student-welcome').innerText = `Welcome, ${window.APP.currentUser}!`;
        showScreen('student-dashboard');
        await loadAssignedAssessments();
    }
});
