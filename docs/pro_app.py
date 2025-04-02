from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import os
import logging
import pandas as pd

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for cross-origin requests

# Caching settings
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=45)  # Cache data for 45 seconds

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp

    # Check if cached data exists and is still fresh (within 45 seconds)
    if cached_data is not None and cache_timestamp is not None:
        if datetime.now() - cache_timestamp < CACHE_DURATION:
            logger.info("Serving data from cache")
            return jsonify(cached_data)

    # Define the list of tickers to fetch
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}

    try:
        # Fetch data for all tickers in one batch request
        data = yf.download(tickers, period="1d", interval="1m", group_by="ticker")
        logger.info("Batch data downloaded successfully")

        # Process data for each ticker
        for ticker in tickers:
            ticker_data = data[ticker] if ticker in data else data
            if ticker_data is not None and not ticker_data.empty and "Close" in ticker_data.columns:
                # Get the last non-NaN closing price
                last_close = ticker_data["Close"].dropna().iloc[-1] if not ticker_data["Close"].isna().all() else None
                if last_close is not None:
                    prices[ticker] = last_close
                else:
                    # Fallback to previous close if no valid intraday data
                    stock = yf.Ticker(ticker)
                    prices[ticker] = stock.info.get("previousClose", None)
                    logger.info(f"Fallback to previous close for {ticker}: {prices[ticker]}")
            else:
                # Fallback if no intraday data is available
                stock = yf.Ticker(ticker)
                prices[ticker] = stock.info.get("previousClose", None)
                logger.info(f"Fallback to previous close for {ticker}: {prices[ticker]}")

        # Construct the response with prices and calculated ratios
        response_data = {
            "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),  # UTC timestamp without microseconds
            "Prices": prices,
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
        }

        # Update cache with fresh data
        cached_data = response_data
        cache_timestamp = datetime.now()

        logger.info(f"Returning fresh data: {response_data}")
        return jsonify(response_data)

    except Exception as e:
        # Handle any errors during data fetching
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    # Run the Flask app on the specified port (default 10000)
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
