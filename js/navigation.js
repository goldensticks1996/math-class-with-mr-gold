// === NAVIGATION MODULE ===
// Keeps the browser / phone Back button INSIDE the app while someone is logged in.
//
//   * Every tab the user opens is remembered. Back walks back through them:
//       Tab 4 -> Tab 3 -> Tab 2 -> Tab 1 -> home tab.
//   * On the home tab, Back does nothing - it can no longer take the user out of the website.
//   * Forward is switched off, so history can't be used to hop around the portal.
//   * Pop-ups (report viewer, person profile) and a teacher's profile page count as a step, so Back
//     closes them first instead of changing tab.
//   * Logging out ends this. Back/Forward after logout cannot show anything (see the note below).
//
// IMPORTANT - this is a convenience and safety net, NOT what protects the data. Pages here are only
// shown while a logged-in session exists; once logged out nothing protected is on screen no matter what
// the history does. Real protection of the data belongs in the database / sign-in system (see notes).
//
// How it works: the browser history is made of entries we create ourselves.
//   [ guard entry (idx -1) ][ home (idx 0) ][ next tab (idx 1) ] ...
// "Back from home" lands on the guard entry, and we immediately step forward again.

const Nav = { active: false, token: null, role: null, idx: 0, stack: [], applying: false, established: false };

function navNewToken() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// Some browsers (Chrome on Android) ignore history entries added before the person has touched the page.
// After a refresh we therefore wait for the first tap/keypress before laying the entries down.
function navHasGesture() {
    return !navigator.userActivation || navigator.userActivation.hasBeenActive;
}

function navEstablish() {
    if (!Nav.active || Nav.established) return;
    Nav.established = true;
    try {
        history.replaceState({ mcwmg: Nav.token, idx: -1 }, '');
        history.pushState({ mcwmg: Nav.token, idx: 0 }, '');
    } catch (e) { /* history not available - the app still works, Back just behaves normally */ }
}

function navStart(role, homeView) {
    if (Nav.active && Nav.role === role) return;       // already running for this login
    navStop();
    Nav.active = true;
    Nav.role = role;
    Nav.token = navNewToken();
    Nav.idx = 0;
    Nav.stack = [{ view: homeView || null, sub: null }];
    Nav.established = false;

    if (navHasGesture()) {
        navEstablish();
    } else {
        const once = () => {
            ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.removeEventListener(ev, once, true));
            navEstablish();
        };
        ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, once, true));
    }
}

function navStop() {
    Nav.active = false;
    Nav.role = null;
    Nav.stack = [];
    Nav.idx = 0;
    Nav.established = false;
}

// ---------- Recording where the user goes ----------
function navPush(entry) {
    navEstablish();
    Nav.stack.length = Nav.idx + 1;         // anything "ahead" is forgotten
    Nav.stack.push(entry);
    Nav.idx++;
    try { history.pushState({ mcwmg: Nav.token, idx: Nav.idx }, ''); } catch (e) { /* ignore */ }
}

// A tab (or a page inside a tab, such as one teacher's profile) was opened.
function navRecord(view, sub) {
    if (!Nav.active || Nav.applying) return;
    const top = Nav.stack[Nav.idx];
    const s = sub || null;
    if (top && !top.overlay && top.view === view && (top.sub || null) === s) return;   // same place - nothing new
    navPush({ view, sub: s });
}

// A page inside a tab was closed by the app's own Back button -> take that step out of history too.
function navSubClosed(view) {
    if (!Nav.active || Nav.applying) return;
    const top = Nav.stack[Nav.idx];
    if (top && !top.overlay && top.view === view && top.sub) history.back();
}

// A pop-up opened / closed.
function navOverlayOpened(name) {
    if (!Nav.active || Nav.applying) return;
    const top = Nav.stack[Nav.idx];
    if (top && top.overlay === name) return;
    navPush({ view: top ? top.view : null, sub: top ? top.sub : null, overlay: name });
}
function navOverlayClosed(name) {
    if (!Nav.active || Nav.applying) return;
    const top = Nav.stack[Nav.idx];
    if (top && top.overlay === name) history.back();
}

// ---------- Going back ----------
function navCloseOverlays() {
    const report = document.getElementById('report-modal-overlay');
    if (report && !report.classList.contains('hidden') && typeof closeReportModal === 'function') closeReportModal();
    if (typeof closePersonProfile === 'function') closePersonProfile();
}

function navGoToView(view, sub) {
    if (!view) return;
    if (Nav.role === 'student') {
        const panel = document.getElementById(`student-${view}-view`);
        const alreadyThere = panel && !panel.classList.contains('hidden');
        if (!alreadyThere) switchStudentView(view);
        if (view === 'teachers') {
            if (sub && typeof teacherDirectory !== 'undefined' && teacherDirectory.some(t => String(t.id) === String(sub))) openTeacherPage(sub);
            else if (alreadyThere && typeof closeTeacherPage === 'function') closeTeacherPage();
        }
    } else if (Nav.role === 'teacher') {
        switchTeacherTab(view);
    }
}

function navApply(entry) {
    if (!entry) return;
    Nav.applying = true;               // so the things below don't write new history entries
    try {
        navCloseOverlays();            // a pop-up can't be re-opened from history, so just show the page under it
        navGoToView(entry.view, entry.sub);
    } finally {
        Nav.applying = false;
    }
}

window.addEventListener('popstate', (e) => {
    if (!Nav.active) return;                                    // logged out: history can't do anything
    if (!window.APP || !window.APP.currentRole) {               // session gone but screen still up - back to login
        navStop();
        if (typeof showScreen === 'function') showScreen('login-screen');
        return;
    }
    const st = e.state;
    if (!st || st.mcwmg !== Nav.token) {
        // An entry that is not part of this login (e.g. from before a refresh): stay in the app.
        try { history.pushState({ mcwmg: Nav.token, idx: Nav.idx }, ''); } catch (err) { /* ignore */ }
        return;
    }
    if (st.idx === Nav.idx) return;                             // nothing changed
    if (st.idx > Nav.idx) { history.go(Nav.idx - st.idx); return; }   // Forward: not allowed - step back to where we were
    if (st.idx < 0) { history.go(1); return; }                  // Back from the home tab: stay put
    Nav.idx = st.idx;                                           // Back to an earlier tab
    navApply(Nav.stack[Nav.idx]);
});

// If the browser restores the page from its back/forward cache after the session ended, show the login screen.
window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (!sessionStorage.getItem('mcwmg_session') && typeof showScreen === 'function') {
        navStop();
        if (typeof resetWorkspaceState === 'function') resetWorkspaceState();
        showScreen('login-screen');
    }
});

// Called by showScreen() whenever the visible screen changes.
function navOnScreenChange(screenId) {
    if (screenId === 'student-dashboard') navStart('student', 'tests');
    else if (screenId === 'teacher-dashboard') navStart('teacher', 'manual');
    else if (screenId === 'admin-dashboard') navStart('admin', null);
    else navStop();
}
