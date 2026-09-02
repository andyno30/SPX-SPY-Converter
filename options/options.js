const DATA_URLS = [
  "https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/fetch-spy-options",
  "../data/spy-options.json",
];
const DATA_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const SIDE_AD_MEDIA = window.matchMedia("(min-width: 1280px)");
const $ = (id) => document.getElementById(id);
let dataRequestInFlight = false;

const hasValue = (value) => value !== null && value !== undefined && value !== "";

function numberValue(value, digits = 2) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function moneyValue(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  return "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function percentValue(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}

function compactNumber(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  if (absolute >= 1e9) return `${sign}${(absolute / 1e9).toFixed(1)}B`;
  if (absolute >= 1e6) return `${sign}${(absolute / 1e6).toFixed(1)}M`;
  if (absolute >= 1e3) return `${sign}${(absolute / 1e3).toFixed(1)}K`;
  return `${sign}${absolute.toFixed(0)}`;
}

function dateOnly(value) {
  if (typeof value !== "string") return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function timestamp(value) {
  if (!value) return "Updated time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated time unavailable";
  return "Updated " + date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderSplit(label, values = {}) {
  const row = document.createElement("div");
  row.className = "split-row";

  const name = document.createElement("div");
  name.className = "split-label";
  name.textContent = label;

  const bar = document.createElement("div");
  bar.className = "split-bar";

  const call = document.createElement("div");
  call.className = "split-call";
  call.style.width = `${Math.max(0, Math.min(100, Number(values.call) || 0))}%`;

  const put = document.createElement("div");
  put.className = "split-put";
  put.style.width = `${Math.max(0, Math.min(100, Number(values.put) || 0))}%`;

  bar.append(call, put);

  const text = document.createElement("div");
  text.className = "split-values";
  const strong = document.createElement("strong");
  strong.textContent = `Call ${percentValue(values.call)}`;
  text.append(strong, document.createTextNode(` · Put ${percentValue(values.put)}`));

  row.append(name, bar, text);
  return row;
}

function render(data) {
  $("current-price").textContent = moneyValue(data.currentPrice);
  const expiry = dateOnly(data.nearestExpiry);
  $("nearest-expiry").textContent = hasValue(data.daysToExpiry)
    ? `${expiry} · D-${data.daysToExpiry}`
    : expiry;
  $("max-pain").textContent = moneyValue(data.maxPain);
  $("put-call-volume").textContent = numberValue(data.putCallRatioVolume);
  $("put-call-open-interest").textContent = numberValue(data.putCallRatioOpenInterest);

  const splits = $("splits");
  splits.replaceChildren(
    renderSplit("Volume", data.volumeSplit),
    renderSplit("Open interest", data.openInterestSplit),
    renderSplit("Premium", data.premiumSplit),
  );

  $("total-volume").textContent = data.totalOptionVolumeFormatted || compactNumber(data.totalOptionVolume);
  $("relative-3d").textContent = percentValue(data.relativeVolume?.["3d"]);
  $("relative-7d").textContent = percentValue(data.relativeVolume?.["7d"]);
  $("relative-30d").textContent = percentValue(data.relativeVolume?.["30d"]);
  $("call-wall").textContent = moneyValue(data.callWall);
  $("put-wall").textContent = moneyValue(data.putWall);
  $("gamma-flip").textContent = data.gammaFlip === null || data.gammaFlip === undefined
    ? "—"
    : moneyValue(data.gammaFlip);
  $("net-gex").textContent = data.netGexFormatted || compactNumber(data.netGex);
  $("data-source").textContent = data.source || "Unusual Whales";
  $("updated-at").textContent = timestamp(data.sourceUpdatedAt || data.updatedAt || data.fetchedAt || data.asOf);
}

async function loadData() {
  if (dataRequestInFlight) return;
  dataRequestInFlight = true;

  const refresh = $("refresh-data");
  const error = $("load-error");
  refresh.disabled = true;
  refresh.textContent = "Loading…";

  try {
    let data = null;
    let lastError = new Error("No SPY options source was available.");

    for (const url of DATA_URLS) {
      try {
        const separator = url.includes("?") ? "&" : "?";
        const response = await fetch(`${url}${separator}ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
        break;
      } catch (reason) {
        lastError = reason;
      }
    }

    if (!data) throw lastError;
    render(data);
    error.hidden = true;
  } catch (reason) {
    error.textContent = `Could not load the latest cached SPY options data: ${reason.message}`;
    error.hidden = false;
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Refresh data";
    dataRequestInFlight = false;
  }
}

function requestAds(units) {
  units.forEach((unit) => {
    if (unit.dataset.adRequested === "true") return;
    unit.dataset.adRequested = "true";

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blockers and transient AdSense initialization failures should not
      // interfere with the options dashboard.
    }
  });
}

function initializeSideAds() {
  if (!SIDE_AD_MEDIA.matches) return;
  requestAds(document.querySelectorAll(".side-ad-unit"));
}

function initializeBottomAd() {
  requestAds(document.querySelectorAll(".options-bottom-ad-unit"));
}

function toggleBottomAd() {
  const ad = $("options-bottom-ad");
  const toggle = $("toggle-bottom-ad");
  const shouldShow = ad.hidden;

  ad.hidden = !shouldShow;
  toggle.textContent = shouldShow ? "Hide Bottom Ad" : "Show Bottom Ad";
  toggle.setAttribute("aria-expanded", String(shouldShow));
}

$("refresh-data").addEventListener("click", loadData);
$("toggle-bottom-ad").addEventListener("click", toggleBottomAd);
SIDE_AD_MEDIA.addEventListener?.("change", initializeSideAds);
window.addEventListener("load", () => {
  initializeSideAds();
  initializeBottomAd();
});
window.addEventListener("focus", loadData);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadData();
});
initializeSideAds();
initializeBottomAd();
loadData();
window.setInterval(loadData, DATA_REFRESH_INTERVAL_MS);
