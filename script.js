// Function to fetch the ratio from the server
function fetchRatio() {
    // Replace 'https://your-server-url.com' with the actual URL of your Flask server
    fetch('https://your-server-url.com/get_live_price')
        .then(response => response.json())
        .then(data => {
            const ratio = data.ratio;
            document.getElementById("ratio").textContent = `Conversion ratio last updated: ${new Date().toLocaleDateString()} - SPX/SPY Ratio: ${ratio.toFixed(7)}`;
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
