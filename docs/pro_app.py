from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import os
import logging
import threading
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global cache
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)

# Tickers to fetch
TICKERS = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]

def fetch_prices():
    """Fetches live prices and updates global cache"""
    global cached_data, cache_timestamp

    prices = {}
    try:
        logger.info("Fetching prices from Yahoo Finance...")

        # Try bulk download
        data = None
        try:
            data = yf.download(TICKERS, period="1d", interval="1m", group_by="ticker", threads=False)
            logger.info("Bulk data downloaded.")
        except Exception as e:
            logger.warning(f"Bulk download failed: {e}")

        # Process each ticker
        for ticker in TICKERS:
            try:
                if data is not None and ticker in data and "Close" in data[ticker]:
                    last_close = data[ticker]["Close"].dropna().iloc[-1]
                    prices[ticker] = last_close
                else:
                    # Fallback to single-ticker fetch
                    ticker_obj = yf.Ticker(ticker)
                    price = ticker_obj.info.get("regularMarketPrice")

                    if price is None:
                        hist = ticker_obj.history(period="1d")
                        price = hist["Close"].dropna().iloc[-1] if not hist.empty else None

                    prices[ticker] = price
                    logger.info(f"Used fallback for {ticker}: {price}")
            except Exception as e:
                prices[ticker] = None
                logger.error(f"Failed to fetch {ticker}: {e}")

        # Construct response
        response_data = {
            "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "Prices": prices,
            "SPX/SPY Ratio": prices.get("^SPX") / prices.get("SPY") if prices.get("SPY") else None,
            "ES/SPY Ratio": prices.get("ES=F") / prices.get("SPY") if prices.get("SPY") else None,
            "NQ/QQQ Ratio": prices.get("NQ=F") / prices.get("QQQ") if prices.get("QQQ") else None,
            "NDX/QQQ Ratio": prices.get("^NDX") / prices.get("QQQ") if prices.get("QQQ") else None,
            "ES/SPX Ratio": prices.get("ES=F") / prices.get("^SPX") if prices.get("^SPX") else None,
        }

        cached_data = response_data
        cache_timestamp = datetime.now()
        logger.info(f"Prices updated at {cache_timestamp}.")
    except Exception as e:
        logger.error(f"Price update failed: {e}")

def background_price_updater():
    """Background thread to update prices every 60 seconds"""
    while True:
        fetch_prices()
        time.sleep(60)

@app.route('/get_live_price_pro')
def get_live_price_pro():
    """Returns cached live prices"""
    if cached_data:
        return jsonify(cached_data)
    return jsonify({"error": "Failed to fetch data: Cache not ready yet."}), 503

if __name__ == '__main__':
    # Start background thread
    thread = threading.Thread(target=background_price_updater)
    thread.daemon = True
    thread.start()

    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)

