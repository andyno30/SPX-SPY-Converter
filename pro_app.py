from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import os  # For environment variables

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "https://spyconverter.com"}})

@app.route('/get_live_price_pro')
def get_live_price_pro():
    tickers = ["^SPX", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]
    prices = {}

    try:
        for ticker in tickers:
            stock = yf.Ticker(ticker)
            stock_info = stock.fast_info
            prices[ticker] = stock_info.get("last_price", None)

        ratios = {
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices.get("SPY") else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices.get("SPY") else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices.get("QQQ") else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices.get("QQQ") else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices.get("^SPX") else None,
        }

        return jsonify({
            "prices": prices,
            "ratios": ratios,
            "datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        })

    except Exception as e:
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500

@app.route('/')
def health_check():
    return jsonify({"message": "Premium Conversion API is running!"})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))  # Use Render's PORT or default to 10000 locally
    app.run(host='0.0.0.0', port=port)
