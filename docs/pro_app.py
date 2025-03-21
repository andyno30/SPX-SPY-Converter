from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os
import logging
import time
from threading import Lock

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

price_cache = {}
cache_lock = Lock()
CACHE_TIMEOUT = 3600  # 1 hour

def fetch_price(stock):
    try:
        price = stock.fast_info["last_price"]
        logger.info(f"Fetched fast_info for {stock.ticker}: {price}")
        return price
    except Exception as e:
        try:
            price = stock.info["regularMarketPrice"]
            logger.info(f"Fallback info for {stock.ticker}: {price}")
            return price
        except Exception as e2:
            logger.error(f"No price for {stock.ticker}: {str(e2)}")
            return None

@app.route('/get_live_price_pro')
def get_live_price_pro():
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}
    current_time = time.time()

    with cache_lock:
        if not price_cache or (current_time - price_cache.get("timestamp", 0)) > CACHE_TIMEOUT:
            for ticker in tickers:
                stock = yf.Ticker(ticker)
                prices[ticker] = fetch_price(stock)
                time.sleep(1)  # Avoid rapid requests
            price_cache.update(prices)
            price_cache["timestamp"] = current_time
            logger.info(f"Updated cache: {prices}")
        else:
            prices = price_cache.copy()
            logger.info("Using cached prices")

        ratios = {
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices.get("^SPX") and prices.get("SPY") else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices.get("ES=F") and prices.get("SPY") else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices.get("NQ=F") and prices.get("QQQ") else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices.get("^NDX") and prices.get("QQQ") else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices.get("ES=F") and prices.get("^SPX") else None,
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        }

        logger.info(f"Returning ratios: {ratios}")
        return jsonify(ratios)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
