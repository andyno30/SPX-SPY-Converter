from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)  # Enabling CORS for all routes, same as app.py

@app.route('/get_live_price_pro')
def get_live_price_pro():
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}
    
    try:
        for ticker in tickers:
            stock = yf.Ticker(ticker)
            try:
                prices[ticker] = stock.fast_info["last_price"]  # Live last trade price
            except (KeyError, AttributeError, Exception):
                prices[ticker] = None  # Fallback to None if fast_info fails
            
        # Calculate ratios
        ratios = {
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        }

        return jsonify(ratios)

    except Exception as e:
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))  # Your original port setup
    app.run(host='0.0.0.0', port=port)
