const proBackendURL = "https://spx-spy-converter-pro.onrender.com/get_live_price_pro"; // Updated Render backend

let prices = {};
let lastPrices = {};  // Stores the last known price for each ticker

function updateProPrices() {
    document.getElementById("conversionDate").textContent = "Loading...";

    fetch(proBackendURL)
    .then(response => {
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log("Received data:", data);

        if (!data || !data.prices) {
            throw new Error("Invalid data format received from backend.");
        }

        // Store the latest fetched prices
        prices = data.prices;

        // Update last known valid prices for each ticker
        Object.keys(prices).forEach(ticker => {
            if (prices[ticker] !== null && prices[ticker] !== undefined) {
                lastPrices[ticker] = prices[ticker];  // Store valid price
            }
        });

        document.getElementById("conversionDate").textContent = data.datetime || "Unknown";
    })
    .catch(error => {
        console.error('Error fetching premium data:', error);
        document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

// Function to display prices on the UI
function updatePriceDisplay() {
    const tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"];

    tickers.forEach(ticker => {
        const priceElement = document.getElementById(`price-${ticker.toLowerCase().replace(/[^a-z]/g, "")}`);
        if (priceElement) {
            if (prices[ticker] !== undefined && prices[ticker] !== null) {
                lastPrices[ticker] = prices[ticker];  // Store latest valid price
                priceElement.textContent = `$${prices[ticker].toFixed(2)}`;
            } else if (lastPrices[ticker] !== undefined) {
                priceElement.textContent = `$${lastPrices[ticker].toFixed(2)}`;  // Use last known price
            } else {
                priceElement.textContent = "N/A";  // No last price available
            }
        }
    });
}

// Fetch prices every 60 seconds
setInterval(updateProPrices, 60000);
updateProPrices();

// Update displayed prices every second
setInterval(updatePriceDisplay, 1000);
