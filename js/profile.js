// === STUDENT PROFILE + AUTOMATIC CLASS PROGRESSION ===
//
// Class progression, in plain terms: there is no server cron here (this is
// a static client-side app), so progression is applied lazily - the first
// time a student logs in on or after September 1st of any year, their
// class quietly advances one level before their profile is shown. A
// "class_year" marker records which school year their current class
// value already accounts for, so it only ever advances once per year,
// no matter how many times they log in.

const CLASS_LEVELS = [
    'Kindergarten',
    'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
    'JSS1', 'JSS2', 'JSS3',
    'SS1', 'SS2', 'SS3',
    'O-Level'
];

// The "school year marker" changes exactly once, on September 1st each year.
function currentSchoolYearMarker(date = new Date()) {
    const year = date.getFullYear();
    return date.getMonth() >= 8 ? year + 1 : year; // getMonth() 8 = September
}

function applyClassProgression(profile) {
    const marker = currentSchoolYearMarker();
    if (!profile.class_year) { profile.class_year = marker; return profile; } // first time ever - no jump
    if (marker <= profile.class_year) return profile; // not yet the next Sept 1

    const steps = marker - profile.class_year;
    const currentIndex = CLASS_LEVELS.indexOf(profile.class);
    const newIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + steps, CLASS_LEVELS.length - 1);
    profile.class = CLASS_LEVELS[newIndex];
    profile.class_year = marker;
    return profile;
}

async function loadStudentProfile() {
    const nameInput = document.getElementById('profile-name');
    const ageInput = document.getElementById('profile-age');
    const classSelect = document.getElementById('profile-class');
    const hobbiesInput = document.getElementById('profile-hobbies');
    const photoImg = document.getElementById('profile-photo-preview');
    const msg = document.getElementById('profile-msg');
    msg.innerText = '';

    if (classSelect.options.length === 0) {
        classSelect.innerHTML = CLASS_LEVELS.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    try {
        const { data: student } = await window.mySupabase.from('students').select('name').eq('id', window.APP.currentUserId).single();
        nameInput.value = (student && student.name) || window.APP.currentUser || '';

        let { data: profile } = await window.mySupabase
            .from('student_profiles').select('*').eq('student_id', window.APP.currentUserId).maybeSingle();

        if (!profile) {
            profile = { student_id: window.APP.currentUserId, photo: null, age: null, class: CLASS_LEVELS[0], hobbies: '', class_year: currentSchoolYearMarker() };
            await window.mySupabase.from('student_profiles').insert([profile]);
        } else {
            const before = profile.class;
            const beforeYear = profile.class_year;
            profile = applyClassProgression(profile);
            if (profile.class !== before || profile.class_year !== beforeYear) {
                await window.mySupabase.from('student_profiles')
                    .update({ class: profile.class, class_year: profile.class_year })
                    .eq('student_id', window.APP.currentUserId);
            }
        }

        ageInput.value = profile.age || '';
        classSelect.value = profile.class || CLASS_LEVELS[0];
        hobbiesInput.value = profile.hobbies || '';
        if (profile.photo) {
            photoImg.src = profile.photo;
            photoImg.classList.remove('hidden');
        } else {
            photoImg.classList.add('hidden');
        }
        window._myProfilePhoto = profile.photo || null;

        // --- View-mode (TikTok/Instagram-style profile card) ---
        const displayName = (student && student.name) || window.APP.currentUser || 'Student';
        document.getElementById('profile-view-name').innerText = displayName;
        document.getElementById('profile-view-class').innerText = `Class: ${profile.class || '-'}`;
        document.getElementById('profile-view-age').innerText = `Age: ${profile.age || '-'}`;
        document.getElementById('profile-view-hobbies').innerText = profile.hobbies ? `"${profile.hobbies}"` : '';
        const avatarSrc = profile.photo || 'img/logo.png';
        document.getElementById('profile-avatar-view').src = avatarSrc;

        const subjectNames = await getMySubjectNames(window.APP.currentUserId);
        document.getElementById('profile-view-subjects').innerHTML = subjectNames.length > 0
            ? subjectNames.map(n => `<span class="profile-subject-chip">${n}</span>`).join('')
            : `<span style="color:#999;font-size:13px;">No subjects ticked yet - see the Subjects tab</span>`;

        refreshStickyStudentHeader(displayName, avatarSrc);
        if (typeof updateStudentSidebar === 'function') updateStudentSidebar(profile.class, subjectNames);
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
}

// Keeps the persistent top header (visible on every student tab) in sync.
function refreshStickyStudentHeader(name, photoSrc) {
    const nameEl = document.getElementById('sticky-name');
    const avatarEl = document.getElementById('sticky-avatar');
    if (nameEl && name) nameEl.innerText = name;
    if (avatarEl) avatarEl.src = photoSrc || window._myProfilePhoto || 'img/logo.png';
    const navAvatar = document.getElementById('student-nav-avatar');
    const sideAvatar = document.getElementById('student-side-avatar');
    const src = photoSrc || window._myProfilePhoto || 'img/logo.png';
    if (navAvatar) navAvatar.src = src;
    if (sideAvatar) sideAvatar.src = src;
}

function toggleProfileEditMode() {
    document.getElementById('profile-edit-form').classList.toggle('hidden');
}

function handleProfilePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        alert("Invalid image type. Please select a PNG, JPG, JPEG, or WEBP image.");
        event.target.value = "";
        return;
    }
    compressAndResizeImage(file, 300, 300, 0.85, (dataUrl) => {
        window._myProfilePhoto = dataUrl;
        const photoImg = document.getElementById('profile-photo-preview');
        photoImg.src = dataUrl;
        photoImg.classList.remove('hidden');
    });
}

async function saveStudentProfile() {
    const msg = document.getElementById('profile-msg');
    const name = document.getElementById('profile-name').value.trim();
    const age = parseInt(document.getElementById('profile-age').value, 10) || null;
    const chosenClass = document.getElementById('profile-class').value;
    const hobbies = document.getElementById('profile-hobbies').value.trim();

    if (!name) { msg.innerText = "Name can't be empty."; msg.style.color = "#d9534f"; return; }

    try {
        await window.mySupabase.from('students').update({ name }).eq('id', window.APP.currentUserId);

        // Changing class yourself resets the progression marker to the current
        // school year, so it won't immediately jump forward again next login.
        const { error } = await window.mySupabase.from('student_profiles').update({
            photo: window._myProfilePhoto || null, age, class: chosenClass, hobbies,
            class_year: currentSchoolYearMarker(), updated_at: new Date().toISOString()
        }).eq('student_id', window.APP.currentUserId);

        if (error) { msg.innerText = `Failed to save: ${error.message}`; msg.style.color = "#d9534f"; return; }

        window.APP.currentUser = name;
        await loadStudentProfile(); // refreshes both the view-mode card and the sticky header
        toggleProfileEditMode();
        const msgAfter = document.getElementById('profile-msg');
        msgAfter.innerText = "Profile saved!";
        msgAfter.style.color = "#28a745";
        setTimeout(() => msgAfter.innerText = "", 4000);
        return;
    } catch (err) {
        msg.innerText = "Unable to connect to database.";
        msg.style.color = "#d9534f";
    }
    setTimeout(() => msg.innerText = "", 4000);
}
