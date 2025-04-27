const functions = require("firebase-functions");
const loginBackend = require("./loginBackend");

exports.createStripeCheckout = functions.https.onRequest(loginBackend.createStripeCheckout);
exports.handleStripeWebhook = functions.https.onRequest(loginBackend.handleStripeWebhook);
