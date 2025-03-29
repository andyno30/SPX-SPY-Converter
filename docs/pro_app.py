from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Caching settings: cache the data for 60 seconds
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp

    # If cached data is fresh, return it immediately
    if cached_data is not None and cache_timestamp is not None:
        if datetime.now() - cache_timestamp < CACHE_DURATION:
            logger.info("Serving data from cache")
            return jsonify(cached_data)

    # Define tickers using their raw symbols for yfinance
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}

    try:
        # Batch fetch data for all tickers at once.
        # This reduces the total number of API calls.
        data = yf.download(tickers, period="1d", interval="1m", group_by="ticker")
        logger.info("Batch data downloaded successfully")
        
        for ticker in tickers:
            # For multiple tickers, data is returned as a dictionary with each ticker as a key.
            ticker_data = data[ticker] if ticker in data else data  # Fallback if only one ticker is returned
            if ticker_data is not None and not ticker_data.empty:
                # Use the last closing price from the batch data
                prices[ticker] = ticker_data["Close"].iloc[-1]
                logger.info(f"Fetched {ticker}: {prices[ticker]}")
            else:
                prices[ticker] = None
                logger.error(f"No data found for {ticker}")
        
        response_data = {
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M"),
            "Prices": prices,
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
        }

        # Update the cache
        cached_data = response_data
        cache_timestamp = datetime.now()

        logger.info(f"Returning fresh data: {response_data}")
        return jsonify(response_data)

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
