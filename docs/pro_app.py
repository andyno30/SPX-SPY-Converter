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
CORS(app)

# Caching and concurrency settings
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)
cache_lock = Lock()
request_count = 0

# Scheduler to refresh data in background
scheduler = BackgroundScheduler()

# Safe division helper
def safe_div(a, b):
    try:
        return round(a / b, 5) if a is not None and b else None
    except Exception as e:
        logger.warning(f"Division error: {e}")
        return None

# Function to fetch & cache data
def refresh_data():
    global cached_data, cache_timestamp, request_count
    with cache_lock:
        try:
            tickers = ["^GSPC", "^NDX", "SPY", "QQQ", "ES=F", "NQ=F"]
            data = yf.download(tickers, period="1d", interval="1m", group_by="ticker", progress=False)
            request_count += 1
            logger.info(f"Batch data downloaded. Total requests: {request_count}")

            prices = {}
            for ticker in tickers:
                df = data[ticker] if ticker in data else data
                if df is not None and not df.empty and "Close" in df.columns:
                    prices[ticker] = df["Close"].dropna().iloc[-1]
                else:
                    prices[ticker] = None

            response_data = {
                "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "Prices": prices,
                "SPX/SPY Ratio": safe_div(prices["^GSPC"], prices["SPY"]),
                "ES/SPY Ratio": safe_div(prices["ES=F"], prices["SPY"]),
                "NQ/QQQ Ratio": safe_div(prices["NQ=F"], prices["QQQ"]),
                "NDX/QQQ Ratio": safe_div(prices["^NDX"], prices["QQQ"]),
                "ES/SPX Ratio": safe_div(prices["ES=F"], prices["^GSPC"]),
            }

            cached_data = response_data
            cache_timestamp = datetime.utcnow()
            logger.info("Cache refreshed")
        except Exception as e:
            logger.error(f"Error refreshing data: {e}")

# Start scheduler: refresh immediately and then every 60s
refresh_data()
scheduler.add_job(func=refresh_data, trigger='interval', seconds=60)
scheduler.start()

@app.route('/get_live_price_pro')
def get_live_price_pro():
    global cached_data, cache_timestamp
    # Serve cached data if exists
    if cached_data is not None:
        return jsonify(cached_data)
    return jsonify({"error": "Data not available"}), 503

@app.route('/')
def index():
    return '🟢 SpyConverter Pro backend is live!'

@app.route('/favicon.ico')
def favicon():
    return '', 204

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
