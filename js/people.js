// === PEOPLE MODULE ===
// "People Around You" (teachers) and "People" (students): find other people using the app,
// open their profile, and send / answer friend requests. A request can be sent to someone
// who is offline - it stays pending and they see it (bell + here) as soon as they come online.
// There is no messaging.

let peopleCache = { students: [], teachers: [], mine: {}, classSubjects: {}, sharedTeacherStudentIds: new Set(), loaded: false };

function peopleEl(suffix) { return document.getElementById(`${window.APP.currentRole}-people-${suffix}`); }

async function loadPeopleView() {
    const role = window.APP.currentRole;
    if (role !== 'student' && role !== 'teacher') return;
    const box = peopleEl('content');
    if (!box) return;
    box.innerHTML = "<p style='color:#888;'>Loading people...</p>";
    peopleCache.loaded = false;

    try {
        await loadFriendships();
        if (role === 'student') {
            const me = String(window.APP.currentUserId);
            const { data: students } = await window.mySupabase.from('students').select('id, name, username').order('name').limit(500);
            const ids = (students || []).map(s => s.id);
            let profiles = [];
            if (ids.length) {
                const p = await window.mySupabase.from('student_profiles').select('student_id, class, age').in('student_id', ids);
                profiles = p.data || [];
            }
            const byId = {};
            profiles.forEach(p => { byId[String(p.student_id)] = p; });
            peopleCache.students = (students || []).map(s => ({
                type: 'student', id: String(s.id), name: s.name || s.username,
                cls: (byId[String(s.id)] || {}).class || '', age: (byId[String(s.id)] || {}).age || null
            }));
            peopleCache.mine = peopleCache.students.find(s => s.id === me) || {};

            // students who share a teacher with me ("people you may know")
            peopleCache.sharedTeacherStudentIds = new Set();
            await loadMyClasses();
            const myTeachers = [...new Set(myClasses.map(c => c.teacher_id))];
            if (myTeachers.length) {
                const { data: mates } = await window.mySupabase.from('teacher_student_subjects').select('student_id').in('teacher_id', myTeachers);
                (mates || []).forEach(m => peopleCache.sharedTeacherStudentIds.add(String(m.student_id)));
            }
        } else {
            // which of MY subjects each connected student has chosen me for
            const { data: myRows } = await window.mySupabase.from('teacher_student_subjects')
                .select('student_id, subject_id').eq('teacher_id', window.APP.currentUserId);
            const subjIds = [...new Set((myRows || []).map(r => r.subject_id))];
            const subjName = {};
            if (subjIds.length) {
                const { data: sb } = await window.mySupabase.from('subjects').select('id, name').in('id', subjIds);
                (sb || []).forEach(x => { subjName[x.id] = x.name; });
            }
            peopleCache.classSubjects = {};
            (myRows || []).forEach(r => {
                const k = String(r.student_id);
                if (!peopleCache.classSubjects[k]) peopleCache.classSubjects[k] = [];
                if (subjName[r.subject_id]) peopleCache.classSubjects[k].push(subjName[r.subject_id]);
            });
            const dir = await fetchTeacherDirectory();
            peopleCache.teachers = dir.teachers.map(t => ({
                type: 'teacher', id: String(t.id), name: t.name, photo: t.photo, subjects: t.subjects.map(s => s.name)
            }));
        }
        peopleCache.loaded = true;
    } catch (e) {
        box.innerHTML = "<p style='color:#d9534f;'>Unable to connect to database.</p>";
        return;
    }
    renderPeopleView();
}

function refreshPeopleIfVisible() {
    if (!peopleCache.loaded) return;
    const role = window.APP.currentRole;
    const panel = role === 'student' ? document.getElementById('student-people-view') : document.getElementById('people-tab');
    if (panel && !panel.classList.contains('hidden')) renderPeopleView();
}

// ---------- Rendering ----------
function nameForPerson(type, id) {
    const key = String(id);
    const pool = type === 'student' ? peopleCache.students : peopleCache.teachers;
    const found = pool.find(p => p.id === key);
    if (found) return found.name;
    const online = onlineOthers.find(o => o.role === type && String(o.id) === key);
    if (online) return online.name;
    return friendNames[personKey(type, key)] || 'Someone';
}

function personRowHtml(p, extraSub) {
    const rel = relationWith(p.type, p.id);
    let action = '';
    if (rel.state === 'friends') action = '<span class="fr-tag">✓ Friends</span>';
    else if (rel.state === 'sent') action = '<span class="fr-tag fr-pending">Request sent</span>';
    else if (rel.state === 'received') {
        action = `<button type="button" class="fr-btn fr-accept" data-act="accept" data-fid="${rel.row.id}">Accept</button>
                  <button type="button" class="fr-btn fr-decline" data-act="decline" data-fid="${rel.row.id}">Reject</button>`;
    } else if (canSendRequestTo(p.type)) {
        action = `<button type="button" class="fr-btn" data-act="add" data-type="${p.type}" data-id="${escapeHtml(p.id)}">➕ Send Request</button>`;
    }
    const isOnline = onlineOthers.some(o => o.role === p.type && String(o.id) === p.id);
    const sub = [p.type === 'teacher' ? 'Teacher' : (p.cls || 'Student'), extraSub].filter(Boolean).join(' · ');
    const avatar = p.photo
        ? `<img class="person-avatar-img" src="${escapeHtml(p.photo)}" alt="">`
        : `<div class="online-avatar person-initial${isOnline ? '' : ' offline'}" style="background:${ONLINE_COLORS[(p.name || '').length % ONLINE_COLORS.length]}">${escapeHtml((p.name || '?').trim().charAt(0).toUpperCase())}</div>`;
    return `
        <div class="person-row" data-type="${p.type}" data-id="${escapeHtml(p.id)}">
            <div class="person-avatar-wrap${isOnline ? ' is-online' : ''}">${avatar}</div>
            <div class="person-info">
                <div class="person-name">${escapeHtml(p.name)}</div>
                <div class="person-sub">${escapeHtml(sub)}</div>
            </div>
            <div class="person-action">${action}</div>
        </div>`;
}

function renderPeopleView() {
    const role = window.APP.currentRole;
    const box = peopleEl('content');
    if (!box) return;
    const q = ((peopleEl('search') || {}).value || '').trim().toLowerCase();
    const match = (p) => !q || p.name.toLowerCase().includes(q);
    const me = myIdentity();
    const section = (title, count, inner, hint) => `
        <div class="people-section">
            <div class="people-section-title">${title} <span class="online-count">${count}</span></div>
            ${hint ? `<p class="people-hint">${hint}</p>` : ''}${inner}
        </div>`;
    const empty = (t) => `<p class="people-empty">${t}</p>`;
    let html = '';

    // 1. requests waiting for me (also reachable from the bell)
    const waiting = friendships.filter(f => f.status === 'pending' && f.addressee_type === me.type && String(f.addressee_id) === me.id)
        .map(f => ({ type: f.requester_type, id: String(f.requester_id), name: nameForPerson(f.requester_type, f.requester_id) }));
    if (waiting.length) html += section('Friend requests', waiting.length, waiting.map(p => personRowHtml(p)).join(''), 'People who want to be your friend. They stay here until you answer.');

    // 2. online now
    const online = onlineOthers.map(o => ({ type: o.role, id: String(o.id), name: o.name })).filter(match);
    html += section('Online now', online.length, online.length ? online.map(p => personRowHtml(p)).join('') : empty('No one else is online right now.'));

    // 3. my friends (for a teacher: their connected students are listed on their own, plus teacher friends)
    const acceptedPeople = friendships.filter(f => f.status === 'accepted').map(f => {
        const o = otherSide(f);
        return { type: o.type, id: o.id, name: friendNames[personKey(o.type, o.id)] || nameForPerson(o.type, o.id) };
    }).filter(match);
    if (role === 'teacher') {
        const myStudents = acceptedPeople.filter(p => p.type === 'student');
        const teacherFriends = acceptedPeople.filter(p => p.type === 'teacher');
        const classSubjects = peopleCache.classSubjects || {};
        html += section('My students', myStudents.length, myStudents.length
            ? myStudents.map(p => personRowHtml(p, (classSubjects[p.id] || []).length ? (classSubjects[p.id] || []).join(', ') : 'No subject chosen yet')).join('')
            : empty('No connected students yet. When a student sends you a request and you accept it, they appear here.'),
            'Students who are connected to you. They can now choose your subjects.');
        html += section('Teacher friends', teacherFriends.length, teacherFriends.length ? teacherFriends.map(p => personRowHtml(p)).join('') : empty('No teacher friends yet.'));
    } else {
        html += section('My friends', acceptedPeople.length, acceptedPeople.length ? acceptedPeople.map(p => personRowHtml(p)).join('') : empty('No friends yet - send a request below.'));
    }

    if (role === 'student') {
        const others = peopleCache.students.filter(s => s.id !== me.id);
        const friendIds = new Set(friendships.filter(f => f.status !== 'declined').map(f => otherSide(f).id));

        // 4. people you may know: same class, or learning with one of my teachers
        const myClass = (peopleCache.mine && peopleCache.mine.cls) || '';
        const maybe = others.filter(s => !friendIds.has(s.id)).map(s => {
            const sameClass = !!myClass && s.cls === myClass;
            const sameTeacher = peopleCache.sharedTeacherStudentIds.has(s.id);
            return { s, score: (sameClass ? 2 : 0) + (sameTeacher ? 1 : 0), tags: [sameClass ? 'Same class' : '', sameTeacher ? 'Same teacher' : ''].filter(Boolean).join(' · ') };
        }).filter(x => x.score > 0 && match(x.s)).sort((a, b) => b.score - a.score).slice(0, 12);
        if (maybe.length) html += section('People you may know', maybe.length, maybe.map(x => personRowHtml(x.s, x.tags)).join(''));

        // 5. everyone
        const everyone = others.filter(match);
        html += section('Everyone on the app', everyone.length, everyone.length
            ? everyone.slice(0, 100).map(p => personRowHtml(p, p.age ? `Age ${p.age}` : '')).join('') + (everyone.length > 100 ? empty('Showing the first 100 - type a name to narrow it down.') : '')
            : empty(q ? 'No one matches your search.' : 'No other students have registered yet.'));
    } else {
        const teachers = peopleCache.teachers.filter(t => t.id !== me.id).filter(match);
        html += section('Teachers on the app', teachers.length, teachers.length
            ? teachers.map(t => personRowHtml(t, t.subjects.join(', '))).join('')
            : empty(q ? 'No teacher matches your search.' : 'No other teachers have joined yet.'),
            'You can send a request even if they are offline - they will see it when they next log in.');
    }
    box.innerHTML = html;
}

// One click handler for every row/button in the People page
document.addEventListener('click', (e) => {
    const box = e.target.closest('#student-people-content, #teacher-people-content');
    if (!box) return;
    const btn = e.target.closest('[data-act]');
    if (btn) {
        e.stopPropagation();
        if (btn.dataset.act === 'add') sendFriendRequest(btn.dataset.type, btn.dataset.id);
        else if (btn.dataset.act === 'accept') respondFriendRequest(btn.dataset.fid, true);
        else if (btn.dataset.act === 'decline') respondFriendRequest(btn.dataset.fid, false);
        return;
    }
    const row = e.target.closest('.person-row');
    if (row) openPersonProfile(row.dataset.type, row.dataset.id);
});

// ---------- Profile pop-up ----------
let openProfileTarget = null;

async function openPersonProfile(type, id) {
    openProfileTarget = { type, id: String(id) };
    if (typeof navOverlayOpened === 'function') navOverlayOpened('person');   // Back closes the profile first
    let overlay = document.getElementById('person-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'person-modal-overlay';
        overlay.className = 'quiz-modal-overlay hidden';
        overlay.onclick = (e) => { if (e.target === overlay) closePersonProfile(); };
        overlay.innerHTML = '<div class="quiz-modal-box person-modal-box" role="dialog" aria-modal="true"></div>';
        document.body.appendChild(overlay);
    }
    const box = overlay.firstChild;
    box.innerHTML = "<p style='text-align:center;color:#888;'>Loading profile...</p>";
    overlay.classList.remove('hidden');

    let info = { name: nameForPerson(type, id), photo: null, cls: '', age: null, bio: '', subjects: [] };
    try {
        if (type === 'student') {
            const { data: s } = await window.mySupabase.from('students').select('id, name, username').eq('id', id).single();
            const { data: p } = await window.mySupabase.from('student_profiles').select('photo, age, class').eq('student_id', id).maybeSingle();
            if (s) info.name = s.name || s.username;
            if (p) { info.photo = p.photo; info.age = p.age; info.cls = p.class; }
        } else {
            const { data: t } = await window.mySupabase.from('teachers').select('id, name, username').eq('id', id).single();
            if (t) info.name = t.name || t.username;
            const pr = await window.mySupabase.from('teacher_profiles').select('photo, bio').eq('teacher_id', id).maybeSingle();
            if (pr && pr.data) { info.photo = pr.data.photo; info.bio = pr.data.bio || ''; }
            const l = await window.mySupabase.from('teacher_subjects').select('subject_id').eq('teacher_id', id);
            const ids = (l.data || []).map(x => x.subject_id);
            if (ids.length) {
                const sb = await window.mySupabase.from('subjects').select('name').in('id', ids);
                info.subjects = (sb.data || []).map(x => x.name).sort();
            }
        }
    } catch (e) { /* show whatever we have */ }
    if (!openProfileTarget || openProfileTarget.id !== String(id)) return;
    renderPersonProfile(type, id, info);
}

function renderPersonProfile(type, id, info) {
    const overlay = document.getElementById('person-modal-overlay');
    if (!overlay) return;
    const rel = relationWith(type, id);
    const isMe = type === window.APP.currentRole && String(id) === String(window.APP.currentUserId);
    let action = '';
    if (isMe) action = '<p class="people-hint">This is you.</p>';
    else if (rel.state === 'friends') action = '<div class="person-state">✓ You are friends</div>';
    else if (rel.state === 'sent') action = '<div class="person-state">Request sent - waiting for them to respond</div>';
    else if (rel.state === 'received') action = `<button type="button" class="btn-success" onclick="respondFriendRequest(${rel.row.id}, true)">Accept Request</button>
        <button type="button" class="btn-secondary" onclick="respondFriendRequest(${rel.row.id}, false)">Reject</button>`;
    else if (canSendRequestTo(type)) action = `<button type="button" class="btn-gold" onclick="sendFriendRequest('${type}', '${escapeHtml(String(id))}')">Send Request</button>`;

    const details = type === 'student'
        ? `<div class="profile-stats-row">
               <span class="profile-stat-badge">Class: ${escapeHtml(info.cls || '-')}</span>
               <span class="profile-stat-badge">Age: ${escapeHtml(info.age || '-')}</span>
           </div>`
        : `<div class="profile-stats-row"><span class="profile-stat-badge">Teacher</span></div>
           <div class="profile-subject-chips">${info.subjects.map(s => `<span class="profile-subject-chip">${escapeHtml(s)}</span>`).join('')}</div>
           ${info.bio ? `<div class="profile-bio">"${escapeHtml(info.bio)}"</div>` : ''}`;

    overlay.firstChild.innerHTML = `
        <div style="text-align:center;">
            <img class="profile-avatar-lg" src="${escapeHtml(info.photo || 'img/logo.png')}" alt="">
            <div class="profile-view-name">${escapeHtml(info.name)}</div>
            ${details}
        </div>
        <div class="person-actions">${action}</div>
        <button type="button" class="btn-secondary" onclick="closePersonProfile()">Close</button>`;
    overlay._info = info;
}

function closePersonProfile() {
    openProfileTarget = null;
    const overlay = document.getElementById('person-modal-overlay');
    const wasOpen = overlay && !overlay.classList.contains('hidden');
    if (overlay) overlay.classList.add('hidden');
    if (wasOpen && typeof navOverlayClosed === 'function') navOverlayClosed('person');
}

// When a friendship changes while a profile is open, redraw the button.
const _origRefreshPeople = refreshPeopleIfVisible;
refreshPeopleIfVisible = function () {
    _origRefreshPeople();
    const overlay = document.getElementById('person-modal-overlay');
    if (overlay && !overlay.classList.contains('hidden') && openProfileTarget && overlay._info) {
        renderPersonProfile(openProfileTarget.type, openProfileTarget.id, overlay._info);
    }
};

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePersonProfile(); });
