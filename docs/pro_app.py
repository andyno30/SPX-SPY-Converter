from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import logging
from threading import Lock
from apscheduler.schedulers.background import BackgroundScheduler

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS

# Shared state for cached data
data_lock = Lock()
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)

# Tracking requests for diagnostic
request_count = 0

# Tickers to fetch
TICKERS = ["^GSPC", "SPY", "ES=F", "NQ=F", "QQQ", "^NDX"]

# Safe division helper
def safe_div(a, b):
    try:
        return round(a / b, 6) if a is not None and b else None
    except Exception as e:
        logger.warning(f"Division error: {e}")
        return None

# Function to refresh data in background
def refresh_data():
    global cached_data, cache_timestamp, request_count
    logger.info("Background refresh_data triggered")
    try:
        # Download minute data for today
        data = yf.download(tickers=TICKERS, period="1d", interval="1m", group_by="ticker", progress=False)
        request_count += 1
        logger.info(f"yfinance download succeeded. Total requests: {request_count}")

        prices = {}
        for ticker in TICKERS:
            try:
                df = data[ticker]
                last = df['Close'].dropna().iloc[-1]
                prices[ticker] = float(last)
            except Exception:
                # fallback to previousClose
                stock = yf.Ticker(ticker)
                prices[ticker] = stock.info.get('previousClose')
                logger.info(f"Fallback price for {ticker}: {prices[ticker]}")

        # Prepare response payload
        new_payload = {
            "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "Prices": prices,
            "SPX/SPY Ratio": safe_div(prices.get("^GSPC"), prices.get("SPY")),
            "ES/SPY Ratio": safe_div(prices.get("ES=F"), prices.get("SPY")),
            "NQ/QQQ Ratio": safe_div(prices.get("NQ=F"), prices.get("QQQ")),
            "NDX/QQQ Ratio": safe_div(prices.get("^NDX"), prices.get("QQQ")),
            "ES/SPX Ratio": safe_div(prices.get("ES=F"), prices.get("^GSPC")),
        }

        # Update shared cache
        with data_lock:
            cached_data = new_payload
            cache_timestamp = datetime.utcnow()
        logger.info("Cached data updated")

    except Exception as e:
        logger.error(f"Error in background refresh: {e}")

# Start scheduler
scheduler = BackgroundScheduler()
scheduler.add_job(refresh_data, 'interval', seconds=60, next_run_time=datetime.utcnow())
scheduler.start()

# Initial data load
refresh_data()

@app.route('/get_live_price_pro')
def get_live_price_pro():
    # Return cached data if available
    with data_lock:
        if cached_data is not None:
            return jsonify(cached_data)
    return jsonify({"error": "Data not yet available"}), 503

@app.route('/')
def index():
    return '🟢 SpyConverter Pro backend is live!'

@app.route('/favicon.ico')
def favicon():
    return '', 204

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)

