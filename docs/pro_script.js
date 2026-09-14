import { fetchProPrices } from './pro_prices_api.js';

let prices = {};     // Holds the latest market prices
let lastPrices = {}; // Holds the last known valid prices
let ratios = {};     // Holds the latest conversion ratios
let lastValidDate = "Unknown"; // Store the last successful timestamp

// Define valid conversion pairs
const validConversions = {
  "SPX": ["SPY", "ES"],
  "SPY": ["SPX", "ES"],
  "ES": ["SPY", "SPX"],
  "NQ": ["QQQ", "NDX"],
  "QQQ": ["NQ", "NDX"],
  "NDX": ["QQQ", "NQ"]
};

let selectedESContract = 'AUTO';
let requestVersion = 0;
let activeRequest = null;
let esLoading = true;
const contractSelect = document.getElementById('es-contract');
const contractStatus = document.getElementById('es-contract-status');
const finitePrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function selectedContractLabel() {
  return contractSelect.selectedOptions[0]?.textContent || 'Auto / Front Month';
}
function clearES() {
  prices.ES = null;
  delete lastPrices.ES;
  ratios['ES/SPY'] = null;
  ratios['ES/SPX'] = null;
}
function recalculateESConversion() {
  const from = document.getElementById('from-ticker').value;
  const to = document.getElementById('to-ticker').value;
  if ((from === 'ES' || to === 'ES') && document.getElementById('convert-input').value !== '') convertPremium();
}
function updateContractOptions(contracts) {
  const previousLabel = selectedContractLabel();
  contractSelect.replaceChildren(new Option('Auto / Front Month', 'AUTO'));
  for (const contract of contracts || []) {
    contractSelect.add(new Option(contract.label, contract.contract));
  }
  if (selectedESContract !== 'AUTO' && !Array.from(contractSelect.options).some(o => o.value === selectedESContract)) {
    const unavailable = new Option(previousLabel, selectedESContract);
    unavailable.disabled = true;
    contractSelect.add(unavailable);
  }
  contractSelect.value = selectedESContract;
  contractSelect.disabled = false;
}

// Contract changes use the server's shared snapshot, but update only ES locally.
// Abort + generation checking prevent a slower old selection replacing a new one.
async function updateProRatios({ esOnly = false } = {}) {
  const version = ++requestVersion;
  const contract = selectedESContract;
  activeRequest?.abort();
  activeRequest = new AbortController();
  esLoading = true;
  if (esOnly) clearES();
  contractStatus.textContent = `ES: ${selectedContractLabel()} — loading quote…`;
  document.getElementById('conversionDate').textContent = esOnly ? lastValidDate : 'Loading...';
  updateRatioDisplay();
  recalculateESConversion();
  try {
    const data = await fetchProPrices(contract, activeRequest.signal);
    if (version !== requestVersion) return;
    if (!data?.Prices) throw new Error('Invalid price response.');
    // Auto also accepts the old payload during a staged frontend-first release.
    if ((data.ESSelection && data.ESSelection !== contract) ||
        (contract !== 'AUTO' && (data.ESContract !== contract || data.ESSymbol !== `${contract}.CME`))) {
      throw new Error('The requested ES contract was not returned.');
    }
    updateContractOptions(data.ESContracts);
    if (esOnly) {
      prices.ES = data.Prices.ES;
    } else {
      prices = data.Prices;
      for (const [ticker, price] of Object.entries(prices)) {
        if (ticker !== 'ES' && finitePrice(price)) lastPrices[ticker] = price;
      }
      ratios['SPX/SPY'] = data['SPX/SPY Ratio'];
      ratios['NQ/QQQ'] = data['NQ/QQQ Ratio'];
      ratios['NDX/QQQ'] = data['NDX/QQQ Ratio'];
      ratios['NQ/NDX'] = finitePrice(prices.NQ) && finitePrice(prices.NDX) ? prices.NQ / prices.NDX : null;
      if (data.Datetime) lastValidDate = new Date(data.Datetime).toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
      });
    }
    // Always derive ES ratios from the displayed base prices, including when a
    // contract-only request lands after the server's base snapshot has refreshed.
    ratios['ES/SPY'] = finitePrice(prices.ES) && finitePrice(prices.SPY) ? prices.ES / prices.SPY : null;
    ratios['ES/SPX'] = finitePrice(prices.ES) && finitePrice(prices.SPX) ? prices.ES / prices.SPX : null;
    esLoading = false;
    const identity = contract === 'AUTO'
      ? `Auto / Front Month${data.ESContract ? ` (${data.ESContract})` : ''}`
      : selectedContractLabel();
    const quoteTime = data.ESQuote?.timestamp ? new Date(data.ESQuote.timestamp).toLocaleString() : null;
    const delay = data.ESQuote?.delayMinutes;
    contractStatus.textContent = `ES: ${identity} · ${finitePrice(prices.ES) ? `$${prices.ES.toFixed(2)}` : 'Quote unavailable'}` +
      (quoteTime ? ` · Last trade: ${quoteTime}` : '') +
      (typeof delay === 'number' && delay > 0 ? ` · Yahoo delay: ${delay} min` : '');
  } catch (error) {
    if (version !== requestVersion || error.name === 'AbortError') return;
    clearES();
    esLoading = false;
    contractStatus.textContent = `ES: ${selectedContractLabel()} · ${error.message}`;
    if (error.status === 401 || error.status === 403) {
      prices = {}; lastPrices = {}; ratios = {};
      document.getElementById('convert-output').textContent = error.message;
      contractSelect.disabled = true;
    }
  }
  if (version !== requestVersion) return;
  document.getElementById('conversionDate').textContent = lastValidDate;
  updateRatioDisplay();
  updatePriceDisplay();
  recalculateESConversion();
}
contractSelect.addEventListener('change', () => {
  selectedESContract = contractSelect.value;
  updateProRatios({ esOnly: true });
});

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

  if ((fromTicker === 'ES' || toTicker === 'ES') &&
      (esLoading || !finitePrice(ratios['ES/SPY']) || !finitePrice(ratios['ES/SPX']))) {
    document.getElementById('convert-output').textContent = esLoading
      ? `Loading ${selectedContractLabel()}…`
      : `ES quote unavailable for ${selectedContractLabel()}. Choose another contract or try again.`;
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
    "NDX->QQQ": (v) => v / ratios["NDX/QQQ"],
    "NQ->NDX":  (v) => (v / ratios["NQ/QQQ"]) * ratios["NDX/QQQ"],
    "NDX->NQ":  (v) => (v / ratios["NDX/QQQ"]) * ratios["NQ/QQQ"]
  };

  const key = `${fromTicker}->${toTicker}`;
  const conversionFunction = conversionMapping[key];

  if (!conversionFunction || !Number.isFinite(conversionFunction(inputValue))) {
    document.getElementById("convert-output").textContent = "Invalid conversion.";
    return;
  }

  const convertedValue = conversionFunction(inputValue);
  const esLabel = fromTicker === 'ES' || toTicker === 'ES' ? ` · ES: ${selectedContractLabel()}` : '';
  document.getElementById("convert-output").textContent = `${toTicker}: ${convertedValue.toFixed(8)}${esLabel}`;
}

// Update displayed ratios on the UI
function updateRatioDisplay() {
  const ratioMapping = {
    "SPX/SPY": "ratio-spx-spy",
    "ES/SPY": "ratio-es-spy",
    "NQ/QQQ": "ratio-nq-qqq",
    "NDX/QQQ": "ratio-ndx-qqq",
    "ES/SPX": "ratio-es-spx",
    "NQ/NDX": "ratio-nq-ndx"
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

window.convertPremium = convertPremium;
updateDropdownOptions();

// Fetch new data every 60 seconds
setInterval(updateProRatios, 60000);
updateProRatios();
