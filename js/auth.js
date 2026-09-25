// === AUTH MODULE ===
// Registration, login, logout, and teacher-approval, all backed by Supabase
// (students / teachers / admins tables). No more localStorage account data.

function switchAuthMode(mode) {
    document.getElementById('login-error').innerText = "";
    document.getElementById('login-msg').innerText = "";
    if (mode === 'login') {
        document.getElementById('auth-login-form').classList.remove('hidden');
        document.getElementById('auth-register-form').classList.add('hidden');
    } else {
        document.getElementById('auth-login-form').classList.add('hidden');
        document.getElementById('auth-register-form').classList.remove('hidden');
        toggleRegisterRoleFields();
    }
}

function toggleRegisterRoleFields() {
    const role = document.getElementById('reg-role').value;
    document.getElementById('student-reg-fields').classList.toggle('hidden', role !== 'student');
    document.getElementById('teacher-reg-fields').classList.toggle('hidden', role !== 'teacher');
}

async function handleStudentRegister() {
    const u = document.getElementById('reg-username').value.trim();
    const p = document.getElementById('reg-password').value.trim();
    const errorEl = document.getElementById('login-error');
    const msgEl = document.getElementById('login-msg');
    errorEl.innerText = ""; msgEl.innerText = "";

    if (!u || !p) {
        errorEl.innerText = "Please provide both username and password!";
        return;
    }

    try {
        // Check for an existing username first (students table now has a SELECT policy)
        const { data: existing, error: checkErr } = await window.mySupabase
            .from('students')
            .select('id')
            .eq('username', u);

        if (checkErr) {
            errorEl.innerText = `Registration failed: ${checkErr.message}`;
            return;
        }
        if (existing && existing.length > 0) {
            errorEl.innerText = "Username already exists. Choose another.";
            return;
        }

        const { error } = await window.mySupabase
            .from('students')
            .insert([{ name: u, username: u, password: p }]);

        if (error) {
            errorEl.innerText = `Registration failed: ${error.message}`;
            return;
        }

        msgEl.innerText = `Registration successful! You can now log in as ${u}.`;
        document.getElementById('reg-username').value = "";
        document.getElementById('reg-password').value = "";
        setTimeout(() => switchAuthMode('login'), 1500);

    } catch (err) {
        errorEl.innerText = "Unable to connect to database. Please check your network connection.";
    }
}

async function handleTeacherRegister() {
    const fullName = document.getElementById('reg-teacher-fullname').value.trim();
    const username = document.getElementById('reg-teacher-username').value.trim();
    const password = document.getElementById('reg-teacher-password').value.trim();
    const errorEl = document.getElementById('login-error');
    const msgEl = document.getElementById('login-msg');
    errorEl.innerText = ""; msgEl.innerText = "";

    if (!fullName || !username || !password) {
        errorEl.innerText = "Please fill in all teacher registration fields!";
        return;
    }

    try {
        const { data: existingTeachers, error: checkError } = await window.mySupabase
            .from('teachers')
            .select('id')
            .eq('username', username);

        if (checkError) {
            errorEl.innerText = `Registration failed: ${checkError.message}`;
            return;
        }
        if (existingTeachers && existingTeachers.length > 0) {
            errorEl.innerText = "Teacher username already exists. Choose another.";
            return;
        }

        const { error } = await window.mySupabase
            .from('teachers')
            .insert([{ name: fullName, username: username, password: password, status: 'pending' }]);

        if (error) {
            errorEl.innerText = `Registration failed: ${error.message}`;
            return;
        }

        msgEl.innerText = "Teacher registration successful. Your account is pending admin approval.";
        document.getElementById('reg-teacher-fullname').value = "";
        document.getElementById('reg-teacher-username').value = "";
        document.getElementById('reg-teacher-password').value = "";

    } catch (err) {
        errorEl.innerText = "Unable to connect to database. Please check your network connection.";
    }
}

async function handleLogin() {
    const role = document.getElementById('login-role').value;
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value.trim();
    const errorText = document.getElementById('login-error');
    errorText.innerText = "";

    if (!user || !pass) {
        errorText.innerText = "Please enter both username and password.";
        return;
    }

    try {
        if (role === 'admin') {
            const { data, error } = await window.mySupabase.from('admins').select('*').eq('username', user);
            if (error) { errorText.innerText = `Database error: ${error.message}`; return; }
            if (!data || data.length === 0 || data[0].password !== pass) {
                errorText.innerText = "Invalid administrator credentials.";
                return;
            }
            window.APP.currentUser = data[0].name || data[0].username;
            window.APP.currentRole = 'admin';
            window.APP.currentUserId = data[0].id;
            persistSession();
            showScreen('admin-dashboard');
            loadPendingTeachers();
            populateAdminStudentDropdown();

        } else if (role === 'teacher') {
            const { data, error } = await window.mySupabase.from('teachers').select('*').eq('username', user);
            if (error) { errorText.innerText = `Database error: ${error.message}`; return; }
            if (!data || data.length === 0 || data[0].password !== pass) {
                errorText.innerText = "Invalid teacher credentials. Please try again.";
                return;
            }
            const teacherRecord = data[0];
            if (teacherRecord.status === 'pending') {
                errorText.innerText = "Your teacher account is awaiting admin approval.";
                return;
            }
            if (teacherRecord.status === 'rejected') {
                errorText.innerText = "Your teacher account has been rejected. Please contact the administrator.";
                return;
            }
            window.APP.currentUser = teacherRecord.name || teacherRecord.username;
            window.APP.currentRole = 'teacher';
            window.APP.currentUserId = teacherRecord.id;
            persistSession();
            await populateStudentDropdown();
            showScreen('teacher-dashboard');

        } else {
            const { data, error } = await window.mySupabase.from('students').select('*').eq('username', user);
            if (error) { errorText.innerText = `Database error: ${error.message}`; return; }
            if (!data || data.length === 0 || data[0].password !== pass) {
                errorText.innerText = "Invalid Student Credentials!";
                return;
            }
            window.APP.currentUser = data[0].name || data[0].username;
            window.APP.currentRole = 'student';
            window.APP.currentUserId = data[0].id;
            persistSession();
            document.getElementById('student-welcome').innerText = `Welcome, ${window.APP.currentUser}!`;
            showScreen('student-dashboard');
            await loadAssignedAssessments();
        }
    } catch (err) {
        errorText.innerText = `Connection error: ${err.message || 'Unable to connect to database.'}`;
    }
}

async function loadPendingTeachers() {
    const tbody = document.getElementById('pending-teachers-body');
    const errorText = document.getElementById('admin-error');
    tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>Loading pending requests...</td></tr>";
    errorText.innerText = "";

    try {
        const { data, error } = await window.mySupabase.from('teachers').select('*').eq('status', 'pending');
        if (error) {
            errorText.innerText = `Error loading teachers: ${error.message}`;
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>Failed to load data.</td></tr>";
            return;
        }
        tbody.innerHTML = "";
        if (!data || data.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No pending teacher approval requests.</td></tr>";
            return;
        }
        data.forEach(teacher => {
            const tr = document.createElement('tr');
            const regDate = teacher.created_at ? new Date(teacher.created_at).toLocaleDateString() : 'N/A';
            tr.innerHTML = `
                <td>${teacher.name || 'N/A'}</td>
                <td>${teacher.username || 'N/A'}</td>
                <td>${regDate}</td>
                <td><span style="color: #d9534f; font-weight: bold;">${teacher.status}</span></td>
                <td>
                    <div class="action-btn-group">
                        <button class="btn-success" onclick="updateTeacherStatus('${teacher.id}', 'approved')">Approve</button>
                        <button class="btn-danger" onclick="updateTeacherStatus('${teacher.id}', 'rejected')">Reject</button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
    } catch (err) {
        errorText.innerText = "Unable to connect to database. Please check your network connection.";
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>Failed to load data.</td></tr>";
    }
}

async function updateTeacherStatus(teacherId, newStatus) {
    const msgText = document.getElementById('admin-msg');
    const errorText = document.getElementById('admin-error');
    msgText.innerText = ""; errorText.innerText = "";

    try {
        const { error } = await window.mySupabase.from('teachers').update({ status: newStatus }).eq('id', teacherId);
        if (error) { errorText.innerText = `Failed to update status: ${error.message}`; return; }
        msgText.innerText = `Teacher account successfully ${newStatus}!`;
        loadPendingTeachers();
        setTimeout(() => { msgText.innerText = ""; }, 3000);
    } catch (err) {
        errorText.innerText = "Unable to connect to database. Please check your network connection.";
    }
}

function logout() {
    if (window.totalExamTimer) clearInterval(window.totalExamTimer);
    clearSession();
    document.getElementById('username').value = "";
    document.getElementById('password').value = "";
    showScreen('login-screen');
}
