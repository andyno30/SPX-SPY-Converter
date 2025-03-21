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

# Cache storage
cached_data = {"prices": {}, "ratios": {}, "last_updated": None}
CACHE_DURATION = timedelta(minutes=10)  # Cache for 10 minutes

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    
    # Use cached data if it's still fresh
    if cached_data["last_updated"] and datetime.now() - cached_data["last_updated"] < CACHE_DURATION:
        logger.info("Serving cached data")
        return jsonify(cached_data)

    prices = {}
    try:
        for ticker in tickers:
            stock = yf.Ticker(ticker)
            try:
                # Try multiple methods to get stock price
                price = None
                if "last_price" in stock.fast_info:
                    price = stock.fast_info["last_price"]
                elif "regularMarketPrice" in stock.info:
                    price = stock.info["regularMarketPrice"]
                elif not stock.history(period="1d").empty:
                    price = stock.history(period="1d")["Close"].iloc[-1]

                if price is not None:
                    prices[ticker] = price
                    logger.info(f"Successfully fetched price for {ticker}: {price}")
                else:
                    prices[ticker] = None
                    logger.warning(f"No price found for {ticker}")

            except Exception as e:
                prices[ticker] = None
                logger.error(f"Failed to fetch price for {ticker}: {str(e)}")

        # Calculate ratios
        ratios = {
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        }

        # Cache the response
        cached_data = {"prices": prices, "ratios": ratios, "last_updated": datetime.now()}
        logger.info(f"Updated cached data at {cached_data['last_updated']}")
        return jsonify(cached_data)

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
