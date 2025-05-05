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

# Shared state for cache
tick_lock = Lock()
cached_data = None
cache_timestamp = None
CACHE_DURATION = timedelta(seconds=60)

def safe_div(a, b):
    try:
        return round(a / b, 5) if a is not None and b else None
    except Exception as e:
        logger.warning(f"Division error: {e}")
        return None

def refresh_data():
    global cached_data, cache_timestamp
    tickers = ["^GSPC", "^NDX", "SPY", "QQQ", "ES=F", "NQ=F"]
    logger.info("Background refresh: fetching yfinance data")
    try:
        data = yf.download(
            tickers,
            period="1d",
            interval="1m",
            group_by="ticker",
            progress=False
        )
        prices = {}
        for t in tickers:
            try:
                prices[t] = data[t]["Close"].dropna().iloc[-1]
            except:
                prices[t] = None

        new_cache = {
            "Datetime": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "Prices": prices,
            "SPX/SPY Ratio": safe_div(prices["^GSPC"], prices["SPY"]),
            "ES/SPY Ratio": safe_div(prices["ES=F"], prices["SPY"]),
            "NQ/QQQ Ratio": safe_div(prices["NQ=F"], prices["QQQ"]),
            "NDX/QQQ Ratio": safe_div(prices["^NDX"], prices["QQQ"]),
            "ES/SPX Ratio": safe_div(prices["ES=F"], prices["^GSPC"]),
        }

        with tick_lock:
            cached_data = new_cache
            cache_timestamp = datetime.utcnow()
        logger.info("Cache refreshed successfully")
    except Exception as e:
        logger.error(f"Background refresh failed: {e}")

# **This ensures each Gunicorn worker runs the scheduler before serving**
@app.before_serving
def start_scheduler():
    # initial fetch in this worker
    refresh_data()
    # schedule recurring refreshes
    sched = BackgroundScheduler()
    sched.add_job(refresh_data, 'interval', seconds=CACHE_DURATION.total_seconds())
    sched.start()

@app.route('/get_live_price_pro')
def get_live_price_pro():
    with tick_lock:
        if cached_data is not None:
            age = (datetime.utcnow() - cache_timestamp).total_seconds()
            if age > CACHE_DURATION.total_seconds() * 1.5:
                return jsonify({"error": "Data stale"}), 503
            return jsonify(cached_data)
        else:
            return jsonify({"error": "Data not yet available"}), 503

@app.route('/')
def index():
    return '🟢 SpyConverter Pro backend is live!'

@app.route('/favicon.ico')
def favicon():
    return '', 204

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)
