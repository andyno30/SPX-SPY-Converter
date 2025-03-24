const proBackendURL = "https://spx-spy-converter-pro.onrender.com/get_live_price_pro";

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
        console.log("Received data:", data);

        if (!data || !data.Prices) {  // Correcting the reference
            throw new Error("Invalid data format received from backend.");
        }

        prices = data.Prices;  // Updating prices
        ratios = {
            "SPX/SPY Ratio": data["SPX/SPY Ratio"],
            "ES/SPY Ratio": data["ES/SPY Ratio"],
            "NQ/QQQ Ratio": data["NQ/QQQ Ratio"],
            "NDX/QQQ Ratio": data["NDX/QQQ Ratio"],
            "ES/SPX Ratio": data["ES/SPX Ratio"]
        };

        document.getElementById("conversionDate").textContent = data.Datetime || "Unknown";
        updatePriceDisplay();  // Ensure UI updates
    })
    .catch(error => {
        console.error('Error fetching premium data:', error);
        document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

// Update prices every 60 seconds
setInterval(updateProPrices, 60000);
updateProPrices();

// Function to display real-time prices on the UI
function updatePriceDisplay() {
    const tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"];

    tickers.forEach(ticker => {
        const priceElement = document.getElementById(`price-${ticker.toLowerCase().replace(/[^a-z]/g, "")}`);
        if (priceElement) {
            priceElement.textContent = prices[ticker] ? `$${prices[ticker].toFixed(2)}` : "N/A";
        }
    });
}

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

setInterval(updatePriceDisplay, 1000);
