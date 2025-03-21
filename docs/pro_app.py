from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os
import logging
import time
from threading import Lock

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# In-memory cache for prices
price_cache = {}
cache_lock = Lock()
CACHE_TIMEOUT = 60  # Cache prices for 60 seconds

@app.route('/get_live_price_pro')
def get_live_price_pro():
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}
    current_time = time.time()

    try:
        with cache_lock:
            for ticker in tickers:
                # Check cache first
                if ticker in price_cache and (current_time - price_cache[ticker]["timestamp"]) < CACHE_TIMEOUT:
                    prices[ticker] = price_cache[ticker]["price"]
                    logger.info(f"Using cached price for {ticker}: {prices[ticker]}")
                else:
                    stock = yf.Ticker(ticker)
                    try:
                        prices[ticker] = stock.fast_info["last_price"]
                        logger.info(f"Fetched fast_info price for {ticker}: {prices[ticker]}")
                    except (KeyError, AttributeError, Exception) as e:
                        try:
                            prices[ticker] = stock.info["regularMarketPrice"]
                            logger.info(f"Fallback fetched info price for {ticker}: {prices[ticker]}")
                        except (KeyError, Exception) as e:
                            prices[ticker] = None
                            logger.error(f"No price data for {ticker}: {str(e)}")
                    
                    # Update cache
                    if prices[ticker] is not None:
                        price_cache[ticker] = {"price": prices[ticker], "timestamp": current_time}
                    
                    # Delay to avoid rate limiting
                    time.sleep(0.5)  # 0.5 seconds between requests
            
        ratios = {
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        }

        logger.info(f"Returning ratios: {ratios}")
        return jsonify(ratios)

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
