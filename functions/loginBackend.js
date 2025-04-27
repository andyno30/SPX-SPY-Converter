const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Initialize Admin SDK
admin.initializeApp();

// Price IDs
const PRICE_IDS = {
  monthly: "price_1R8cFp2mY7zktgIWDmDVEhZA",
  six_months: "price_1R8cFp2mY7zktgIWS8YzDrb7",
};

/**
 * Create Stripe Checkout
 */
exports.createStripeCheckout = onRequest({ secrets: ["STRIPE_SECRET_KEY"] }, async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

  // Log request details for debugging
  logger.info("Received createStripeCheckout request", { method: req.method, body: req.body });

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Missing or invalid authorization header");
    return res.status(401).json({ message: "Unauthorized" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  let decodedToken;
  try {
    logger.info("Verifying ID token");
    decodedToken = await admin.auth().verifyIdToken(idToken);
    logger.info("Token verified for user", { uid: decodedToken.uid });
  } catch (err) {
    logger.error("Token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid token", error: err.message });
  }

  try {
    const { email, plan } = req.body;
    if (!email || !PRICE_IDS[plan]) {
      logger.warn("Invalid request body", { email, plan });
      return res.status(400).json({ message: "Missing email or invalid plan" });
    }

    logger.info("Creating Stripe Checkout session", { email, plan });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: "https://spyconverter.com/docs/dashboard.html?success=true",
      cancel_url: "https://spyconverter.com/docs/dashboard.html?cancel=true",
      metadata: { email },
      customer_email: email, // Pre-fill email in Stripe Checkout
    });

    logger.info(`Checkout session created for ${email}`, { sessionId: session.id });
    res.json({ url: session.url });
  } catch (error) {
    logger.error("Stripe Checkout Error:", { message: error.message, stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/**
 * Stripe Webhook Handler
 */
exports.handleStripeWebhook = onRequest({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] }, async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    logger.info("Processing Stripe webhook");
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    logger.info("Webhook event verified", { type: event.type, id: event.id });
  } catch (err) {
    logger.error("Webhook signature error:", { message: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.metadata?.email;

    if (email) {
      logger.info("Handling checkout.session.completed", { email, subscriptionId: session.subscription });
      const userSnap = await admin.firestore().collection("users").where("email", "==", email).limit(1).get();
      if (!userSnap.empty) {
        await userSnap.docs[0].ref.update({
          isSubscribed: true,
          subscriptionId: session.subscription,
        });
        logger.info(`User ${email} marked as subscribed`);
      } else {
        logger.warn(`No user found with email ${email}`);
      }
    } else {
      logger.warn("No email in session metadata");
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subscriptionId = event.data.object.id;
    logger.info("Handling customer.subscription.deleted", { subscriptionId });

    const userSnap = await admin.firestore().collection("users").where("subscriptionId", "==", subscriptionId).limit(1).get();
    if (!userSnap.empty) {
      await userSnap.docs[0].ref.update({ isSubscribed: false });
      logger.info(`Subscription ${subscriptionId} marked as canceled`);
    } else {
      logger.warn(`No user found with subscriptionId ${subscriptionId}`);
    }
  }

  res.status(200).send("Webhook processed");
});

/**
 * Cancel Stripe Subscription
 */
exports.cancelStripeSubscription = onRequest({ secrets: ["STRIPE_SECRET_KEY"] }, async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Missing or invalid authorization header");
    return res.status(401).json({ message: "Unauthorized" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    logger.info("Verifying ID token for cancellation");
    await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    logger.error("Token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid token", error: err.message });
  }

  const { subscriptionId } = req.body;
  if (!subscriptionId) {
    logger.warn("Missing subscriptionId");
    return res.status(400).json({ message: "Missing subscriptionId" });
  }

  try {
    logger.info("Canceling subscription", { subscriptionId });
    const canceled = await stripe.subscriptions.cancel(subscriptionId);
    const userSnap = await admin.firestore().collection("users").where("subscriptionId", "==", subscriptionId).limit(1).get();
    if (!userSnap.empty) {
      await userSnap.docs[0].ref.update({ isSubscribed: false });
      logger.info(`Subscription ${subscriptionId} canceled and updated`);
    } else {
      logger.warn(`No user found with subscriptionId ${subscriptionId}`);
    }
    res.json({ message: "Subscription canceled successfully", status: canceled.status });
  } catch (error) {
    logger.error("Cancel subscription error:", { message: error.message, stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});
