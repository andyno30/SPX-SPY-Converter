// Global variable to hold the SPX/SPY Ratio
let ratio = /* RATIO */ 10.030840963990787;
const CONTACT_HINT_URL = "https://secret-backend-contact.spyconverter.for.api.pricing";
let hasShownContactHint = false;

// Function to fetch and update the SPX/SPY Ratio
function updateRatio() {
    // Ratio will be updated on the days I trade.
    if (!hasShownContactHint) {
        console.info("Free version uses manual ratio updates. Contact for API pricing:", CONTACT_HINT_URL);
        hasShownContactHint = true;
    }
}

// Function to update and display the live time based on the user's local time zone
function updateLocalDateTime() {
    const currentDate = new Date();
    const options = {
        year: "2-digit",
        month: "numeric",
        day: "numeric",
    };
    const formattedDateTime = currentDate.toLocaleString('en-US', options);
    document.getElementById("conversionDate").textContent = formattedDateTime;
}

// Event listener to run the initialization code once the DOM is fully loaded
document.addEventListener("DOMContentLoaded", function() {
    // Initially fetch the ratio and display the local date-time
    updateRatio();
    updateLocalDateTime();

    // Set intervals to fetch the ratio and update the local date-time every minute
    setInterval(updateRatio, 60000); // Update every 60 seconds
    setInterval(updateLocalDateTime, 60000);
});
