# SignalEdge — AI F&O Trading Engine

Professional real-time F&O signal system for NSE & BSE.
Specialised in NIFTY 50, BANKNIFTY, SENSEX, FINNIFTY.

---

## QUICK START (Demo Mode)

1. Open `index.html` in Chrome or Edge
2. It auto-starts in Demo Mode with simulated real-time ticks
3. Switch to "Live Signals" tab to see active signals
4. Open "Option Chain" to see live OI data

---

## LIVE BROKER SETUP

### Option A: Zerodha Kite Connect

1. Register at https://kite.trade/
2. Create a new app → get your **API Key** and **API Secret**
3. Login via the Kite Connect OAuth flow to get an **Access Token**
   - Access token is valid for 1 trading day — regenerate daily
4. Paste into API Setup tab → click "Connect Zerodha"

**Kite WebSocket:** Streams NIFTY, BANKNIFTY, SENSEX ticks at ~100ms latency
**Token IDs subscribed:** 256265 (NIFTY), 260105 (BANKNIFTY), 408065 (SENSEX), 384537 (FINNIFTY)

### Option B: Upstox API v2

1. Register at https://upstox.com/developer/
2. Create app → get API Key
3. Use OAuth flow to get **Access Token**
4. Paste in API Setup tab → Connect Upstox

### Option C: Angel One SmartAPI

1. Register at https://smartapi.angelbroking.com/
2. Get API Key + Feed Token
3. Enter Client Code, API Key, and Feed Token
4. Click "Connect Angel One"

---

## IMPORTANT NOTES

**CORS / Browser Limitations:**
- WebSocket connections to broker APIs work from your LOCAL server
- If opening index.html directly as a file:// — broker WebSockets may be blocked by browser CORS
- Recommended: serve locally using any HTTP server:
  ```
  # Python 3
  python -m http.server 8080
  # Then open: http://localhost:8080
  ```
  Or use VS Code Live Server extension.

**Access Token Refresh:**
- Zerodha access tokens expire at 6:00 AM daily
- You must re-generate the access token each trading day
- This is a Zerodha API requirement — not a limitation of this app

---

## SIGNAL ENGINE

**Confidence Scoring:**
- Score ≥ 90% → ★ Confirmation Signal (all conditions aligned)
- Score ≥ 75% → Strong BUY/SELL
- Score 60–74% → Moderate signal
- Score < 60% → Signal suppressed

**Formula:**
```
Final Score = (Trend × 35%) + (Momentum × 25%) + (Volatility × 20%) + (Volume × 20%)
```

**Filters applied:**
- Minimum 3/4 timeframes must agree
- Trend + Volume must be aligned
- Sideways market filter (low ATR + flat EMA = no signal)
- IV filter (no options buying when IV > 25)

**Instruments selected:**
- BUY signal → 1 OTM CE option (ATM + 1 strike)
- SELL signal → 1 OTM PE option (ATM - 1 strike)

---

## ARCHITECTURE

```
index.html          ← Entry point
css/style.css       ← Dark terminal design
js/engine.js        ← Signal engine (indicators + scoring)
js/broker.js        ← WebSocket connections (Kite/Upstox/Angel/Demo)
js/ui.js            ← Chart rendering, option chain, alerts
js/app.js           ← State management, real-time orchestration
```

**Data flow:**
```
Broker WS → onTick() → State.ticks[]
                      → Engine.buildCandles() → State.candles[]
                      → runSignalEngine() every 500ms
                      → runUIUpdate() every 200ms → Chart + Panels
```

---

## DISCLAIMER

This application is for informational and educational purposes only.
All predictions are probabilistic — NOT guaranteed.
Always trade with proper risk management.
Past signal accuracy does not guarantee future results.
