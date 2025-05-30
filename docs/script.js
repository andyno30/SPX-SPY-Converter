const backendURL = "https://spx-spy-converter.onrender.com";

// Email Login with Pop-Up
async function emailLogin() {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const feedback = document.getElementById('feedback');
    const loginStatus = document.getElementById('login-status'); // Reference to new status element

    if (!email || !password) {
        feedback.textContent = 'Please enter both email and password.';
        return;
    }

    // Show connecting message immediately
    loginStatus.style.display = 'block';
    loginStatus.textContent = 'Connecting to the server, please wait...';
    feedback.textContent = ''; // Clear any previous feedback

    try {
        const response = await fetch(`${backendURL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        // Hide connecting message once response is received
        loginStatus.style.display = 'none';

        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            alert('Login successful! Redirecting...');
            setTimeout(() => window.location.href = 'dashboard.html', 2000);
        } else {
            feedback.textContent = data.message || 'Login failed';
        }
    } catch (error) {
        console.error('Login error:', error);
        loginStatus.style.display = 'none'; // Hide on error too
        feedback.textContent = 'Server error. Please try again.';
    }
}

// Register User with Password Confirmation
async function registerUser() {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const confirmPassword = document.getElementById('confirm-password-input').value;
    const feedback = document.getElementById('feedback');

    if (!email || !password || !confirmPassword) {
        feedback.textContent = 'Please fill in all fields.';
        return;
    }

    if (password !== confirmPassword) {
        feedback.textContent = 'Passwords do not match.';
        return;
    }

    feedback.textContent = 'Registering, please wait...';

    try {
        const response = await fetch(`${backendURL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (response.ok) {
            alert('Signup successful! Redirecting to login...');
            feedback.textContent = 'Signup successful. Redirecting...';
            setTimeout(() => window.location.href = 'login.html', 2000);
        } else {
            feedback.textContent = data.message || 'Signup failed';
        }
    } catch (error) {
        console.error('Signup error:', error);
        feedback.textContent = 'Server error. Please try again.';
    }
}

// Delete Account
async function deleteAccount() {
    const token = localStorage.getItem("authToken");
    if (!token) {
        document.getElementById('delete-feedback').textContent = 'You must be logged in to delete your account.';
        return;
    }
    try {
        const response = await fetch(`${backendURL}/delete-account`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (response.ok) {
            localStorage.removeItem("authToken");
            document.getElementById('delete-feedback').textContent = 'Account deleted successfully. Redirecting...';
            setTimeout(() => window.location.href = "login.html", 2000);
        } else {
            document.getElementById('delete-feedback').textContent = data.message || 'Error deleting account';
        }
    } catch (error) {
        console.error("Fetch error:", error);
        document.getElementById('delete-feedback').textContent = 'Server error. Please try again later.';
    }
}

// Placeholder for Google Login/Signup
function googleLoginSignup() {
    document.getElementById('feedback').textContent = 'Google Login/Signup not implemented yet.';
    console.log("Google Login/Signup clicked - requires Firebase setup.");
}

// Fetch User Info (Updated for Dashboard)
async function fetchUserInfo() {
    const token = localStorage.getItem("authToken");
    if (!token) {
        document.getElementById('user-email').textContent = 'Not logged in.';
        document.getElementById('user-status').textContent = '';
        return;
    }
    document.getElementById('user-email').textContent = 'Loading...';
    document.getElementById('user-status').textContent = '';
    try {
        const response = await fetch(`${backendURL}/user`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
            const subscriptionStatus = data.isSubscribed ? 'Subscribed' : 'Not Subscribed';
            document.getElementById('user-email').textContent = `Email: ${data.email}`;
            document.getElementById('user-status').textContent = `Status: ${subscriptionStatus}`;
            document.getElementById('subscribe-btn').style.display = data.isSubscribed ? 'none' : 'inline-block';
            document.getElementById('access-spyconverterpro-btn').style.display = data.isSubscribed ? 'inline-block' : 'none';
        } else {
            document.getElementById('user-email').textContent = data.message || 'Failed to fetch user info';
            document.getElementById('user-status').textContent = '';
        }
    } catch (error) {
        console.error('Fetch user info error:', error);
        document.getElementById('user-email').textContent = 'Server error. Please try again.';
        document.getElementById('user-status').textContent = '';
    }
}

// Subscribe Function
async function subscribe() {
    const token = localStorage.getItem("authToken");
    if (!token) {
        document.getElementById('delete-feedback').textContent = 'You must be logged in to subscribe.';
        return;
    }
    try {
        const response = await fetch(`${backendURL}/subscribe`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (response.ok) {
            window.location.href = data.url; // Redirect to Stripe Checkout
        } else {
            document.getElementById('delete-feedback').textContent = data.message || 'Subscription failed';
        }
    } catch (error) {
        console.error('Subscribe error:', error);
        document.getElementById('delete-feedback').textContent = 'Server error. Please try again.';
    }
}
  
