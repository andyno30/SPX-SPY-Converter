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

# Caching settings
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)  # Cache data for 60 seconds

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp

    # Serve cached data if it's still fresh
    if cached_data and cache_timestamp and (datetime.now() - cache_timestamp < CACHE_DURATION):
        logger.info("Serving data from cache")
        return jsonify(cached_data)

    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]

    try:
        # Batch fetch using yf.download
        data = yf.download(tickers, period="1d", interval="1m", group_by="ticker")
        prices = {}
        for ticker in tickers:
            # If multiple tickers are returned, data[ticker] is a DataFrame;
            # otherwise, for a single ticker, data itself is the DataFrame.
            ticker_data = data[ticker] if ticker in data else data
            # Get the last close price if available
            if not ticker_data.empty:
                prices[ticker] = ticker_data["Close"].iloc[-1]
                logger.info(f"Successfully fetched price for {ticker}: {prices[ticker]}")
            else:
                prices[ticker] = None
                logger.error(f"No price data found for {ticker}")

        response_data = {
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M"),
            "Prices": prices,
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
        }

        # Update cache
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
