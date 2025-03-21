from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os
import logging
import time
import random
from threading import Lock

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# In-memory cache
price_cache = {}
cache_lock = Lock()
CACHE_TIMEOUT = 300  # 5 minutes, increased from 60s for fewer API calls

def fetch_price_with_retry(stock, max_retries=3, backoff_factor=2):
    for attempt in range(max_retries):
        try:
            price = stock.fast_info["last_price"]
            logger.info(f"fast_info succeeded for {stock.ticker}: {price}")
            return price
        except Exception as e:
            if "429" in str(e):
                wait_time = backoff_factor ** attempt + random.uniform(0, 1)
                logger.warning(f"Rate limit for {stock.ticker}. Waiting {wait_time:.2f}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
            else:
                logger.error(f"fast_info failed for {stock.ticker}: {str(e)}")
                # Fallback to stock.info
                try:
                    price = stock.info["regularMarketPrice"]
                    logger.info(f"Fallback to info succeeded for {stock.ticker}: {price}")
                    return price
                except (KeyError, Exception) as e2:
                    logger.error(f"stock.info failed for {stock.ticker}: {str(e2)}")
                    if attempt == max_retries - 1:
                        return None
                    time.sleep(1)  # Short delay before retry
    return None

@app.route('/get_live_price_pro')
def get_live_price_pro():
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}
    current_time = time.time()

    try:
        with cache_lock:
            for ticker in tickers:
                if ticker in price_cache and (current_time - price_cache[ticker]["timestamp"]) < CACHE_TIMEOUT:
                    prices[ticker] = price_cache[ticker]["price"]
                    logger.info(f"Using cached price for {ticker}: {prices[ticker]}")
                else:
                    stock = yf.Ticker(ticker)
                    price = fetch_price_with_retry(stock)
                    if price is not None:
                        prices[ticker] = price
                        price_cache[ticker] = {"price": price, "timestamp": current_time}
                        logger.info(f"Cached new price for {ticker}: {price}")
                    else:
                        prices[ticker] = None
                        logger.warning(f"No price fetched for {ticker}")

            ratios = {
                "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["^SPX"] and prices["SPY"] else None,
                "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["ES=F"] and prices["SPY"] else None,
                "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["NQ=F"] and prices["QQQ"] else None,
                "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["^NDX"] and prices["QQQ"] else None,
                "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["ES=F"] and prices["^SPX"] else None,
                "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
            }

            logger.info(f"Returning ratios: {ratios}")
            return jsonify(ratios)

    except Exception as e:
        logger.error(f"Unexpected error in get_live_price_pro: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
