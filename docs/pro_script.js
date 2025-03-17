const proBackendURL = "https://spx-spy-converter.onrender.com/get_live_price_pro"; // Updated to Render backend

let prices = {};
let ratios = {};

// Function to fetch and update the live prices
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
        console.log("Received data:", data); // Debugging output

        if (!data.prices || !data.ratios) {
            throw new Error("Invalid data format received from backend.");
        }

        prices = data.prices;
        ratios = data.ratios;
        document.getElementById("conversionDate").textContent = data.datetime;
    })
    .catch(error => {
        console.error('Error fetching premium data:', error);
        document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

// Update prices every 60 seconds
setInterval(updateProPrices, 60000);
updateProPrices();

// Function to convert values based on market data
function convertPremium() {
    const fromTicker = document.getElementById("from-ticker").value;
    const toTicker = document.getElementById("to-ticker").value;
    const value = parseFloat(document.getElementById("convert-input").value);

    if (!fromTicker || !toTicker || isNaN(value)) {
        document.getElementById("convert-output").textContent = "Please select tickers and enter a value.";
        return;
    }

    if (!prices[fromTicker] || !prices[toTicker]) {
        document.getElementById("convert-output").textContent = "Prices are still loading. Please wait a moment.";
        return;
    }

    const convertedValue = (prices[toTicker] / prices[fromTicker]) * value;
    const tickerNames = {
        "^SPX": "SPX",
        "SPY": "SPY",
        "ES=F": "ES",
        "NQ=F": "NQ",
        "QQQ": "QQQ",
        "^NDX": "NDX"
    };
    const displayName = tickerNames[toTicker] || toTicker;
    document.getElementById("convert-output").textContent = `${displayName}: ${convertedValue.toFixed(2)}`;
}

// Function to display real-time prices on the UI
setInterval(() => {
    if (Object.keys(prices).length > 0) {
        document.getElementById("price-spx").textContent = prices["^SPX"] ? prices["^SPX"].toFixed(2) : "N/A";
        document.getElementById("price-spy").textContent = prices["SPY"] ? prices["SPY"].toFixed(2) : "N/A";
        document.getElementById("price-es").textContent = prices["ES=F"] ? prices["ES=F"].toFixed(2) : "N/A";
        document.getElementById("price-nq").textContent = prices["NQ=F"] ? prices["NQ=F"].toFixed(2) : "N/A";
        document.getElementById("price-qqq").textContent = prices["QQQ"] ? prices["QQQ"].toFixed(2) : "N/A";
        document.getElementById("price-ndx").textContent = prices["^NDX"] ? prices["^NDX"].toFixed(2) : "N/A";
    }
}, 1000);
