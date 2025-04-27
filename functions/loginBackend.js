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
 * ✅ Create Stripe Checkout
 */
exports.createStripeCheckout = onRequest({ secrets: ["STRIPE_SECRET_KEY"] }, async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const { email, plan } = req.body;
    if (!email || !PRICE_IDS[plan]) {
      return res.status(400).json({ message: "Missing email or invalid plan" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: "https://spyconverter.com/docs/dashboard.html?success=true",
      cancel_url: "https://spyconverter.com/docs/dashboard.html?cancel=true",
      metadata: { email }
    });

    logger.info(`Checkout created for ${email}`);
    res.json({ url: session.url });
  } catch (error) {
    logger.error("Stripe Checkout Error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

/**
 * ✅ Stripe Webhook Handler
 */
exports.handleStripeWebhook = onRequest({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] }, async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    logger.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.metadata?.email;

    if (email) {
      const userSnap = await admin.firestore().collection("users").where("email", "==", email).limit(1).get();
      if (!userSnap.empty) {
        await userSnap.docs[0].ref.update({
          isSubscribed: true,
          subscriptionId: session.subscription,
        });
        logger.info(`User ${email} marked as subscribed.`);
      }
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subscriptionId = event.data.object.id;

    const userSnap = await admin.firestore().collection("users").where("subscriptionId", "==", subscriptionId).limit(1).get();
    if (!userSnap.empty) {
      await userSnap.docs[0].ref.update({ isSubscribed: false });
      logger.info(`Subscription ${subscriptionId} marked as canceled.`);
    }
  }

  res.status(200).send("Webhook processed");
});

/**
 * ✅ Cancel Stripe Subscription
 */
exports.cancelStripeSubscription = onRequest({ secrets: ["STRIPE_SECRET_KEY"] }, async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const { subscriptionId } = req.body;
  if (!subscriptionId) {
    return res.status(400).json({ message: "Missing subscriptionId" });
  }

  try {
    const canceled = await stripe.subscriptions.cancel(subscriptionId);
    const userSnap = await admin.firestore().collection("users").where("subscriptionId", "==", subscriptionId).limit(1).get();
    if (!userSnap.empty) {
      await userSnap.docs[0].ref.update({ isSubscribed: false });
      logger.info(`Subscription ${subscriptionId} canceled and updated.`);
    }
    res.json({ message: "Subscription canceled successfully", status: canceled.status });
  } catch (error) {
    logger.error("Cancel subscription error:", error.message);
    res.status(500).json({ message: error.message });
  }
});
