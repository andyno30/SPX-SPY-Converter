from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os
import logging
import time
import threading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global cache
price_cache = {}
cache_lock = threading.Lock()
last_update = 0
UPDATE_INTERVAL = 3600  # 1 hour in seconds

def update_prices():
    global price_cache, last_update
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    new_prices = {}
    
    try:
        for ticker in tickers:
            stock = yf.Ticker(ticker)
            try:
                price = stock.fast_info["last_price"]
                new_prices[ticker] = price
                logger.info(f"Fetched fast_info price for {ticker}: {price}")
            except (KeyError, AttributeError, Exception) as e:
                try:
                    price = stock.info["regularMarketPrice"]
                    new_prices[ticker] = price
                    logger.info(f"Fallback info price for {ticker}: {price}")
                except (KeyError, Exception) as e2:
                    new_prices[ticker] = None
                    logger.error(f"No price for {ticker}: {str(e2)}")
            time.sleep(1)  # Delay between requests
        
        with cache_lock:
            price_cache = new_prices
            last_update = time.time()
            logger.info(f"Updated cache: {price_cache}")
    except Exception as e:
        logger.error(f"Update failed: {str(e)}")

def start_update_thread():
    def run():
        while True:
            update_prices()
            time.sleep(UPDATE_INTERVAL)
    
    thread = threading.Thread(target=run, daemon=True)
    thread.start()

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global last_update
    current_time = time.time()
    
    with cache_lock:
        if not price_cache or (current_time - last_update) > UPDATE_INTERVAL:
            update_prices()
        
        prices = price_cache.copy()
        
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
    start_update_thread()
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
