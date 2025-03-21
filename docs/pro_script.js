const proBackendURL = "https://spx-spy-converter-pro.onrender.com/get_live_price_pro"; // Updated Render backend

let prices = {};
let ratios = {};

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

        if (!data || !data.prices || !data.ratios) {
            throw new Error("Invalid data format received from backend.");
        }

        prices = data.prices;
        ratios = data.ratios;
        document.getElementById("conversionDate").textContent = data.datetime || "Unknown";
    })
    .catch(error => {
        console.error('Error fetching premium data:', error);
        document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

setInterval(updateProPrices, 60000);
updateProPrices();

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

function updatePriceDisplay() {
    const tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"];
    
    tickers.forEach(ticker => {
        const priceElement = document.getElementById(`price-${ticker.toLowerCase().replace(/[^a-z]/g, "")}`);
        if (priceElement) {
            priceElement.textContent = prices[ticker] ? `$${prices[ticker].toFixed(2)}` : "N/A";
        }
    });
}

setInterval(updatePriceDisplay, 1000);
