// === SHELL MODULE ===
// Supports the Facebook-style layout (top bar, profile sidebar, friends-online
// column) for both students and teachers. Nothing here changes how tests,
// questions, subjects or reports work - it only drives the new chrome.

let presenceChannel = null;

// ---------- Top-bar dropdowns (bell + avatar) ----------
function closeShellMenus() {
    document.querySelectorAll('.shell-menu').forEach(m => m.classList.add('hidden'));
}
function toggleShellMenu(id) {
    const menu = document.getElementById(id);
    const willOpen = menu.classList.contains('hidden');
    closeShellMenus();
    if (willOpen) {
        menu.classList.remove('hidden');
        if (id === 'student-bell-menu' || id === 'teacher-bell-menu') refreshNotifications();
    }
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('.shell-menu-wrap')) closeShellMenus();
});

// ---------- Screen hook (called from showScreen in main.js) ----------
function onShellScreenChange(screenId) {
    closeShellMenus();
    if (screenId === 'student-dashboard') {
        startPresence('student');
        startNotifications();
    } else if (screenId === 'teacher-dashboard') {
        startPresence('teacher');
        startNotifications();
        loadTeacherProfile();
    } else {
        stopPresence();
        if (typeof stopNotifications === 'function') stopNotifications();
    }
}

// ---------- Student sidebar ----------
function updateStudentSidebar(className, subjectNames) {
    const sub = document.getElementById('side-sub');
    const chips = document.getElementById('side-subjects');
    if (sub) sub.innerText = className || '';
    if (chips) {
        chips.innerHTML = '';
        (subjectNames || []).forEach(n => {
            const c = document.createElement('span');
            c.className = 'side-chip';
            c.textContent = n;
            chips.appendChild(c);
        });
    }
}

function openProfileEdit() {
    closeShellMenus();
    switchStudentView('profile');
    const form = document.getElementById('profile-edit-form');
    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Teacher profile ----------
// Name lives in the existing `teachers` table. Photo + bio live in `teacher_profiles`
// (see database_update.sql). If that table doesn't exist yet, the photo falls back
// to this browser only so nothing is lost.
let pendingTeacherPhoto = null;
let teacherProfile = { photo: null, bio: '' };

function teacherPhotoKey() { return 'mcwmg_teacher_photo_' + window.APP.currentUserId; }
function getTeacherPhoto() {
    try { return localStorage.getItem(teacherPhotoKey()); } catch (e) { return null; }
}

async function loadTeacherProfile() {
    if (window.APP.currentRole !== 'teacher') return;
    teacherProfile = { photo: getTeacherPhoto(), bio: '' };
    try {
        const { data, error } = await window.mySupabase.from('teacher_profiles').select('*')
            .eq('teacher_id', window.APP.currentUserId).maybeSingle();
        if (!error && data) teacherProfile = { photo: data.photo || teacherProfile.photo, bio: data.bio || '' };
    } catch (e) { /* use the local fallback */ }
    renderTeacherProfile();
}

function renderTeacherProfile() {
    if (window.APP.currentRole !== 'teacher') return;
    const name = window.APP.currentUser || 'Teacher';
    const photo = teacherProfile.photo || 'img/logo.png';
    const subjects = (typeof myTeacherSubjects !== 'undefined' ? myTeacherSubjects : []).map(s => s.name);

    ['teacher-nav-avatar', 'teacher-side-avatar', 'teacher-avatar-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.src = photo;
    });
    document.getElementById('teacher-side-name').innerText = name;
    document.getElementById('teacher-side-sub').innerText = 'Teacher';
    document.getElementById('teacher-view-name').innerText = name;
    document.getElementById('teacher-view-bio').innerText = teacherProfile.bio ? `"${teacherProfile.bio}"` : '';

    [['teacher-side-subjects', 'side-chip'], ['teacher-view-subjects', 'profile-subject-chip']].forEach(([id, cls]) => {
        const box = document.getElementById(id);
        if (!box) return;
        box.innerHTML = '';
        subjects.forEach(n => {
            const c = document.createElement('span');
            c.className = cls;
            c.textContent = n;
            box.appendChild(c);
        });
    });
}

// Keep the teacher sidebar chips in sync when subjects are added/removed.
if (typeof renderMySubjectChips === 'function') {
    const _origRenderChips = renderMySubjectChips;
    window.renderMySubjectChips = function () { _origRenderChips(); renderTeacherProfile(); };
}

function fillTeacherEditForm() {
    document.getElementById('teacher-edit-name').value = window.APP.currentUser || '';
    document.getElementById('teacher-edit-bio').value = teacherProfile.bio || '';
    const prev = document.getElementById('teacher-photo-preview');
    if (teacherProfile.photo) { prev.src = teacherProfile.photo; prev.classList.remove('hidden'); }
    else prev.classList.add('hidden');
}
function toggleTeacherProfileEdit() {
    pendingTeacherPhoto = null;
    const form = document.getElementById('teacher-edit-form');
    const opening = form.classList.contains('hidden');
    form.classList.toggle('hidden');
    if (opening) fillTeacherEditForm();
}
function openTeacherProfileEdit() {
    closeShellMenus();
    switchTeacherTab('profile');
    pendingTeacherPhoto = null;
    fillTeacherEditForm();
    document.getElementById('teacher-edit-form').classList.remove('hidden');
}
function handleTeacherPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
        alert("Invalid image type. Please select a PNG, JPG, JPEG, or WEBP image.");
        event.target.value = "";
        return;
    }
    compressAndResizeImage(file, 300, 300, 0.85, (dataUrl) => {
        pendingTeacherPhoto = dataUrl;
        const img = document.getElementById('teacher-photo-preview');
        img.src = dataUrl;
        img.classList.remove('hidden');
    });
}
async function saveTeacherProfile() {
    const msg = document.getElementById('teacher-profile-msg');
    const name = document.getElementById('teacher-edit-name').value.trim();
    const bio = document.getElementById('teacher-edit-bio').value.trim();
    const photo = pendingTeacherPhoto || teacherProfile.photo || null;
    const fail = (t) => { msg.innerText = t; msg.style.color = "#d9534f"; };
    if (!name) return fail("Name can't be empty.");

    try {
        const { error: nameErr } = await window.mySupabase.from('teachers').update({ name }).eq('id', window.APP.currentUserId);
        if (nameErr) return fail(`Could not save your name: ${nameErr.message}`);

        const { error: profErr } = await window.mySupabase.from('teacher_profiles').upsert({
            teacher_id: window.APP.currentUserId, photo, bio, updated_at: new Date().toISOString()
        });
        let note = "Profile saved!";
        if (profErr) {
            // teacher_profiles table missing: keep the photo on this device so it isn't lost
            if (photo) { try { localStorage.setItem(teacherPhotoKey(), photo); } catch (e) { /* ignore */ } }
            note = "Name saved. Photo and bio are only saved on this device until the database update is run.";
        }

        window.APP.currentUser = name;
        persistSession();
        teacherProfile = { photo, bio };
        pendingTeacherPhoto = null;
        renderTeacherProfile();
        document.getElementById('teacher-edit-form').classList.add('hidden');
        msg.innerText = note;
        msg.style.color = profErr ? "#8a5a00" : "#28a745";
    } catch (e) {
        return fail("Unable to connect to database.");
    }
    setTimeout(() => msg.innerText = "", 5000);
}

// ---------- Who is online (Supabase Realtime presence) ----------
function startPresence(role) {
    stopPresence();
    if (!window.mySupabase || typeof window.mySupabase.channel !== 'function') return;
    try {
        const myKey = role + '-' + window.APP.currentUserId;
        presenceChannel = window.mySupabase.channel('mcwmg-online', { config: { presence: { key: myKey } } });
        presenceChannel
            .on('presence', { event: 'sync' }, () => renderOnline(myKey, role))
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceChannel.track({ name: window.APP.currentUser || 'Someone', role, id: String(window.APP.currentUserId) });
                }
            });
    } catch (e) { /* presence is optional - the page works without it */ }
}

function stopPresence() {
    if (presenceChannel) {
        try { window.mySupabase.removeChannel(presenceChannel); } catch (e) { /* ignore */ }
        presenceChannel = null;
    }
}

function renderOnline(myKey) {
    if (!presenceChannel) return;
    const state = presenceChannel.presenceState();
    onlineOthers = Object.entries(state)
        .filter(([key]) => key !== myKey)
        .map(([key, metas]) => {
            const m = metas[0] || {};
            return { key, id: String(m.id || key.split('-')[1]), role: m.role || key.split('-')[0], name: m.name || 'Someone' };
        })
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    renderOnlinePanel();
}

// ---------- Light / dark theme ----------
// Light = the original site colours. Dark = Facebook-style dark (see styles.css).
// The choice is remembered in this browser.
function applyTheme(theme) {
    if (theme === 'dark') document.body.setAttribute('data-theme', 'dark');
    else document.body.removeAttribute('data-theme');
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.innerText = theme === 'dark' ? '☀️' : '🌙';
        btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    });
}
function toggleTheme() {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('mcwmg_theme', next); } catch (e) { /* theme still switches for this visit */ }
    applyTheme(next);
}
window.addEventListener('DOMContentLoaded', () => {
    let saved = 'light';
    try { saved = localStorage.getItem('mcwmg_theme') === 'dark' ? 'dark' : 'light'; } catch (e) { /* default to light */ }
    applyTheme(saved);
});
