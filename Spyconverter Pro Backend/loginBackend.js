const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Enable CORS for all routes
app.use(cors());

// Webhook route - Must come BEFORE bodyParser.json() to receive raw body
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    console.log('Webhook received, processing...');
    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log(`Webhook event type: ${event.type}`);
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const userId = session.metadata?.userId;
            console.log(`Processing checkout.session.completed - Session ID: ${session.id}, User ID from metadata: ${userId}`);

            if (!userId) {
                console.error('No userId found in session metadata');
                return res.status(400).send('Webhook Error: Missing userId in metadata');
            }

            const user = await User.findByIdAndUpdate(
                userId,
                { isSubscribed: true, subscriptionId: session.subscription }, // Store subscription ID
                { new: true }
            );

            if (user) {
                console.log(`User ${userId} subscribed successfully - Updated isSubscribed: ${user.isSubscribed}, Subscription ID: ${user.subscriptionId}`);
            } else {
                console.error(`User not found for userId: ${userId}`);
            }
        }
        res.status(200).send('Webhook received');
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.status(400).send(`Webhook Error: ${error.message}`);
    }
});

// Apply JSON body parser for all other routes AFTER webhook
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://andyno30:jmRH2kOt84mHP5KY@spyconverterpro.a8m8g.mongodb.net/spyconverterDB?retryWrites=true&w=majority&appName=spyconverterpro')
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Error connecting to MongoDB:', err));

// Define User schema and model
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isSubscribed: { type: Boolean, default: false },
    subscriptionId: { type: String, default: null } // Added to store Stripe subscription ID
});
const User = mongoose.model('User', userSchema);

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

// Test Route
app.get('/', (req, res) => res.send('Server is running successfully!'));

// Registration endpoint
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received Registration Attempt: Email: "${email}"`);
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const normalizedEmail = email.toLowerCase().trim();
        const isSubscribed = normalizedEmail === 'andyno30@gmail.com';
        console.log(`Normalized Email: "${normalizedEmail}", Should Subscribe: ${isSubscribed}`);
        const newUser = new User({ email, password: hashedPassword, isSubscribed });
        await newUser.save();
        console.log(`User registered: ${email}, Subscribed: ${isSubscribed}`);
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Registration error:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'User not found' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '1h' });
        res.json({ message: 'Login successful', token, isSubscribed: user.isSubscribed });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Delete account endpoint
app.delete('/delete-account', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Cancel Stripe subscription if it exists
        if (user.isSubscribed && user.subscriptionId) {
            try {
                await stripe.subscriptions.del(user.subscriptionId);
                console.log(`Subscription ${user.subscriptionId} canceled successfully for user ${user.email}`);
            } catch (stripeError) {
                console.error('Stripe error during cancellation:', stripeError.message);
                return res.status(500).json({ message: 'Failed to cancel subscription', error: stripeError.message });
            }
        }

        // Delete user from database
        await User.findByIdAndDelete(req.user.userId);
        res.json({ message: 'Account and subscription deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// User Info endpoint
app.get('/user', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ email: user.email, isSubscribed: user.isSubscribed });
    } catch (error) {
        console.error('User fetch error:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Define Price IDs for subscription plans
const PRICE_IDS = {
    monthly: 'price_1R8cFp2mY7zktgIWDmDVEhZA',   // $4 per month
    six_months: 'price_1R8cFp2mY7zktgIWS8YzDrb7' // $18 every 6 months
};

// Subscribe endpoint (Stripe Checkout)
app.post('/subscribe', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.isSubscribed) return res.status(400).json({ message: 'Already subscribed' });

        const plan = req.body.plan;
        if (!plan || !PRICE_IDS[plan]) return res.status(400).json({ message: 'Invalid plan' });

        console.log(`Attempting Stripe session for ${user.email} with plan ${plan}`);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: PRICE_IDS[plan],
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: 'https://spyconverter.com/docs/dashboard.html?success=true',
            cancel_url: 'https://spyconverter.com/docs/dashboard.html?cancel=true',
            metadata: { userId: req.user.userId.toString() },
        });

        console.log(`Stripe session created for ${user.email}: ${session.url}, UserID: ${req.user.userId}`);
        res.json({ url: session.url });
    } catch (error) {
        console.error('Subscribe error:', error.message);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
