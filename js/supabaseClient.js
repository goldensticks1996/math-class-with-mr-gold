// === SUPABASE CLIENT (shared by every module) ===
const SUPABASE_URL = "https://ghphtrjtjvgatxuvxmsq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CL9vIyRDAlqtFMUwq7dPxw_zGsqUg16";

window.mySupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// === SESSION STATE (kept in-memory + sessionStorage so a refresh doesn't log you out) ===
window.APP = {
    currentUser: null,      // display name
    currentRole: null,      // 'student' | 'teacher' | 'admin'
    currentUserId: null,    // bigint id from the relevant table
    selectedStudentId: null // teacher's currently-selected student, for legacy screens
};

function persistSession() {
    sessionStorage.setItem('mcwmg_session', JSON.stringify(window.APP));
}
function restoreSession() {
    const raw = sessionStorage.getItem('mcwmg_session');
    if (raw) {
        try { Object.assign(window.APP, JSON.parse(raw)); } catch (e) { /* ignore corrupt session */ }
    }
}
function clearSession() {
    window.APP.currentUser = null;
    window.APP.currentRole = null;
    window.APP.currentUserId = null;
    window.APP.selectedStudentId = null;
    sessionStorage.removeItem('mcwmg_session');
}

function generateUUID() {
    return 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Question text can contain [u]underlined words[/u] (written by the PDF importer or typed by a teacher).
// This escapes everything, then turns only those markers into real underlines - so it is safe to show anywhere.
function formatQText(text) {
    const esc = String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return esc.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
}
// Passages keep their paragraph breaks.
function formatPassageHtml(text) {
    return formatQText(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>').concat('</p>');
}
