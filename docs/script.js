import {
    initializeApp
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  
  import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail,
    deleteUser,
    onAuthStateChanged
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  
  import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    deleteDoc
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  
  // 🔥 Firebase Config
  const firebaseConfig = {
    apiKey: "AIzaSyDj3dhuXBQP7V9SSKtwy_NOEOEu5EjQm0k",
    authDomain: "spyconverter-pro.firebaseapp.com",
    projectId: "spyconverter-pro",
    storageBucket: "spyconverter-pro.appspot.com",
    messagingSenderId: "291409539688",
    appId: "1:291409539688:web:b82d35e269af30af2c01dd",
    measurementId: "G-3V14LP5T08"
  };
  
  // 🔥 Initialize
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  
  // Expose for console/debug use
  window.auth = auth;
  window.db = db;
  
  /* ========================= LOGIN ========================= */
  export async function emailLogin() {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value;
    const feedback = document.getElementById('feedback');
    const loginStatus = document.getElementById('login-status');
  
    if (!email || !password) {
      feedback.textContent = 'Please enter both email and password.';
      return;
    }
  
    loginStatus.style.display = 'block';
    loginStatus.textContent = 'Connecting to the server, please wait...';
  
    try {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      const user = userCred.user;
  
      localStorage.setItem('authToken', user.accessToken);
      loginStatus.style.display = 'none';
      alert("Login successful!");
      window.location.href = "dashboard.html";
    } catch (err) {
      loginStatus.style.display = 'none';
      feedback.textContent = err.message;
      console.error(err);
    }
  }
  
  /* ========================= REGISTER ========================= */
  export async function registerUser() {
    const email = document.getElementById('email-input').value.trim();
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
  
    feedback.textContent = 'Registering...';
  
    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCred.user;
  
      const autoSubscribe = email === "andyno30@gmail.com";
  
      await setDoc(doc(db, "users", user.uid), {
        email,
        isSubscribed: autoSubscribe
      });
  
      alert("Signup successful! Redirecting...");
      window.location.href = "login.html";
    } catch (err) {
      feedback.textContent = err.message;
      console.error(err);
    }
  }
  
  /* ========================= FORGOT PASSWORD ========================= */
  export async function resetPassword() {
    const email = document.getElementById('email-input').value.trim();
    const feedback = document.getElementById('feedback');
  
    if (!email) {
      feedback.textContent = 'Please enter your email.';
      return;
    }
  
    try {
      await sendPasswordResetEmail(auth, email);
      feedback.textContent = 'Reset link sent to your email.';
    } catch (err) {
      feedback.textContent = err.message;
      console.error(err);
    }
  }
  
  /* ========================= GOOGLE LOGIN ========================= */
  export async function googleLoginSignup() {
    const provider = new GoogleAuthProvider();
    const feedback = document.getElementById('feedback');
  
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
  
      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);
  
      if (!docSnap.exists()) {
        await setDoc(docRef, {
          email: user.email,
          isSubscribed: user.email === "andyno30@gmail.com"
        });
      }
  
      localStorage.setItem("authToken", "firebase");
      alert("Google login successful!");
      window.location.href = "dashboard.html";
    } catch (err) {
      feedback.textContent = err.message;
      console.error(err);
    }
  }
  
  /* ========================= DASHBOARD USER INFO ========================= */
  export async function fetchUserInfo() {
    const user = auth.currentUser;
    const emailEl = document.getElementById("user-email");
    const statusEl = document.getElementById("user-status");
  
    if (!user) {
      emailEl.textContent = "Not logged in.";
      statusEl.textContent = "";
      return;
    }
  
    try {
      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);
  
      if (docSnap.exists()) {
        const data = docSnap.data();
        emailEl.textContent = `Email: ${data.email}`;
        statusEl.textContent = `Status: ${data.isSubscribed ? "Subscribed" : "Not Subscribed"}`;
        document.getElementById("subscribe-btn").style.display = data.isSubscribed ? "none" : "inline-block";
        document.getElementById("access-spyconverterpro-btn").style.display = data.isSubscribed ? "inline-block" : "none";
      } else {
        emailEl.textContent = "User data not found.";
        statusEl.textContent = "";
      }
    } catch (err) {
      console.error("Error loading user info:", err);
      emailEl.textContent = "Failed to load.";
      statusEl.textContent = "";
    }
  }
  
  /* ========================= STRIPE SUBSCRIBE ========================= */
  export async function subscribe(plan = "monthly") {
    const user = auth.currentUser;
    const feedback = document.getElementById("feedback");
  
    if (!user) {
      feedback.textContent = "You must be logged in.";
      return;
    }
  
    try {
      const res = await fetch("https://us-central1-spyconverter-pro.cloudfunctions.net/createStripeCheckout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: user.email,
          plan
        })
      });
  
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        feedback.textContent = data.message || "Failed to create Stripe session.";
      }
    } catch (err) {
      feedback.textContent = "Error subscribing.";
      console.error("Stripe error:", err);
    }
  }
  
  /* ========================= DELETE ACCOUNT ========================= */
  export async function deleteAccount() {
    const user = auth.currentUser;
    const feedback = document.getElementById("delete-feedback");
  
    if (!user) {
      feedback.textContent = "You must be logged in.";
      return;
    }
  
    try {
      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);
  
      const subscriptionId = docSnap.exists() ? docSnap.data().subscriptionId : null;
  
      if (subscriptionId) {
        await fetch("https://us-central1-spyconverter-pro.cloudfunctions.net/cancelStripeSubscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId })
        });
      }
  
      await deleteDoc(doc(db, "users", user.uid));
      await deleteUser(user);
      localStorage.removeItem("authToken");
  
      feedback.textContent = "Account deleted. Redirecting...";
      setTimeout(() => window.location.href = "login.html", 2000);
    } catch (err) {
      feedback.textContent = err.message;
      console.error(err);
    }
  }
  
  /* ========================= PROTECT PAGES ========================= */
  onAuthStateChanged(auth, (user) => {
    if (window.location.pathname.includes("dashboard.html")) {
      if (!user) {
        window.location.href = "login.html";
      }
    }
  });
  
  // Expose to window
  window.emailLogin = emailLogin;
  window.registerUser = registerUser;
  window.resetPassword = resetPassword;
  window.googleLoginSignup = googleLoginSignup;
  window.fetchUserInfo = fetchUserInfo;
  window.deleteAccount = deleteAccount;
  window.subscribe = subscribe;
  
