// Function to fetch the ratio and last updated date from the server
function fetchRatio() {
    fetch('/get_live_price')
        .then(response => response.json())
        .then(data => {
            const ratio = data.ratio;
            const lastUpdated = data.last_updated;
            
            // Update the HTML elements with the fetched data
            document.getElementById("ratio").textContent = `Conversion ratio last updated: ${lastUpdated} - SPX/SPY Ratio: ${ratio.toFixed(7)}`;
        })
        .catch(error => {
            console.error('Error fetching ratio:', error);
        });
}

// Initial fetch of the ratio when the page loads
fetchRatio();

// Function to convert SPX to SPY
function convertSpxToSpy() {
    const spxValue = parseFloat(document.getElementById("spxInput").value);
    const ratio = parseFloat(document.getElementById("ratio").textContent.split(":")[1].trim());
    const spyValue = (spxValue / ratio).toFixed(2);
    document.getElementById("spxToSpyOutput").innerText = `SPY Value: ${spyValue}`;
}

// Function to convert SPY to SPX
function convertSpyToSpx() {
    const spyValue = parseFloat(document.getElementById("spyInput").value);
    const ratio = parseFloat(document.getElementById("ratio").textContent.split(":")[1].trim());
    const spxValue = (spyValue * ratio).toFixed(2);
    document.getElementById("spyToSpxOutput").innerText = `SPX Value: ${spxValue}`;
}

// Add an event listener to the conversion button
document.getElementById("convertButton").addEventListener("click", function () {
    // Call the appropriate conversion function based on user input
    const conversionType = document.querySelector('input[name="conversionType"]:checked').value;
    if (conversionType === "spxToSpy") {
        convertSpxToSpy();
    } else if (conversionType === "spyToSpx") {
        convertSpyToSpx();
    }
});


