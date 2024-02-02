// Global variable to hold the SPX/SPY Ratio
let ratio = 10.019718052813403; // Initial value, will be updated

// Function to fetch and update the SPX/SPY Ratio
function updateRatio() {
    fetch('https://utility-trees-399601.wl.r.appspot.com')
    .then(response => response.json())
    .then(data => {
        ratio = data["SPX/SPY Ratio"];
        console.log("Updated ratio:", ratio);  // Debugging output
    })
    .catch(error => {
        console.error('Error fetching the data:', error);
    });
}

// Function to update and display the live time based on the user's local time zone
function updateLocalDateTime() {
    const currentDate = new Date();
    const options = {
        year: "2-digit",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
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

