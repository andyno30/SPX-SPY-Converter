const proBackendURL = "https://spx-spy-converter-pro.onrender.com/get_live_price_pro"; // Updated Render backend

let ratios = {}; // Stores fetched ratio values

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

        if (!data) {
            throw new Error("Invalid data format received from backend.");
        }

        ratios = {
            "SPX/SPY": data["SPX/SPY Ratio"],
            "ES/SPY": data["ES/SPY Ratio"],
            "NQ/QQQ": data["NQ/QQQ Ratio"],
            "NDX/QQQ": data["NDX/QQQ Ratio"],
            "ES/SPX": data["ES/SPX Ratio"]
        };

        document.getElementById("conversionDate").textContent = data.Datetime || "Unknown";

        // Update displayed ratios
        document.getElementById("ratio-spx-spy").textContent = ratios["SPX/SPY"] ? ratios["SPX/SPY"].toFixed(4) : "N/A";
        document.getElementById("ratio-es-spy").textContent = ratios["ES/SPY"] ? ratios["ES/SPY"].toFixed(4) : "N/A";
        document.getElementById("ratio-nq-qqq").textContent = ratios["NQ/QQQ"] ? ratios["NQ/QQQ"].toFixed(4) : "N/A";
        document.getElementById("ratio-ndx-qqq").textContent = ratios["NDX/QQQ"] ? ratios["NDX/QQQ"].toFixed(4) : "N/A";
        document.getElementById("ratio-es-spx").textContent = ratios["ES/SPX"] ? ratios["ES/SPX"].toFixed(4) : "N/A";

        // Update dropdown options based on valid conversions
        updateDropdownOptions();
    })
    .catch(error => {
        console.error('Error fetching premium data:', error);
        document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

// Function to limit dropdown options to valid ratio conversions
function updateDropdownOptions() {
    const fromDropdown = document.getElementById("from-ticker");
    const toDropdown = document.getElementById("to-ticker");

    const validConversions = {
        "SPX": ["SPY"],
        "SPY": ["SPX"],
        "ES": ["SPY", "SPX"],
        "SPX": ["ES"],
        "SPY": ["ES"],
        "NQ": ["QQQ"],
        "QQQ": ["NQ", "NDX"],
        "NDX": ["QQQ"]
    };

    // Get the selected 'from' ticker
    const fromValue = fromDropdown.value;
    toDropdown.innerHTML = '<option value="">To</option>'; // Reset 'to' options

    if (fromValue && validConversions[fromValue]) {
        validConversions[fromValue].forEach(ticker => {
            const option = document.createElement("option");
            option.value = ticker;
            option.textContent = ticker;
            toDropdown.appendChild(option);
        });
    }
}

// Event listener to update 'to' options when 'from' changes
document.getElementById("from-ticker").addEventListener("change", updateDropdownOptions);

// Function to convert values based on ratios
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
    if (ratios[ratioKey]) {
        convertedValue = value * ratios[ratioKey];
    } else if (ratios[inverseRatioKey]) {
        convertedValue = value / ratios[inverseRatioKey];
    } else {
        document.getElementById("convert-output").textContent = "Invalid conversion.";
        return;
    }

    document.getElementById("convert-output").textContent = `${toTicker}: ${convertedValue.toFixed(4)}`;
}

// Fetch ratios every 60 seconds
setInterval(updateProRatios, 60000);
updateProRatios();
