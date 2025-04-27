const functions = require("firebase-functions");
const backend = require("./loginBackend");

exports.createStripeCheckout = backend.createStripeCheckout;
exports.handleStripeWebhook = backend.handleStripeWebhook;
exports.cancelStripeSubscription = backend.cancelStripeSubscription;
