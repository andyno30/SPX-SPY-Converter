import { supabase } from "../docs/auth.js";

const OPTIONS_FUNCTION_URL =
  "https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/fetch-spy-options";
const SPY_FALLBACK_URL = "../data/spy-options.json";
const PUBLIC_TICKER = "SPY";
const TICKERS = [
  "SPY",
  "QQQ",
  "IWM",
  "AAPL",
  "META",
  "AMZN",
  "MSFT",
  "GOOG",
  "GOOGL",
  "NVDA",
  "TSLA",
  "AMD",
  "TLT",
  "MU",
  "SNDK",
  "SNAP",
  "XYZ",
];
const TICKER_SET = new Set(TICKERS);
const DATA_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const SIDE_AD_MEDIA = window.matchMedia("(min-width: 1280px)");
const $ = (id) => document.getElementById(id);
let activeTicker = PUBLIC_TICKER;
let accessState = { session: null, isPro: false };
let latestRequestId = 0;

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

function render(data, ticker) {
  const responseTicker = String(data.symbol || ticker).toUpperCase();
  if (responseTicker !== ticker) {
    throw new Error(`Received ${responseTicker} data while loading ${ticker}.`);
  }

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

  const snapshotStatus = $("snapshot-status");
  snapshotStatus.hidden = !data.isPriorDay;
  snapshotStatus.textContent = data.isPriorDay ? "Prior-day" : "";
}

function requestedTicker() {
  const ticker = new URLSearchParams(window.location.search).get("ticker")?.toUpperCase();
  return ticker && TICKER_SET.has(ticker) ? ticker : PUBLIC_TICKER;
}

function tickerPageUrl(ticker) {
  const url = new URL("/options/", window.location.origin);
  if (ticker !== PUBLIC_TICKER) url.searchParams.set("ticker", ticker);
  return url;
}

async function getAccessState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { session: null, isPro: false };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("is_subscribed")
    .eq("id", session.user.id)
    .maybeSingle();

  return {
    session,
    isPro: !error && Boolean(profile?.is_subscribed),
  };
}

function updateTickerMenu() {
  const tickerSelect = $("ticker-select");
  for (const option of tickerSelect.options) {
    const ticker = option.value;
    const isLocked = ticker !== PUBLIC_TICKER && !accessState.isPro;
    option.textContent = `${isLocked ? "🔒 " : ""}${ticker}`;
  }

  const accessLabel = $("ticker-access-label");
  if (accessState.isPro) {
    accessLabel.textContent = "All tickers unlocked with SpyConverter Pro";
    accessLabel.classList.add("is-pro");
  } else {
    accessLabel.textContent = "Additional tickers require SpyConverter Pro";
    accessLabel.classList.remove("is-pro");
  }
}

function redirectForLockedTicker(ticker) {
  const returnTo = tickerPageUrl(ticker).toString();
  if (!accessState.session) {
    window.location.assign(
      `/docs/login.html?return_to=${encodeURIComponent(returnTo)}`,
    );
    return;
  }
  window.location.assign("/pro.html#pricing");
}

function updatePageForTicker(ticker) {
  activeTicker = ticker;
  $("ticker-select").value = ticker;
  $("options-title").textContent = `${ticker} Options`;
  $("reference-price-label").textContent = `${ticker} reference price`;
  document.title = `${ticker} Options Dashboard | SpyConverter`;
}

function showLoadingState() {
  $("current-price").textContent = "Loading…";
  $("nearest-expiry").textContent = "Loading…";
  for (const id of [
    "max-pain",
    "put-call-volume",
    "put-call-open-interest",
    "total-volume",
    "relative-3d",
    "relative-7d",
    "relative-30d",
    "call-wall",
    "put-wall",
    "gamma-flip",
    "net-gex",
  ]) {
    $(id).textContent = "—";
  }
  $("splits").replaceChildren();
  $("updated-at").textContent = "—";
}

async function fetchTickerData(ticker) {
  const url = new URL(OPTIONS_FUNCTION_URL);
  url.searchParams.set("ticker", ticker);

  const headers = { Accept: "application/json" };
  if (ticker !== PUBLIC_TICKER) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      const error = new Error("Sign in to access this options ticker.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, { cache: "no-store", headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.code = payload.code || "REQUEST_FAILED";
      throw error;
    }
    return payload;
  } catch (error) {
    if (ticker !== PUBLIC_TICKER || error.code) throw error;
  }

  const fallback = await fetch(`${SPY_FALLBACK_URL}?ts=${Date.now()}`, {
    cache: "no-store",
  });
  if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
  return await fallback.json();
}

async function loadData(ticker = activeTicker) {
  const requestId = ++latestRequestId;

  const refresh = $("refresh-data");
  const error = $("load-error");
  refresh.disabled = true;
  refresh.textContent = "Loading…";

  try {
    const data = await fetchTickerData(ticker);
    if (requestId !== latestRequestId || ticker !== activeTicker) return;
    render(data, ticker);
    error.hidden = true;
  } catch (reason) {
    if (requestId !== latestRequestId) return;
    if (reason.code === "AUTH_REQUIRED" || reason.code === "PRO_REQUIRED") {
      accessState = await getAccessState();
      updateTickerMenu();
      redirectForLockedTicker(ticker);
      return;
    }
    error.textContent = `Could not load the latest ${ticker} options data: ${reason.message}`;
    error.hidden = false;
  } finally {
    if (requestId === latestRequestId) {
      refresh.disabled = false;
      refresh.textContent = "Refresh data";
    }
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

async function selectTicker(ticker, updateHistory = true) {
  if (ticker !== PUBLIC_TICKER && !accessState.isPro) {
    $("ticker-select").value = activeTicker;
    redirectForLockedTicker(ticker);
    return;
  }

  if (updateHistory) {
    window.history.pushState({}, "", tickerPageUrl(ticker));
  }
  updatePageForTicker(ticker);
  showLoadingState();
  await loadData(ticker);
}

async function initializeOptions() {
  accessState = await getAccessState();
  updateTickerMenu();

  const ticker = requestedTicker();
  if (ticker !== PUBLIC_TICKER && !accessState.isPro) {
    redirectForLockedTicker(ticker);
    return;
  }

  updatePageForTicker(ticker);
  showLoadingState();
  await loadData(ticker);
  window.setInterval(() => void loadData(), DATA_REFRESH_INTERVAL_MS);
}

$("ticker-select").addEventListener("change", (event) => {
  void selectTicker(event.currentTarget.value);
});
$("refresh-data").addEventListener("click", () => void loadData());
$("toggle-bottom-ad").addEventListener("click", toggleBottomAd);
SIDE_AD_MEDIA.addEventListener?.("change", initializeSideAds);
window.addEventListener("load", () => {
  initializeSideAds();
  initializeBottomAd();
});
window.addEventListener("popstate", () => {
  void selectTicker(requestedTicker(), false);
});
initializeSideAds();
initializeBottomAd();
void initializeOptions();
