// === CLASSES MODULE ===
// A "class" is one row in teacher_student_subjects:  Student -> Teacher -> Subject.
//   * A student picks a teacher for each subject on the Teachers tab.
//   * A student has only ONE teacher per subject, but two students can have different
//     teachers for the same subject (Mr Gold's Maths and Mr Joffrey's Maths never mix).
//   * A teacher can only assign tests / send report cards for a student in the
//     subjects that student has chosen them for (see the helpers below).

let myClasses = [];            // this student's own classes: [{ id, teacher_id, subject_id }]
let teacherDirectory = [];     // [{ id, name, photo, bio, subjects: [{ id, name }] }]
let subjectNameById = {};
let openTeacherId = null;      // teacher whose profile page is open
let teacherStatusSig = '';     // used to redraw only when a request's status really changes

// ---------- Helpers used by the teacher side ----------

// Lower-cased subject names this student has chosen THIS teacher for.
async function getConnectedSubjectNames(teacherId, studentId) {
    const { data } = await window.mySupabase.from('teacher_student_subjects')
        .select('subject_id').eq('teacher_id', teacherId).eq('student_id', studentId);
    const ids = (data || []).map(r => r.subject_id);
    if (ids.length === 0) return new Set();
    const { data: subs } = await window.mySupabase.from('subjects').select('id, name').in('id', ids);
    return new Set((subs || []).map(s => String(s.name).trim().toLowerCase()));
}

// ---------- Student: Teachers tab ----------

// Where does my request to this teacher stand?  none | pending | accepted | rejected | received (they asked me)
function connectionStatus(teacherId) {
    const rel = relationWith('teacher', teacherId);
    if (rel.state === 'friends') return 'accepted';
    if (rel.state === 'sent') return 'pending';
    if (rel.state === 'received') return 'received';
    if (rel.row && rel.row.status === 'declined') {
        const me = myIdentity();
        const iAsked = rel.row.requester_type === me.type && String(rel.row.requester_id) === me.id;
        return iAsked ? 'rejected' : 'none';
    }
    return 'none';
}
const STATUS_LABEL = { accepted: 'Accepted', pending: 'Pending', rejected: 'Rejected', received: 'Wants to connect' };
function statusChipHtml(status) {
    return STATUS_LABEL[status] ? `<span class="status-chip status-${status}">${STATUS_LABEL[status]}</span>` : '';
}

async function loadMyClasses() {
    const { data } = await window.mySupabase.from('teacher_student_subjects')
        .select('id, teacher_id, subject_id').eq('student_id', window.APP.currentUserId);
    myClasses = data || [];
}

// All approved teachers with photo, bio and subjects (used by the student Teachers tab and the teacher People tab).
async function fetchTeacherDirectory() {
    const { data: teachers, error } = await window.mySupabase.from('teachers')
        .select('id, name, username').eq('status', 'approved').order('name');
    if (error) return { error: error.message, teachers: [] };
    const ids = (teachers || []).map(t => t.id);
    let profiles = [], links = [], subs = [];
    if (ids.length) {
        const p = await window.mySupabase.from('teacher_profiles').select('teacher_id, photo, bio').in('teacher_id', ids);
        profiles = p.error ? [] : (p.data || []);
        const l = await window.mySupabase.from('teacher_subjects').select('teacher_id, subject_id').in('teacher_id', ids);
        links = l.data || [];
        const subjectIds = [...new Set(links.map(x => x.subject_id))];
        if (subjectIds.length) {
            const sb = await window.mySupabase.from('subjects').select('id, name').in('id', subjectIds);
            subs = sb.data || [];
        }
    }
    subs.forEach(x => { subjectNameById[x.id] = x.name; });
    return {
        teachers: (teachers || []).map(t => {
            const prof = profiles.find(p => String(p.teacher_id) === String(t.id)) || {};
            const subjects = links.filter(x => String(x.teacher_id) === String(t.id))
                .map(x => ({ id: x.subject_id, name: subjectNameById[x.subject_id] })).filter(x => x.name)
                .sort((a, b) => a.name.localeCompare(b.name));
            return { id: t.id, name: t.name || t.username, photo: prof.photo || null, bio: prof.bio || '', subjects };
        })
    };
}

async function loadStudentTeachersTab() {
    openTeacherId = null;
    const list = document.getElementById('teachers-list');
    document.getElementById('teacher-detail-page').classList.add('hidden');
    document.getElementById('teachers-list-page').classList.remove('hidden');
    list.innerHTML = "<p style='color:#888;'>Loading teachers...</p>";

    try {
        await loadMyClasses();
        await loadFriendships();
        const dir = await fetchTeacherDirectory();
        if (dir.error) { list.innerHTML = `<p style="color:#d9534f;">${escapeHtml(dir.error)}</p>`; return; }
        teacherDirectory = dir.teachers;

        renderMyClassesSummary();
        renderTeacherCards();
        teacherStatusSig = teacherDirectory.map(t => t.id + ':' + connectionStatus(t.id)).join('|');
    } catch (e) {
        list.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
    }
}

function renderMyClassesSummary() {
    const box = document.getElementById('my-classes-summary');
    if (!box) return;
    if (myClasses.length === 0) {
        box.innerHTML = "<p style='color:#888;font-size:13px;'>You haven't chosen a teacher for any subject yet. Tap a teacher below, then tick the subject(s) you want them for.</p>";
        return;
    }
    box.innerHTML = myClasses.map(c => {
        const t = teacherDirectory.find(x => String(x.id) === String(c.teacher_id));
        return `<span class="class-chip"><strong>${escapeHtml(subjectNameById[c.subject_id] || 'Subject')}</strong> · ${escapeHtml(t ? t.name : 'Teacher')}</span>`;
    }).join('');
}

function renderTeacherCards() {
    const list = document.getElementById('teachers-list');
    const q = (document.getElementById('teachers-search').value || '').trim().toLowerCase();
    const shown = teacherDirectory.filter(t => !q || t.name.toLowerCase().includes(q) || t.subjects.some(s => s.name.toLowerCase().includes(q)));
    if (teacherDirectory.length === 0) { list.innerHTML = "<p style='color:#888;'>No teachers are available yet - check back later.</p>"; return; }
    if (shown.length === 0) { list.innerHTML = "<p style='color:#888;'>No teacher matches your search.</p>"; return; }
    list.innerHTML = shown.map(t => {
        const mine = myClasses.filter(c => String(c.teacher_id) === String(t.id)).length;
        return `
        <div class="teacher-card" onclick="openTeacherPage(${t.id})" role="button" tabindex="0">
            <img src="${escapeHtml(t.photo || 'img/logo.png')}" alt="">
            <div class="teacher-card-name">${escapeHtml(t.name)}</div>
            <div class="teacher-card-sub">${t.subjects.length} subject${t.subjects.length === 1 ? '' : 's'}${mine ? ` · <span class="teacher-card-mine">${mine} chosen</span>` : ''}</div>
            <div class="teacher-card-status">${statusChipHtml(connectionStatus(t.id))}</div>
        </div>`;
    }).join('');
}

function openTeacherPage(teacherId) {
    const t = teacherDirectory.find(x => String(x.id) === String(teacherId));
    if (!t) return;
    openTeacherId = t.id;
    if (typeof navRecord === 'function') navRecord('teachers', String(t.id));
    document.getElementById('teachers-list-page').classList.add('hidden');
    const page = document.getElementById('teacher-detail-page');
    page.classList.remove('hidden');

    const status = connectionStatus(t.id);
    const rel = relationWith('teacher', t.id);

    // ---- connection panel: this is where a student asks a teacher to connect ----
    let connect = '';
    if (status === 'none') {
        connect = `<p class="connect-note">You are not connected to ${escapeHtml(t.name)} yet. Send a friend request - once ${escapeHtml(t.name)} accepts, you can choose their subjects.</p>
                   <button type="button" class="btn-gold" onclick="requestTeacher(${t.id})">Send Friend Request</button>`;
    } else if (status === 'pending') {
        connect = `<p class="connect-note">${statusChipHtml('pending')} Your request has been sent. Waiting for ${escapeHtml(t.name)} to respond.</p>`;
    } else if (status === 'rejected') {
        connect = `<p class="connect-note">${statusChipHtml('rejected')} ${escapeHtml(t.name)} did not accept your request. You can send it again.</p>
                   <button type="button" class="btn-gold" onclick="requestTeacher(${t.id})">Send Request Again</button>`;
    } else if (status === 'received') {
        connect = `<p class="connect-note">${statusChipHtml('received')} ${escapeHtml(t.name)} sent you a friend request.</p>
                   <div class="person-actions-row">
                       <button type="button" class="btn-success" onclick="answerTeacherRequest(${rel.row.id}, true)">Accept</button>
                       <button type="button" class="btn-secondary" onclick="answerTeacherRequest(${rel.row.id}, false)">Reject</button>
                   </div>`;
    } else {
        connect = `<p class="connect-note">${statusChipHtml('accepted')} You are connected to ${escapeHtml(t.name)}.</p>`;
    }

    // ---- subjects: only selectable once connected ----
    const unlocked = status === 'accepted';
    const rows = t.subjects.length === 0
        ? "<p style='color:#888;'>This teacher hasn't added any subjects yet.</p>"
        : t.subjects.map(s => {
            const mineHere = myClasses.some(c => String(c.teacher_id) === String(t.id) && String(c.subject_id) === String(s.id));
            const other = myClasses.find(c => String(c.subject_id) === String(s.id) && String(c.teacher_id) !== String(t.id));
            const otherTeacher = other ? teacherDirectory.find(x => String(x.id) === String(other.teacher_id)) : null;
            return `
            <label class="subject-pick${unlocked ? '' : ' locked'}">
                <input type="checkbox" ${mineHere ? 'checked' : ''} ${unlocked ? '' : 'disabled'} onchange="toggleClassConnection(this, ${t.id}, ${s.id})">
                <span>${escapeHtml(s.name)}</span>
                ${otherTeacher ? `<small>currently with ${escapeHtml(otherTeacher.name)}</small>` : ''}
            </label>`;
        }).join('');

    page.innerHTML = `
        <button type="button" class="btn-secondary back-btn" onclick="closeTeacherPage()">← Back to Teachers</button>
        <div class="profile-view-card">
            <img class="profile-avatar-lg" src="${escapeHtml(t.photo || 'img/logo.png')}" alt="">
            <div class="profile-view-name">${escapeHtml(t.name)}</div>
            <div class="profile-stats-row"><span class="profile-stat-badge">Teacher</span></div>
            ${t.bio ? `<div class="profile-bio">"${escapeHtml(t.bio)}"</div>` : ''}
            <div class="connect-box">${connect}</div>
        </div>
        <h4>${escapeHtml(t.name)}'s subjects</h4>
        <p style="font-size:13px;color:#666;margin-bottom:10px;">${unlocked
            ? "Tick a subject to join this teacher's class for it. You only join the subjects you tick."
            : `Connect with ${escapeHtml(t.name)} first - then you can tick the subject(s) you want.`}</p>
        <div class="subject-pick-list">${rows}</div>
        <p id="class-pick-msg" style="font-weight:bold;margin-top:10px;"></p>`;
}

async function requestTeacher(teacherId) {
    const t = teacherDirectory.find(x => String(x.id) === String(teacherId));
    if (!t) return;
    await sendFriendRequest('teacher', teacherId, t.name);
    openTeacherPage(teacherId);
    teacherStatusSig = teacherDirectory.map(x => x.id + ':' + connectionStatus(x.id)).join('|');
}

async function answerTeacherRequest(friendshipId, accept) {
    await respondFriendRequest(friendshipId, accept);
    if (openTeacherId) openTeacherPage(openTeacherId);
}

// Called after friend data refreshes: redraw the Teachers tab only if a status really changed.
function refreshTeachersTabIfVisible() {
    const view = document.getElementById('student-teachers-view');
    if (!view || view.classList.contains('hidden') || teacherDirectory.length === 0) return;
    const sig = teacherDirectory.map(t => t.id + ':' + connectionStatus(t.id)).join('|');
    if (sig === teacherStatusSig) return;
    teacherStatusSig = sig;
    renderTeacherCards();
    if (openTeacherId) openTeacherPage(openTeacherId);
}

function closeTeacherPage() {
    openTeacherId = null;
    if (typeof navSubClosed === 'function') navSubClosed('teachers');
    renderMyClassesSummary();
    renderTeacherCards();
    document.getElementById('teacher-detail-page').classList.add('hidden');
    document.getElementById('teachers-list-page').classList.remove('hidden');
}

async function toggleClassConnection(cb, teacherId, subjectId) {
    const msg = document.getElementById('class-pick-msg');
    const t = teacherDirectory.find(x => String(x.id) === String(teacherId));
    const subjectName = subjectNameById[subjectId] || 'this subject';
    const studentId = window.APP.currentUserId;
    const fail = (text) => { cb.checked = !cb.checked; msg.innerText = text; msg.style.color = '#d9534f'; };
    if (connectionStatus(teacherId) !== 'accepted') {
        cb.checked = !cb.checked;
        msg.innerText = `Connect with ${t ? t.name : 'this teacher'} first - they need to accept your friend request.`;
        msg.style.color = '#d9534f';
        return;
    }
    cb.disabled = true;

    try {
        if (cb.checked) {
            const other = myClasses.find(c => String(c.subject_id) === String(subjectId) && String(c.teacher_id) !== String(teacherId));
            if (other) {
                const otherT = teacherDirectory.find(x => String(x.id) === String(other.teacher_id));
                if (!confirm(`You currently have ${otherT ? otherT.name : 'another teacher'} for ${subjectName}.\n\nSwitch to ${t.name} for ${subjectName}?`)) {
                    cb.checked = false; cb.disabled = false; return;
                }
                const { error } = await window.mySupabase.from('teacher_student_subjects')
                    .update({ teacher_id: teacherId }).eq('id', other.id);
                if (error) { cb.disabled = false; return fail(`Could not switch: ${error.message}`); }
            } else {
                const { error } = await window.mySupabase.from('teacher_student_subjects')
                    .insert([{ teacher_id: teacherId, student_id: studentId, subject_id: subjectId }]);
                if (error) { cb.disabled = false; return fail(`Could not join: ${error.message}`); }
                await sendNotification('teacher', teacherId, 'class_joined', 'New student in your class',
                    `${window.APP.currentUser || 'A student'} chose you for ${subjectName}.`, { student_id: studentId, subject_id: subjectId });
            }
            // keep the older "my subjects" list in step so profile chips etc. stay right
            await window.mySupabase.from('student_subjects').insert([{ student_id: studentId, subject_id: subjectId }]);
            msg.innerText = `You joined ${t.name}'s ${subjectName} class.`;
            msg.style.color = '#28a745';
        } else {
            if (!confirm(`Leave ${t.name}'s ${subjectName} class?\n\n${t.name} will no longer be able to send you ${subjectName} tests or report cards.`)) {
                cb.checked = true; cb.disabled = false; return;
            }
            const { error } = await window.mySupabase.from('teacher_student_subjects')
                .delete().eq('student_id', studentId).eq('teacher_id', teacherId).eq('subject_id', subjectId);
            if (error) { cb.disabled = false; return fail(`Could not leave: ${error.message}`); }
            await window.mySupabase.from('student_subjects').delete().eq('student_id', studentId).eq('subject_id', subjectId);
            msg.innerText = `You left ${t.name}'s ${subjectName} class.`;
            msg.style.color = '#28a745';
        }
    } catch (e) {
        cb.disabled = false;
        return fail('Unable to connect to database.');
    }
    await loadMyClasses();
    openTeacherPage(teacherId);                       // redraw the checkboxes ("currently with ...")
    const m2 = document.getElementById('class-pick-msg');
    if (m2) { m2.innerText = msg.innerText; m2.style.color = msg.style.color; }
}
