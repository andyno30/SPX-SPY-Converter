// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDj3dhuXBQP7V9SSKtwy_NOEOEu5EjQm0k",
  authDomain: "spyconverter-pro.firebaseapp.com",
  projectId: "spyconverter-pro",
  storageBucket: "spyconverter-pro.appspot.com",
  messagingSenderId: "291409539688",
  appId: "1:291409539688:web:b82d35e269af30af2c01dd"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
