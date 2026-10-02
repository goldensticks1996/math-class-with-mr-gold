// === SUBJECTS MODULE ===
// Subjects are a shared catalog: if two teachers both create "Mathematics"
// it is the same row, so both see every student who ticked it. A teacher
// links themselves to subjects via teacher_subjects; a student links
// themselves via student_subjects. This is what lets a teacher with (say)
// 15 students filter them out of a school of 1000, instead of scrolling.

let myTeacherSubjects = []; // [{id, name}] - this teacher's own subjects

async function findOrCreateSubject(name) {
    const clean = name.trim();
    if (!clean) return null;

    const { data: existing } = await window.mySupabase
        .from('subjects').select('id, name').ilike('name', clean).limit(1);
    if (existing && existing.length > 0) return existing[0];

    const { data: created, error } = await window.mySupabase
        .from('subjects').insert([{ name: clean }]).select().single();
    if (error) {
        // Someone else created the same name a moment ago - just fetch it.
        const { data: retry } = await window.mySupabase.from('subjects').select('id, name').ilike('name', clean).limit(1);
        return (retry && retry[0]) || null;
    }
    return created;
}

// --- Teacher side ---
async function loadTeacherSubjects() {
    const { data, error } = await window.mySupabase
        .from('teacher_subjects')
        .select('subject_id, subjects(id, name)')
        .eq('teacher_id', window.APP.currentUserId);

    myTeacherSubjects = (!error && data) ? data.map(r => r.subjects).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)) : [];
    renderMySubjectChips();
    populateSubjectFilterDropdown();
    populateTestSubjectDropdown();
    refreshSubjectFilteredStudents();
}

function renderMySubjectChips() {
    const box = document.getElementById('my-subjects-chips');
    if (!box) return;
    box.innerHTML = myTeacherSubjects.length === 0
        ? "<p style='color:#888;font-size:13px;'>You haven't added any subjects yet - add one below.</p>"
        : myTeacherSubjects.map(s => `
            <span style="display:inline-flex;align-items:center;gap:6px;background:#eef2ff;border-radius:20px;padding:5px 8px 5px 14px;margin:0 6px 6px 0;font-size:13px;color:#2c46b8;">
                ${s.name}<span title="Remove" style="cursor:pointer;color:#c0392b;font-weight:bold;padding:0 4px;" onclick="removeTeacherSubject(${s.id})">✕</span>
            </span>`).join('');
}

async function addTeacherSubject() {
    const input = document.getElementById('new-subject-name');
    const msg = document.getElementById('teacher-msg');
    const name = input.value.trim();
    if (!name) return;

    const subject = await findOrCreateSubject(name);
    if (!subject) { msg.innerText = "Could not add that subject."; msg.style.color = "#d9534f"; return; }

    const { error } = await window.mySupabase
        .from('teacher_subjects').insert([{ teacher_id: window.APP.currentUserId, subject_id: subject.id }]);
    if (error && error.code !== '23505') { // 23505 = already have it, fine
        msg.innerText = `Could not add subject: ${error.message}`;
        msg.style.color = "#d9534f";
        return;
    }

    input.value = "";
    await loadTeacherSubjects();
}

async function removeTeacherSubject(subjectId) {
    if (!confirm("Remove this subject from your list? Existing tests you made in this subject are not affected.")) return;
    await window.mySupabase.from('teacher_subjects')
        .delete().eq('teacher_id', window.APP.currentUserId).eq('subject_id', subjectId);
    await loadTeacherSubjects();
}

function populateSubjectFilterDropdown() {
    const drop = document.getElementById('teacher-subject-filter');
    if (!drop) return;
    drop.innerHTML = myTeacherSubjects.length === 0
        ? '<option value="">-- add a subject first --</option>'
        : myTeacherSubjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}

function populateTestSubjectDropdown() {
    const drop = document.getElementById('test-subject');
    if (!drop) return;
    drop.innerHTML = myTeacherSubjects.length === 0
        ? '<option value="">-- add a subject in My Subjects first --</option>'
        : myTeacherSubjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}

// Students who ticked the given subject NAME, via the shared catalog.
async function getStudentsForSubjectName(subjectName) {
    if (!subjectName) return [];
    const { data: subj } = await window.mySupabase.from('subjects').select('id').ilike('name', subjectName).limit(1);
    if (!subj || subj.length === 0) return [];
    const { data: links } = await window.mySupabase.from('student_subjects').select('student_id').eq('subject_id', subj[0].id);
    const ids = (links || []).map(l => l.student_id);
    if (ids.length === 0) return [];
    const { data: students } = await window.mySupabase.from('students').select('id, name, username').in('id', ids).order('name');
    return students || [];
}

async function refreshSubjectFilteredStudents() {
    const filter = document.getElementById('teacher-subject-filter');
    const drop = document.getElementById('assign-student');
    if (!filter || !drop) return;

    const subjectName = filter.value;
    const students = await getStudentsForSubjectName(subjectName);
    drop.innerHTML = "";
    if (students.length === 0) {
        drop.innerHTML = '<option value="">-- no students have ticked this subject yet --</option>';
    } else {
        students.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = s.name || s.username;
            drop.appendChild(opt);
        });
        window.APP.selectedStudentId = students[0].id;
    }
    handleStudentSelectionChange();
}

// --- Student side ---
async function loadStudentSubjects() {
    const container = document.getElementById('student-subjects-list');
    container.innerHTML = "<p style='color:#888;'>Loading...</p>";

    const { data: allSubjects } = await window.mySupabase.from('subjects').select('id, name').order('name');
    if (!allSubjects || allSubjects.length === 0) {
        container.innerHTML = "<p style='color:#888;'>No subjects have been set up by your teachers yet - check back later.</p>";
        return;
    }

    const { data: mine } = await window.mySupabase
        .from('student_subjects').select('subject_id').eq('student_id', window.APP.currentUserId);
    const mySet = new Set((mine || []).map(r => r.subject_id));

    container.innerHTML = allSubjects.map(s => `
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-weight:normal;">
            <input type="checkbox" class="student-subject-check" value="${s.id}" style="width:auto;" ${mySet.has(s.id) ? 'checked' : ''}>
            ${s.name}
        </label>`).join('');
}

async function saveStudentSubjects() {
    const msg = document.getElementById('student-subjects-msg');
    const checked = Array.from(document.querySelectorAll('.student-subject-check:checked')).map(cb => parseInt(cb.value, 10));

    try {
        const { data: mine } = await window.mySupabase
            .from('student_subjects').select('subject_id').eq('student_id', window.APP.currentUserId);
        const currentIds = (mine || []).map(r => r.subject_id);

        const toAdd = checked.filter(id => !currentIds.includes(id));
        const toRemove = currentIds.filter(id => !checked.includes(id));

        if (toAdd.length > 0) {
            await window.mySupabase.from('student_subjects')
                .insert(toAdd.map(subject_id => ({ student_id: window.APP.currentUserId, subject_id })));
        }
        if (toRemove.length > 0) {
            await window.mySupabase.from('student_subjects')
                .delete().eq('student_id', window.APP.currentUserId).in('subject_id', toRemove);
        }

        msg.innerText = "Your subjects have been saved!";
        msg.style.color = "#28a745";
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
    setTimeout(() => msg.innerText = "", 4000);
}

// Simple name-only list of a student's own subjects, for display (profile chips etc).
async function getMySubjectNames(studentId) {
    const { data } = await window.mySupabase
        .from('student_subjects').select('subjects(name)').eq('student_id', studentId);
    return (data || []).map(r => r.subjects && r.subjects.name).filter(Boolean).sort();
}
