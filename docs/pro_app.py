from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import os
import logging
import pandas as pd
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
request_count = 0  # Track API requests

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp, request_count

    # Check cache
    if cached_data is not None and cache_timestamp is not None:
        if datetime.now() - cache_timestamp < CACHE_DURATION:
            logger.info("Serving data from cache")
            return jsonify(cached_data)

    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}

    try:
        # Fetch data with retry logic
        for attempt in range(3):
            try:
                data = yf.download(tickers, period="1d", interval="1m", group_by="ticker")
                request_count += 1
                logger.info(f"Batch data downloaded successfully. Total requests: {request_count}")
                break
            except Exception as e:
                if "Too Many Requests" in str(e):
                    logger.warning(f"Rate limit hit on attempt {attempt + 1}. Waiting 10 seconds...")
                    time.sleep(10)
                    if attempt == 2 and cached_data is not None:
                        logger.info("Max retries reached, serving cached data")
                        return jsonify(cached_data)
                    continue
                raise e

        # Process data
        for ticker in tickers:
            ticker_data = data[ticker] if ticker in data else data
            if ticker_data is not None and not ticker_data.empty and "Close" in ticker_data.columns:
                last_close = ticker_data["Close"].dropna().iloc[-1] if not ticker_data["Close"].isna().all() else None
                if last_close is not None:
                    prices[ticker] = last_close
                else:
                    stock = yf.Ticker(ticker)
                    prices[ticker] = stock.info.get("previousClose", None)
                    logger.info(f"Fallback to previous close for {ticker}: {prices[ticker]}")
            else:
                stock = yf.Ticker(ticker)
                prices[ticker] = stock.info.get("previousClose", None)
                logger.info(f"Fallback to previous close for {ticker}: {prices[ticker]}")

        # Construct response
        response_data = {
            "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
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
        if cached_data is not None:
            logger.info("Serving cached data due to fetch error")
            return jsonify(cached_data)
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
