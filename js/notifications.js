// === NOTIFICATIONS + FRIENDS MODULE ===
// Bell notifications for students and teachers, plus friend requests.
// There is NO messaging here - friends can only be added/accepted for now.
//
// Notifications are rows in `notifications`; friend links are rows in `friendships`.
// The bell refreshes every 20 seconds and whenever it is opened.

let notifTimer = null;
let notifCache = [];
let friendships = [];       // every friendship row that involves me
let friendNames = {};       // 'student-5' -> 'Ada Obi'
let onlineOthers = [];      // [{ key, id, role, name }] from the presence channel (see shell.js)

function myIdentity() {
    return { type: window.APP.currentRole, id: String(window.APP.currentUserId) };
}
function personKey(type, id) { return `${type}-${id}`; }

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Sending ----------
async function sendNotification(recipientType, recipientId, type, title, body, data) {
    try {
        await window.mySupabase.from('notifications').insert([{
            recipient_type: recipientType, recipient_id: recipientId, type, title, body, data: data || {}
        }]);
    } catch (e) { /* a missed notification must never break the action that triggered it */ }
}

// ---------- Lifecycle ----------
function startNotifications() {
    stopNotifications();
    refreshNotifications();
    loadFriendships();
    notifTimer = setInterval(() => { refreshNotifications(); loadFriendships(); }, 20000);
}
function stopNotifications() {
    if (notifTimer) clearInterval(notifTimer);
    notifTimer = null;
    notifCache = []; friendships = []; friendNames = {}; onlineOthers = [];
    // Wipe the bell and side lists so nothing from this person is left on the page for the next login.
    ['student', 'teacher'].forEach(r => {
        const list = document.getElementById(`${r}-bell-list`);
        if (list) list.innerHTML = '<p class="shell-menu-empty">No new notifications.</p>';
        const badge = document.getElementById(`${r}-bell-badge`);
        if (badge) badge.classList.add('hidden');
        const online = document.getElementById(`${r}-online-list`);
        if (online) online.innerHTML = '<p class="online-empty">No one else is online right now.</p>';
        const friends = document.getElementById(`${r}-friends-list`);
        if (friends) friends.innerHTML = '<p class="online-empty">No friends yet.</p>';
        const count = document.getElementById(`${r}-online-count`);
        if (count) count.innerText = '0';
    });
}

function timeAgo(iso) {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
}

const NOTIF_ICONS = { test_submitted: '📝', result_uploaded: '📊', friend_request: '👋', friend_accepted: '🤝' };

// ---------- Bell ----------
async function refreshNotifications(markRead) {
    const role = window.APP.currentRole;
    if (role !== 'student' && role !== 'teacher') return;
    const badge = document.getElementById(`${role}-bell-badge`);
    const list = document.getElementById(`${role}-bell-list`);
    if (!badge || !list) return;

    try {
        const { data, error } = await window.mySupabase.from('notifications').select('*')
            .eq('recipient_type', role).eq('recipient_id', window.APP.currentUserId)
            .order('created_at', { ascending: false }).limit(30);
        if (error) return; // table not created yet - bell simply stays empty
        notifCache = data || [];
    } catch (e) { return; }

    const unread = notifCache.filter(n => !n.is_read);
    const menuOpen = !document.getElementById(`${role}-bell-menu`).classList.contains('hidden');

    renderNotificationList(role, list);

    if (menuOpen || markRead) {
        // Opening the bell counts as seeing them: clear the badge, keep this render's highlight.
        badge.classList.add('hidden');
        if (unread.length > 0) {
            try { await window.mySupabase.from('notifications').update({ is_read: true }).in('id', unread.map(n => n.id)); } catch (e) { /* ignore */ }
            notifCache.forEach(n => { n.is_read = true; });
        }
    } else {
        badge.innerText = unread.length > 9 ? '9+' : unread.length;
        badge.classList.toggle('hidden', unread.length === 0);
    }
}

function renderNotificationList(role, list) {
    list.innerHTML = '';
    if (notifCache.length === 0) {
        list.innerHTML = '<p class="shell-menu-empty">No new notifications.</p>';
        return;
    }
    notifCache.forEach(n => {
        const item = document.createElement('div');
        item.className = 'notif-item' + (n.is_read ? '' : ' unread');
        let actions = '';
        if (n.type === 'friend_request') {
            const fr = friendships.find(f => String(f.id) === String(n.data && n.data.friendship_id));
            if (fr && fr.status === 'pending' && String(fr.addressee_id) === String(window.APP.currentUserId) && fr.addressee_type === role) {
                actions = `<div class="notif-actions">
                    <button type="button" class="btn-success" onclick="event.stopPropagation(); respondFriendRequest(${fr.id}, true)">Accept</button>
                    <button type="button" class="btn-secondary" onclick="event.stopPropagation(); respondFriendRequest(${fr.id}, false)">Decline</button></div>`;
            } else if (fr) {
                actions = `<div class="notif-status">${fr.status === 'accepted' ? '✓ You are now friends' : 'Request declined'}</div>`;
            }
        }
        const clickable = n.type === 'test_submitted' || n.type === 'result_uploaded';
        item.innerHTML = `
            <div class="notif-icon">${NOTIF_ICONS[n.type] || '🔔'}</div>
            <div class="notif-main">
                <div class="notif-title">${escapeHtml(n.title)}</div>
                <div class="notif-body">${escapeHtml(n.body)}</div>
                <div class="notif-time">${timeAgo(n.created_at)}${clickable ? ' · tap to open' : ''}</div>
                ${actions}
            </div>`;
        if (clickable) { item.classList.add('clickable'); item.onclick = () => handleNotificationClick(n); }
        list.appendChild(item);
    });
}

async function handleNotificationClick(n) {
    closeShellMenus();
    const d = n.data || {};
    if (n.type === 'test_submitted' && window.APP.currentRole === 'teacher') {
        // Jump to that student's report card tab.
        if (d.student_id) {
            await goToGradebookFor(d.student_id);
            switchTeacherTab('report');
        }
    } else if (n.type === 'result_uploaded' && window.APP.currentRole === 'student') {
        // Show the exact result the teacher uploaded, with a Download button.
        switchStudentView('reports');
        await loadMyReportCards();
        if (d.report_id && window._reportCardsCache && window._reportCardsCache[d.report_id]) {
            viewStoredReport(d.report_id);
        }
    }
}

// ---------- Friends ----------
async function loadFriendships() {
    const me = myIdentity();
    if (me.type !== 'student' && me.type !== 'teacher') return;
    try {
        const { data, error } = await window.mySupabase.from('friendships').select('*')
            .or(`and(requester_type.eq.${me.type},requester_id.eq.${me.id}),and(addressee_type.eq.${me.type},addressee_id.eq.${me.id})`);
        if (error) return; // table not created yet
        friendships = data || [];
    } catch (e) { return; }

    // Look up names of accepted friends (so offline friends still show by name).
    const ids = { student: [], teacher: [] };
    friendships.filter(f => f.status === 'accepted').forEach(f => {
        const other = otherSide(f);
        if (!friendNames[personKey(other.type, other.id)]) ids[other.type].push(other.id);
    });
    try {
        if (ids.student.length) {
            const { data } = await window.mySupabase.from('students').select('id, name, username').in('id', ids.student);
            (data || []).forEach(s => { friendNames[personKey('student', s.id)] = s.name || s.username; });
        }
        if (ids.teacher.length) {
            const { data } = await window.mySupabase.from('teachers').select('id, name, username').in('id', ids.teacher);
            (data || []).forEach(t => { friendNames[personKey('teacher', t.id)] = t.name || t.username; });
        }
    } catch (e) { /* names fall back to "Friend" */ }

    renderOnlinePanel();
    renderNotificationList(window.APP.currentRole, document.getElementById(`${window.APP.currentRole}-bell-list`));
}

function otherSide(f) {
    const me = myIdentity();
    const iAmRequester = f.requester_type === me.type && String(f.requester_id) === me.id;
    return iAmRequester ? { type: f.addressee_type, id: String(f.addressee_id) } : { type: f.requester_type, id: String(f.requester_id) };
}

// What is my relationship with this person? -> { row, state: 'none'|'sent'|'received'|'friends' }
function relationWith(type, id) {
    const row = friendships.find(f => { const o = otherSide(f); return o.type === type && o.id === String(id); });
    if (!row || row.status === 'declined') return { row, state: 'none' };
    if (row.status === 'accepted') return { row, state: 'friends' };
    const me = myIdentity();
    return { row, state: (row.requester_type === me.type && String(row.requester_id) === me.id) ? 'sent' : 'received' };
}

// Students can add students; teachers can add students. (Nobody is added by a teacher-to-teacher request.)
function canSendRequestTo(otherRole) {
    return otherRole === 'student';
}

async function sendFriendRequest(type, id, name) {
    if (!canSendRequestTo(type)) return;
    const me = myIdentity();
    const rel = relationWith(type, id);
    if (rel.state !== 'none') return;
    let friendshipId = null;
    try {
        if (rel.row) { // an old declined request - reopen it
            const { data } = await window.mySupabase.from('friendships').update({
                requester_type: me.type, requester_id: me.id, addressee_type: type, addressee_id: id, status: 'pending'
            }).eq('id', rel.row.id).select().single();
            friendshipId = data ? data.id : rel.row.id;
        } else {
            const { data, error } = await window.mySupabase.from('friendships').insert([{
                requester_type: me.type, requester_id: me.id, addressee_type: type, addressee_id: id, status: 'pending'
            }]).select().single();
            if (error || !data) { alert('Could not send the friend request. Please try again.'); return; }
            friendshipId = data.id;
        }
        await sendNotification(type, id, 'friend_request', 'New friend request',
            `${window.APP.currentUser || 'Someone'} sent you a friend request.`,
            { friendship_id: friendshipId, from_type: me.type, from_id: me.id });
    } catch (e) { alert('Could not send the friend request. Please try again.'); return; }
    await loadFriendships();
}

async function respondFriendRequest(friendshipId, accept) {
    const fr = friendships.find(f => String(f.id) === String(friendshipId));
    try {
        await window.mySupabase.from('friendships').update({ status: accept ? 'accepted' : 'declined' }).eq('id', friendshipId);
        if (accept && fr) {
            await sendNotification(fr.requester_type, fr.requester_id, 'friend_accepted', 'Friend request accepted',
                `${window.APP.currentUser || 'Someone'} accepted your friend request.`, { friendship_id: fr.id });
        }
    } catch (e) { /* reload below shows the real state */ }
    await loadFriendships();
    refreshNotifications();
}

// ---------- Right-hand column: who is online + my friends ----------
function renderOnlinePanel() {
    const role = window.APP.currentRole;
    const list = document.getElementById(`${role}-online-list`);
    const count = document.getElementById(`${role}-online-count`);
    const friendsBox = document.getElementById(`${role}-friends-list`);
    if (!list) return;

    count.innerText = onlineOthers.length;
    list.innerHTML = '';
    if (onlineOthers.length === 0) {
        list.innerHTML = '<p class="online-empty">No one else is online right now.</p>';
    }
    onlineOthers.forEach(o => {
        const rel = relationWith(o.role, o.id);
        let action = '';
        if (rel.state === 'friends') action = '<span class="fr-tag">✓ Friends</span>';
        else if (rel.state === 'sent') action = '<span class="fr-tag fr-pending">Request sent</span>';
        else if (rel.state === 'received') action = `<button type="button" class="fr-btn fr-accept" onclick="respondFriendRequest(${rel.row.id}, true)">Accept</button>`;
        else if (canSendRequestTo(o.role)) action = `<button type="button" class="fr-btn" data-type="${o.role}" data-id="${escapeHtml(o.id)}" data-name="${escapeHtml(o.name)}">➕ Add</button>`;
        list.appendChild(buildPersonRow(o.name, o.role, true, action));
    });
    list.querySelectorAll('.fr-btn[data-id]').forEach(b => {
        b.onclick = () => sendFriendRequest(b.dataset.type, b.dataset.id, b.dataset.name);
    });

    if (friendsBox) {
        friendsBox.innerHTML = '';
        const accepted = friendships.filter(f => f.status === 'accepted');
        if (accepted.length === 0) {
            friendsBox.innerHTML = '<p class="online-empty">No friends yet.</p>';
        }
        accepted.forEach(f => {
            const o = otherSide(f);
            const isOnline = onlineOthers.some(x => x.role === o.type && String(x.id) === o.id);
            friendsBox.appendChild(buildPersonRow(friendNames[personKey(o.type, o.id)] || 'Friend', o.type, isOnline, ''));
        });
    }
}

const ONLINE_COLORS = ['#3d5ee1', '#7c5cff', '#f0a233', '#3cc47c', '#35c2d6', '#ff6b6b'];
function buildPersonRow(name, role, online, actionHtml) {
    const row = document.createElement('div');
    row.className = 'online-row';
    const av = document.createElement('div');
    av.className = 'online-avatar' + (online ? '' : ' offline');
    av.textContent = (name || '?').trim().charAt(0).toUpperCase();
    av.style.background = ONLINE_COLORS[(name || '').length % ONLINE_COLORS.length];
    const info = document.createElement('div');
    info.className = 'online-info';
    const nm = document.createElement('div');
    nm.className = 'online-name';
    nm.textContent = name || 'Someone';
    const rl = document.createElement('div');
    rl.className = 'online-role';
    rl.textContent = role === 'teacher' ? 'Teacher' : 'Student';
    info.append(nm, rl);
    row.append(av, info);
    if (actionHtml) { const a = document.createElement('div'); a.className = 'online-action'; a.innerHTML = actionHtml; row.appendChild(a); }
    return row;
}
