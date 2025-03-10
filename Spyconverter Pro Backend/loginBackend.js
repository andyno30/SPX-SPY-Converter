const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());

// MongoDB connection
mongoose.connect('mongodb+srv://andyno30:jmRH2kOt84mHP5KY@spyconverterpro.a8m8g.mongodb.net/spyconverterDB?retryWrites=true&w=majority&appName=spyconverterpro')
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.log("Error connecting to MongoDB:", err));

// User schema
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isSubscribed: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        console.log("No token provided in request");
        return res.status(401).json({ message: 'No token provided' });
    }
    jwt.verify(token, 'your-secret-key', (err, user) => {
        if (err) {
            console.log("Token verification failed:", err.message);
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        console.log("Token verified, user:", user);
        next();
    });
};

// Test Route
app.get("/", (req, res) => {
    res.send("Server is running successfully!");
});

// Registration endpoint
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received Registration Attempt: Email: ${email}, Password: ${password}`);
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.log("Registration error:", error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received Login Attempt: Email: ${email}, Password: ${password}`);
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user._id }, 'your-secret-key', { expiresIn: '1h' });
        res.json({ message: 'Login successful', token });
    } catch (error) {
        console.log("Login error:", error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Delete account endpoint
app.delete('/delete-account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log("Attempting to delete user with ID:", userId);
        const user = await User.findByIdAndDelete(userId);
        if (!user) {
            console.log("User not found for ID:", userId);
            return res.status(404).json({ message: 'User not found' });
        }
        console.log("User deleted successfully:", user.email);
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.log("Delete account error:", error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// New User Info endpoint
app.get('/user', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            console.log("User not found for ID:", req.user.userId);
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ email: user.email, isSubscribed: user.isSubscribed });
    } catch (error) {
        console.log("User fetch error:", error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
