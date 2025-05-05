from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import os
import logging
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for cross-origin requests

# Caching settings
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)  # Cache data for 1 minute

def fetch_data():
    tickers = ["^GSPC", "^NDX", "SPY", "QQQ", "ES=F", "NQ=F"]  # Match deployed tickers
    prices = {}
    for attempt in range(3):
        try:
            data = yf.download(tickers, period="1d", interval="1m", group_by="ticker")
            logger.info("Batch data downloaded successfully")
            for t in tickers:
                ticker_data = data[t] if t in data else None
                if ticker_data is not None and not ticker_data.empty and "Close" in ticker_data.columns:
                    last_close = ticker_data["Close"].dropna().iloc[-1] if not ticker_data["Close"].isna().all() else None
                    if last_close is not None:
                        prices[t] = last_close
                    else:
                        stock = yf.Ticker(t)
                        prices[t] = stock.info.get("previousClose", None)
                        logger.info(f"Fallback to previous close for {t}: {prices[t]}")
                else:
                    stock = yf.Ticker(t)
                    prices[t] = stock.info.get("previousClose", None)
                    logger.info(f"Fallback to previous close for {t}: {prices[t]}")
            return {
                "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "Prices": prices,
                "SPX/SPY Ratio": prices["^GSPC"] / prices["SPY"] if prices["SPY"] else None,
                "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
                "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
                "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
                "ES/SPX Ratio": prices["ES=F"] / prices["^GSPC"] if prices["^GSPC"] else None,
            }
        except Exception as e:
            if "Too Many Requests" in str(e):
                logger.warning(f"Rate limit hit on attempt {attempt + 1}. Waiting 10 seconds...")
                time.sleep(10)
            else:
                logger.error(f"Fetch failed: {e}")
                break
    logger.error("Max retries reached, fetch failed")
    return None

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp
    # Check cache
    if cached_data is not None and cache_timestamp is not None:
        if datetime.now() - cache_timestamp < CACHE_DURATION:
            logger.info("Serving data from cache")
            return jsonify(cached_data)
    # Cache is old or None, fetch new data
    new_data = fetch_data()
    if new_data is not None:
        cached_data = new_data
        cache_timestamp = datetime.now()
        logger.info("Returning fresh data")
        return jsonify(new_data)
    else:
        if cached_data is not None:
            logger.info("Fetch failed, serving stale data")
            return jsonify(cached_data)
        return jsonify({"error": "Failed to fetch data"}), 500

@app.route('/')
def index():
    return '🟢 SpyConverter Pro backend is live!'

@app.route('/favicon.ico')
def favicon():
    return '', 204

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
