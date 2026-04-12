const proBackendURL = "https://isvzhpqrmjtqnqyyidxr.functions.supabase.co/get-live-price-pro";

let prices = {};
let lastPrices = {};
let ratios = {};
let lastValidDate = "Unknown";

const validConversions = {
  "DJI": ["DIA", "YM"],
  "DIA": ["DJI", "YM"],
  "YM": ["DIA", "DJI"],
  "RUT": ["IWM", "RTY"],
  "IWM": ["RUT", "RTY"],
  "RTY": ["IWM", "RUT"]
};

const CACHE_KEY = "liveRatiosDowRussell";
const CACHE_EXPIRATION = 1 * 60 * 1000;

const safeDiv = (a, b) =>
  typeof a === "number" && typeof b === "number" && b !== 0 ? a / b : null;

function getCachedData() {
  const cachedData = localStorage.getItem(CACHE_KEY);
  if (!cachedData) return null;

  const parsed = JSON.parse(cachedData);
  const now = Date.now();
  if (now - parsed.timestamp < CACHE_EXPIRATION) {
    return parsed.ratios;
  }
  return null;
}

function setCachedData(nextRatios) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ ratios: nextRatios, timestamp: Date.now() })
  );
}

function updateDowRussellRatios() {
  document.getElementById("conversionDate").textContent = "Loading...";

  const cachedRatios = getCachedData();
  if (cachedRatios) {
    ratios = cachedRatios;
    updateRatioDisplay();
    updatePriceDisplay();
    document.getElementById("conversionDate").textContent = lastValidDate;
  }

  fetch(proBackendURL)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (!data || !data.Prices) {
        throw new Error("Invalid data format received from backend.");
      }

      prices = data.Prices;

      Object.keys(prices).forEach(ticker => {
        if (prices[ticker] !== null && prices[ticker] !== undefined) {
          lastPrices[ticker] = prices[ticker];
        }
      });

      ratios = {
        "DJI/DIA": safeDiv(prices.DJI, prices.DIA),
        "YM/DIA": safeDiv(prices.YM, prices.DIA),
        "YM/DJI": safeDiv(prices.YM, prices.DJI),
        "RUT/IWM": safeDiv(prices.RUT, prices.IWM),
        "RTY/IWM": safeDiv(prices.RTY, prices.IWM),
        "RTY/RUT": safeDiv(prices.RTY, prices.RUT)
      };

      if (data.Datetime) {
        const serverDateUTC = new Date(data.Datetime);
        lastValidDate = serverDateUTC.toLocaleString("en-US", {
          month: "numeric",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        });
      }
      document.getElementById("conversionDate").textContent = lastValidDate;

      setCachedData(ratios);
      updateDropdownOptions();
    })
    .catch(error => {
      console.error("Error fetching Dow/Russell data:", error);
      document.getElementById("conversionDate").textContent = lastValidDate;
    });
}

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

function convertDowRussell() {
  const fromTicker = document.getElementById("from-ticker").value;
  const toTicker = document.getElementById("to-ticker").value;
  const inputValue = parseFloat(document.getElementById("convert-input").value);

  if (!fromTicker || !toTicker || isNaN(inputValue)) {
    document.getElementById("convert-output").textContent =
      "Please select valid tickers and enter a value.";
    return;
  }

  const conversionMapping = {
    "DJI->DIA": (v) => v / ratios["DJI/DIA"],
    "DIA->DJI": (v) => v * ratios["DJI/DIA"],
    "YM->DIA": (v) => v / ratios["YM/DIA"],
    "DIA->YM": (v) => v * ratios["YM/DIA"],
    "YM->DJI": (v) => v / ratios["YM/DJI"],
    "DJI->YM": (v) => v * ratios["YM/DJI"],
    "RUT->IWM": (v) => v / ratios["RUT/IWM"],
    "IWM->RUT": (v) => v * ratios["RUT/IWM"],
    "RTY->IWM": (v) => v / ratios["RTY/IWM"],
    "IWM->RTY": (v) => v * ratios["RTY/IWM"],
    "RTY->RUT": (v) => v / ratios["RTY/RUT"],
    "RUT->RTY": (v) => v * ratios["RTY/RUT"]
  };

  const key = `${fromTicker}->${toTicker}`;
  const conversionFunction = conversionMapping[key];

  if (!conversionFunction || conversionFunction(inputValue) === undefined) {
    document.getElementById("convert-output").textContent = "Invalid conversion.";
    return;
  }

  const convertedValue = conversionFunction(inputValue);
  document.getElementById("convert-output").textContent =
    `${toTicker}: ${convertedValue.toFixed(8)}`;
}

function updateRatioDisplay() {
  const ratioMapping = {
    "DJI/DIA": "ratio-dji-dia",
    "YM/DIA": "ratio-ym-dia",
    "YM/DJI": "ratio-ym-dji",
    "RUT/IWM": "ratio-rut-iwm",
    "RTY/IWM": "ratio-rty-iwm",
    "RTY/RUT": "ratio-rty-rut"
  };

  Object.keys(ratioMapping).forEach(key => {
    const element = document.getElementById(ratioMapping[key]);
    if (element) {
      element.textContent =
        ratios[key] !== undefined && ratios[key] !== null
          ? ratios[key].toFixed(8)
          : "N/A";
    }
  });
}

function updatePriceDisplay() {
  const priceMapping = {
    "DJI": "price-dji",
    "DIA": "price-dia",
    "YM": "price-ym",
    "RUT": "price-rut",
    "IWM": "price-iwm",
    "RTY": "price-rty"
  };

  Object.keys(priceMapping).forEach(ticker => {
    const element = document.getElementById(priceMapping[ticker]);
    if (element) {
      element.textContent =
        prices[ticker] !== undefined && prices[ticker] !== null
          ? `$${prices[ticker].toFixed(2)}`
          : (lastPrices[ticker] !== undefined ? `$${lastPrices[ticker].toFixed(2)}` : "N/A");
    }
  });
}

setInterval(updateRatioDisplay, 1000);
setInterval(updatePriceDisplay, 1000);
setInterval(updateDowRussellRatios, 60000);
updateDowRussellRatios();
