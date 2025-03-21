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

        ratios = {
            "SPX/SPY Ratio": prices["^SPX"] / prices["SPY"] if prices["SPY"] else None,
            "ES/SPY Ratio": prices["ES=F"] / prices["SPY"] if prices["SPY"] else None,
            "NQ/QQQ Ratio": prices["NQ=F"] / prices["QQQ"] if prices["QQQ"] else None,
            "NDX/QQQ Ratio": prices["^NDX"] / prices["QQQ"] if prices["QQQ"] else None,
            "ES/SPX Ratio": prices["ES=F"] / prices["^SPX"] if prices["^SPX"] else None,
            "Datetime": datetime.now().strftime("%m/%d/%y %H:%M")
        }

        logger.info(f"Returning ratios: {ratios}")
        return jsonify(ratios)

    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": f"Failed to fetch data: {str(e)}"}), 500
