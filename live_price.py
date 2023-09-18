import yfinance as yf
from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/get_live_ratio", methods=["GET"])
def get_live_ratio():
    spx_ticker = "^SPX"
    spy_ticker = "SPY"

    # Fetch the live prices
    spx_data = yf.Ticker(spx_ticker).history(period="1min")
    spy_data = yf.Ticker(spy_ticker).history(period="1min")

    # Extract the closing prices
    spx_price = spx_data["Close"].iloc[0]
    spy_price = spy_data["Close"].iloc[0]

    # Calculate the ratio
    ratio = spx_price / spy_price

    # Return the ratio as JSON
    return jsonify({"liveRatio": ratio})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
