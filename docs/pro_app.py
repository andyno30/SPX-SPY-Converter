from flask import Flask, jsonify
from flask_cors import CORS
import requests
from datetime import datetime, timedelta
import os
import logging
from threading import Lock

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Caching and concurrency settings
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)
request_count = 0
cache_lock = Lock()
is_fetching = False

# Finnhub API key and base URL
FINNHUB_API_KEY = "d0b95q1r01qo0h63g7l0d0b95q1r01qo0h63g7lg"
FINNHUB_BASE_URL = "https://finnhub.io/api/v1/quote"

# Function to fetch live prices from Finnhub
def fetch_finnhub_prices(tickers):
    prices = {}
    for ticker in tickers:
        url = f"{FINNHUB_BASE_URL}?symbol={ticker}&token={FINNHUB_API_KEY}"
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            prices[ticker] = data.get("c")  # "c" is the current price
        else:
            logger.warning(f"Failed to fetch data for {ticker}. Status code: {response.status_code}")
            prices[ticker] = None
    return prices

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp, request_count, is_fetching

    # Serve from cache if still valid
    if cached_data is not None and cache_timestamp is not None:
        if datetime.now() - cache_timestamp < CACHE_DURATION:
            logger.info("Serving data from cache")
            return jsonify(cached_data)

    # Prevent concurrent fetches
    if is_fetching:
        logger.info("Another request is already fetching. Serving stale cache or error.")
        return jsonify(cached_data if cached_data else {"error": "Data temporarily unavailable"}), 503

    try:
        with cache_lock:
            is_fetching = True

            # Double-check cache inside lock
            if cached_data is not None and cache_timestamp is not None:
                if datetime.now() - cache_timestamp < CACHE_DURATION:
                    logger.info("Serving data from cache (inside lock)")
                    return jsonify(cached_data)

            tickers = ["^GSPC", "^NDX", "ES=F", "NQ=F", "QQQ"]
            prices = fetch_finnhub_prices(tickers)

            response_data = {
                "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "Prices": prices,
                "SPX/SPY Ratio": prices["^GSPC"] / prices["SPY"] if prices["SPY"] else None,
                "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
                "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
                "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
                "ES/SPX Ratio": prices["ES=F"] / prices["^GSPC"] if prices["^GSPC"] else None,
            }

            # Update cache
            cached_data = response_data
            cache_timestamp = datetime.now()
            logger.info(f"Returning fresh data: {response_data}")
            return jsonify(response_data)

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        if cached_data is not None:
            logger.info("Serving cached data due to fetch error")
            return jsonify(cached_data)
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

    finally:
        is_fetching = False

@app.route('/')
def index():
    return '🟢 SpyConverter Pro backend is live!'

@app.route('/favicon.ico')
def favicon():
    return '', 204

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)


