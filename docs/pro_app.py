import os
import logging
from datetime import datetime, timedelta
from threading import Lock

from flask import Flask, jsonify
from flask_cors import CORS
import finnhub                                # Official Finnhub Python SDK :contentReference[oaicite:0]{index=0}
from apscheduler.schedulers.background import BackgroundScheduler

# ─── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Flask app setup ──────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ─── Cache & Concurrency ──────────────────────────────────────────────────────
cache_lock    = Lock()
cached_data   = None
cache_time    = None
CACHE_SECONDS = 60

# ─── Finnhub client ───────────────────────────────────────────────────────────
# Use your API key (not the webhook secret) here:
#   - API key for making requests
#   - Webhook secret is only for validating incoming webhooks, not needed for quote calls
FINNHUB_API_KEY = os.environ["FINNHUB_API_KEY"]  # set in Render as a secret env var :contentReference[oaicite:1]{index=1}
finnhub_client  = finnhub.Client(api_key=FINNHUB_API_KEY)

# ─── Helper functions ─────────────────────────────────────────────────────────
def safe_div(a, b):
    try:
        return round(a/b, 5) if (a is not None and b) else None
    except Exception as e:
        logger.warning(f"Division error: {e}")
        return None

def fetch_finnhub_prices(tickers):
    """Fetch current price (‘c’ field) for each ticker via Finnhub quote endpoint."""
    prices = {}
    for sym in tickers:
        resp = finnhub_client.quote(sym)         # GET /quote → returns JSON with “c” :contentReference[oaicite:2]{index=2}
        prices[sym] = resp.get("c")              # current price
        logger.info(f"Fetched {sym}: {prices[sym]}")
    return prices

def refresh_cache():
    """Background job: fetch prices, compute ratios, update in‑memory cache."""
    global cached_data, cache_time
    tickers = ["^GSPC", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]  # Yahoo-style tickers for continuity :contentReference[oaicite:3]{index=3}
    logger.info("Refreshing cache via Finnhub...")
    prices = fetch_finnhub_prices(tickers)
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    new_data = {
        "Datetime": now,
        "Prices": prices,
        "SPX/SPY Ratio": safe_div(prices["^GSPC"], prices["SPY"]),
        "ES/SPY Ratio": safe_div(prices["ES=F"], prices["SPY"]),
        "NQ/QQQ Ratio": safe_div(prices["NQ=F"], prices["QQQ"]),
        "NDX/QQQ Ratio": safe_div(prices["^NDX"], prices["QQQ"]),
        "ES/SPX Ratio": safe_div(prices["ES=F"], prices["^GSPC"])
    }

    with cache_lock:
        cached_data = new_data
        cache_time  = datetime.utcnow()
    logger.info("Cache updated.")

# ─── Scheduler ─────────────────────────────────────────────────────────────────
# Run initial load + schedule recurring refresh every CACHE_SECONDS
refresh_cache()
sched = BackgroundScheduler()
sched.add_job(refresh_cache, 'interval', seconds=CACHE_SECONDS)
sched.start()

# ─── Flask routes ─────────────────────────────────────────────────────────────
@app.route('/get_live_price_pro')
def get_live_price_pro():
    with cache_lock:
        if not cached_data:
            return jsonify({"error": "Data not yet available"}), 503
        age = (datetime.utcnow() - cache_time).total_seconds()
        if age > CACHE_SECONDS * 1.5:
            return jsonify({"error": "Data stale"}), 503
        return jsonify(cached_data)

@app.route('/')
def index():
    return '🟢 SpyConverter Pro backend is live!'

@app.route('/favicon.ico')
def favicon():
    return '', 204

# ─── Entrypoint ────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
