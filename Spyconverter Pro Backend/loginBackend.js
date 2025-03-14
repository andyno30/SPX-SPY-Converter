// Import required modules
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const stripe = require('stripe')('sk_test_51MqL3m2mY7zktgIWmVU2SOayxmR8mzB4jkGU7NDeURDufBlBAq2McwNsCw9tYltg83BguEX888A3XTk5JH7uRtPN00I8c1joeC'); 

// Initialize the Express app
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors()); // Allows frontend to communicate with backend

// MongoDB connection
mongoose.connect('mongodb+srv://andyno30:jmRH2kOt84mHP5KY@spyconverterpro.a8m8g.mongodb.net/spyconverterDB?retryWrites=true&w=majority&appName=spyconverterpro', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.log("Error connecting to MongoDB:", err));

// Create a user schema
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isSubscribed: { type: Boolean, default: false }
});

// Create a user model
const User = mongoose.model('User', userSchema);

// Test Route (to check if server is running)
app.get("/", (req, res) => {
    res.send("Server is running successfully!");
});

// Registration endpoint
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received Registration Attempt: Email: ${email}, Password: ${password}`); // Log to terminal

    try {
        // Check if the user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save the new user to the database
        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();

        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received Login Attempt: Email: ${email}, Password: ${password}`); // Log to terminal

    try {
        // Find the user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        // Check the password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Generate a JWT token
        const token = jwt.sign({ userId: user._id }, 'your-secret-key', { expiresIn: '1h' });

        res.json({ message: 'Login successful', token, isSubscribed: user.isSubscribed });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Stripe Subscription Endpoint
app.post('/subscribe', async (req, res) => {
    const { token, userId } = req.body;
    
    try {
        // Create a customer in Stripe
        const customer = await stripe.customers.create({
            email: 'user-email@example.com', // Replace with actual user email
            source: token,
        });

        // Create a subscription
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: 'your-stripe-price-id' }], // Replace with your Stripe price ID
            metadata: { userId } // Store user ID for webhook processing
        });

        // Respond with subscription confirmation
        res.json({ message: 'Subscription successful', subscriptionId: subscription.id });
    } catch (error) {
        console.error('Stripe Subscription Error:', error);
        res.status(500).json({ message: 'Subscription failed' });
    }
});

// Stripe Webhook Endpoint
const endpointSecret = 'whsec_H5LbI8hNHaySrYiSxgcRwFDRoeFGIzpS'; 

app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    console.log('Webhook received, processing...');

    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log(`Webhook event type: ${event.type}`);

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('Session Data:', session); // Debugging output

            const userId = session.metadata?.userId;
            console.log(`Processing checkout.session.completed for userId: ${userId}`);

            if (userId) {
                const user = await User.findByIdAndUpdate(userId, { isSubscribed: true }, { new: true });
                console.log(`User ${userId} subscribed successfully, updated: ${user?.isSubscribed}`);
            } else {
                console.log('User ID is missing in session metadata.');
            }
        }

        res.status(200).send('Webhook received');
    } catch (error) {
        console.log("Webhook error:", error.message);
        res.status(400).send(`Webhook Error: ${error.message}`);
    }
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
