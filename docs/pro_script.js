const proBackendURL = "https://spx-spy-converter-pro.onrender.com/get_live_price_pro"; // Updated Render backend

let prices = {};
let lastPrices = {}; // Stores last known valid prices
let ratios = {};

// Fetch and update the live ratios from the backend
function updateProRatios() {
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

        if (!data || !data.Prices) {
            throw new Error("Invalid data format received from backend.");
        }

        // Update prices from the backend JSON (which now comes under "Prices")
        prices = data.Prices;

        // Update last known valid prices
        Object.keys(prices).forEach(ticker => {
            if (prices[ticker] !== null && prices[ticker] !== undefined) {
                lastPrices[ticker] = prices[ticker];
            }
        });

        // Set the ratios directly from data
        ratios = {
            "SPX/SPY": data["SPX/SPY Ratio"],
            "ES/SPY": data["ES/SPY Ratio"],
            "NQ/QQQ": data["NQ/QQQ Ratio"],
            "NDX/QQQ": data["NDX/QQQ Ratio"],
            "ES/SPX": data["ES/SPX Ratio"]
        };

        document.getElementById("conversionDate").textContent = data.Datetime || "Unknown";

        // Update dropdown options based on valid conversions
        updateDropdownOptions();
    })
    .catch(error => {
        console.error('Error fetching premium data:', error);
        document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

// Function to update dropdown options based on selected "From" ticker
function updateDropdownOptions() {
    const fromDropdown = document.getElementById("from-ticker");
    const toDropdown = document.getElementById("to-ticker");

    // Define valid conversion pairs.
    // This ensures that for "SPX" only "SPY" is allowed and vice versa.
    const validConversions = {
        "SPX": ["SPY"],
        "SPY": ["SPX"],
        "ES": ["SPY", "SPX"],
        "NQ": ["QQQ"],
        "QQQ": ["NQ", "NDX"],
        "NDX": ["QQQ"]
    };

    const fromValue = fromDropdown.value;
    toDropdown.innerHTML = '<option value="">To</option>'; // Reset 'to' dropdown

    if (fromValue && validConversions[fromValue]) {
        validConversions[fromValue].forEach(ticker => {
            const option = document.createElement("option");
            option.value = ticker;
            option.textContent = ticker;
            toDropdown.appendChild(option);
        });
    }
}

// Function to update displayed ratios on the UI
function updateRatioDisplay() {
    // We assume the ratios are keyed as follows:
    // "SPX/SPY", "ES/SPY", "NQ/QQQ", "NDX/QQQ", "ES/SPX"
    const ratioMapping = {
        "SPX/SPY": "ratio-spx-spy",
        "ES/SPY": "ratio-es-spy",
        "NQ/QQQ": "ratio-nq-qqq",
        "NDX/QQQ": "ratio-ndx-qqq",
        "ES/SPX": "ratio-es-spx"
    };

    Object.keys(ratioMapping).forEach(key => {
        const element = document.getElementById(ratioMapping[key]);
        if (element) {
            element.textContent = ratios[key] !== undefined && ratios[key] !== null 
                ? ratios[key].toFixed(8)
                : "N/A";
        }
    });
}

// Conversion function based on ratios
function convertPremium() {
    const fromTicker = document.getElementById("from-ticker").value;
    const toTicker = document.getElementById("to-ticker").value;
    const value = parseFloat(document.getElementById("convert-input").value);

    if (!fromTicker || !toTicker || isNaN(value)) {
        document.getElementById("convert-output").textContent = "Please select tickers and enter a value.";
        return;
    }

    const ratioKey = `${fromTicker}/${toTicker}`;
    const inverseRatioKey = `${toTicker}/${fromTicker}`;
    let convertedValue;

    if (ratios[ratioKey] !== undefined && ratios[ratioKey] !== null) {
        convertedValue = value * ratios[ratioKey];
    } else if (ratios[inverseRatioKey] !== undefined && ratios[inverseRatioKey] !== null) {
        convertedValue = value / ratios[inverseRatioKey];
    } else {
        document.getElementById("convert-output").textContent = "Invalid conversion.";
        return;
    }

    document.getElementById("convert-output").textContent = `${toTicker}: ${convertedValue.toFixed(8)}`;
}

// Fetch ratios every 60 seconds
setInterval(updateProRatios, 60000);
updateProRatios();

// Update ratio display every second
setInterval(updateRatioDisplay, 1000);
