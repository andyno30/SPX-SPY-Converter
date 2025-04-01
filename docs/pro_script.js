const proBackendURL = "https://spx-spy-converter-pro.onrender.com/get_live_price_pro"; // Updated Render backend

let prices = {};     // Holds the latest market prices
let lastPrices = {}; // Holds the last known valid prices
let ratios = {};     // Holds the latest conversion ratios

// Define valid conversion pairs
const validConversions = {
  "SPX": ["SPY", "ES"],
  "SPY": ["SPX", "ES"],
  "ES": ["SPY", "SPX"],
  "NQ": ["QQQ"],
  "QQQ": ["NQ", "NDX"],
  "NDX": ["QQQ"]
};

// Fetch live ratios and prices from the backend
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
      console.log("Received data:", data);
      if (!data || !data.Prices) {
        throw new Error("Invalid data format received from backend.");
      }

      // Store latest prices
      prices = data.Prices;

      // Update last known valid prices
      Object.keys(prices).forEach(ticker => {
        if (prices[ticker] !== null && prices[ticker] !== undefined) {
          lastPrices[ticker] = prices[ticker];
        }
      });

      // Store latest ratios
      ratios = {
        "SPX/SPY": data["SPX/SPY Ratio"],
        "ES/SPY": data["ES/SPY Ratio"],
        "NQ/QQQ": data["NQ/QQQ Ratio"],
        "NDX/QQQ": data["NDX/QQQ Ratio"],
        "ES/SPX": data["ES/SPX Ratio"]
      };

      // Convert server timestamp to user's local time
      let localDate;
      if (data.Datetime && data.Datetime !== "Unknown") {
        // Assuming format "MM/DD/YY HH:MM" like "04/01/25 23:46"
        const [datePart, timePart] = data.Datetime.split(' ');
        const [month, day, year] = datePart.split('/');
        const [hour, minute] = timePart.split(':');
        const serverDate = new Date(`20${year}-${month}-${day}T${hour}:${minute}:00`);
        localDate = serverDate.toLocaleString('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          hour12: true
        });
      } else {
        localDate = "Unknown";
      }
      document.getElementById("conversionDate").textContent = localDate;

      updateDropdownOptions();
    })
    .catch(error => {
      console.error('Error fetching premium data:', error);
      document.getElementById("conversionDate").textContent = "Failed to load data. Please try again later.";
    });
}

// Update the "To" dropdown based on the selected "From" ticker
function updateDropdownOptions() {
  const fromDropdown = document.getElementById("from-ticker");
  const toDropdown = document.getElementById("to-ticker");
  toDropdown.innerHTML = '<option value="">To</option>';
  const fromValue = fromDropdown.value;

  if (fromValue && validConversions[fromValue]) {
    validConversions[fromValue].forEach(optionValue => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue;
      toDropdown.appendChild(option);
    });
  }
}

document.getElementById("from-ticker").addEventListener("change", updateDropdownOptions);

// Conversion function using ratios
function convertPremium() {
  const fromTicker = document.getElementById("from-ticker").value;
  const toTicker = document.getElementById("to-ticker").value;
  const inputValue = parseFloat(document.getElementById("convert-input").value);

  if (!fromTicker || !toTicker || isNaN(inputValue)) {
    document.getElementById("convert-output").textContent = "Please select valid tickers and enter a value.";
    return;
  }

  const conversionMapping = {
    "SPX->SPY": (v) => v / ratios["SPX/SPY"],
    "SPY->SPX": (v) => v * ratios["SPX/SPY"],
    "ES->SPY":  (v) => v / ratios["ES/SPY"],
    "SPY->ES":  (v) => v * ratios["ES/SPY"],
    "ES->SPX":  (v) => v / ratios["ES/SPX"],
    "SPX->ES":  (v) => v * ratios["ES/SPX"],
    "QQQ->NQ":  (v) => v * ratios["NQ/QQQ"],
    "NQ->QQQ":  (v) => v / ratios["NQ/QQQ"],
    "QQQ->NDX": (v) => v * ratios["NDX/QQQ"],
    "NDX->QQQ": (v) => v / ratios["NDX/QQQ"]
  };

  const key = `${fromTicker}->${toTicker}`;
  const conversionFunction = conversionMapping[key];

  if (!conversionFunction || conversionFunction(inputValue) === undefined) {
    document.getElementById("convert-output").textContent = "Invalid conversion.";
    return;
  }

  const convertedValue = conversionFunction(inputValue);
  document.getElementById("convert-output").textContent = `${toTicker}: ${convertedValue.toFixed(8)}`;
}

// Update displayed ratios on the UI
function updateRatioDisplay() {
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
      element.textContent = (ratios[key] !== undefined && ratios[key] !== null)
        ? ratios[key].toFixed(8)
        : "N/A";
    }
  });
}

// Update displayed prices on the UI (Future Use)
function updatePriceDisplay() {
  const priceMapping = {
    "SPX": "price-spx",
    "SPY": "price-spy",
    "ES": "price-es",
    "NQ": "price-nq",
    "QQQ": "price-qqq",
    "NDX": "price-ndx"
  };

  Object.keys(priceMapping).forEach(ticker => {
    const element = document.getElementById(priceMapping[ticker]);
    if (element) {
      element.textContent = (prices[ticker] !== undefined && prices[ticker] !== null)
        ? `$${prices[ticker].toFixed(2)}`
        : (lastPrices[ticker] !== undefined ? `$${lastPrices[ticker].toFixed(2)}` : "N/A");
    }
  });
}

// Automatically update the UI every second
setInterval(updateRatioDisplay, 1000);
setInterval(updatePriceDisplay, 1000);

// Fetch new data every 60 seconds
setInterval(updateProRatios, 60000);
updateProRatios();
