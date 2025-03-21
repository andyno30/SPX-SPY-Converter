from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os
import logging

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Enable logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/get_live_price_pro')
def get_live_price_pro():
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}

    try:
        for ticker in tickers:
            stock = yf.Ticker(ticker)
            try:
                history = stock.history(period="1d")  # Fetch historical close price
                prices[ticker] = history["Close"].iloc[-1] if not history.empty else None
                logger.info(f"Successfully fetched price for {ticker}: {prices[ticker]}")
            except Exception as e:
                prices[ticker] = None
                logger.error(f"Failed to fetch price for {ticker}: {str(e)}")

        # Compute ratios only if prices exist
        ratios = {
            "SPX/SPY Ratio": (prices["^SPX"] / prices["SPY"]) if prices.get("^SPX") and prices.get("SPY") else None,
            "ES/SPY Ratio": (prices["ES=F"] / prices["SPY"]) if prices.get("ES=F") and prices.get("SPY") else None,
            "NQ/QQQ Ratio": (prices["NQ=F"] / prices["QQQ"]) if prices.get("NQ=F") and prices.get("QQQ") else None,
            "NDX/QQQ Ratio": (prices["^NDX"] / prices["QQQ"]) if prices.get("^NDX") and prices.get("QQQ") else None,
            "ES/SPX Ratio": (prices["ES=F"] / prices["^SPX"]) if prices.get("ES=F") and prices.get("^SPX") else None,
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        }

        logger.info(f"Returning ratios: {ratios}")
        return jsonify({"prices": prices, "ratios": ratios})

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
