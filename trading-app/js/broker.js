/* broker.js — Real-Time Broker WebSocket Connections */
/* Zerodha Kite, Upstox, Angel One, Demo Mode */

const Broker = (() => {

  let ws = null;
  let mode = 'demo';
  let credentials = {};
  let onTickCallback = null;
  let onOICallback   = null;
  let onConnCallback = null;
  let reconnectTimer = null;
  let pingInterval   = null;
  let tickCount      = 0;
  let lastTickTime   = Date.now();

  /* ═══════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════ */

  function init(tickCb, oiCb, connCb) {
    onTickCallback = tickCb;
    onOICallback   = oiCb;
    onConnCallback = connCb;
  }

  function connect(broker, creds) {
    mode = broker;
    credentials = creds || {};
    disconnect();
    if (broker === 'demo') {
      startDemo();
    } else if (broker === 'zerodha') {
      connectKiteWS();
    } else if (broker === 'upstox') {
      connectUpstoxWS();
    } else if (broker === 'angel') {
      connectAngelWS();
    }
  }

  function disconnect() {
    if (ws) { try { ws.close(); } catch(e){} ws = null; }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingInterval) clearInterval(pingInterval);
  }

  function getTickRate() {
    const rate = tickCount;
    tickCount = 0;
    return rate;
  }

  /* ═══════════════════════════════════════════
     ZERODHA KITE WEBSOCKET
  ═══════════════════════════════════════════ */

  function connectKiteWS() {
    const { apiKey, accessToken } = credentials;
    if (!apiKey || !accessToken) {
      console.warn('Kite: No credentials. Falling back to demo.');
      startDemo(); return;
    }
    onConnCallback?.('connecting', 'Zerodha Kite');

    // Kite WebSocket URL
    const url = `wss://ws.kite.trade?api_key=${apiKey}&access_token=${accessToken}`;
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        onConnCallback?.('live', 'Zerodha Kite');
        // Subscribe to NIFTY 50 index (256265), BANKNIFTY (260105), SENSEX BSE (265)
        const tokens = [256265, 260105, 408065, 384537]; // NIFTY, BANKNIFTY, SENSEX, FINNIFTY
        const msg = { a: 'subscribe', v: tokens };
        const modeMsg = { a: 'mode', v: ['full', tokens] };
        ws.send(JSON.stringify(msg));
        ws.send(JSON.stringify(modeMsg));
        startPing();
      };

      ws.onmessage = (evt) => {
        if (!(evt.data instanceof ArrayBuffer)) return;
        const ticks = parseKiteBinary(evt.data);
        ticks.forEach(tick => {
          tickCount++;
          onTickCallback?.({
            index: tokenToIndex(tick.token),
            price: tick.lastPrice,
            volume: tick.volumeTraded,
            oi: tick.oi,
            high: tick.high,
            low: tick.low,
            open: tick.open,
            close: tick.close,
            ts: Date.now(),
            bid: tick.depth?.buy?.[0]?.price,
            ask: tick.depth?.sell?.[0]?.price,
          });
        });
      };

      ws.onerror = (e) => {
        onConnCallback?.('error', 'Zerodha Kite');
        scheduleReconnect(() => connectKiteWS());
      };

      ws.onclose = () => {
        onConnCallback?.('disconnected', 'Zerodha Kite');
        scheduleReconnect(() => connectKiteWS());
      };
    } catch(e) {
      console.error('Kite WS error:', e);
      startDemo();
    }
  }

  /* ═══════════════════════════════════════════
     ZERODHA BINARY PARSER
     Based on Kite Connect binary protocol
  ═══════════════════════════════════════════ */

  function parseKiteBinary(buf) {
    const view = new DataView(buf);
    const ticks = [];
    let offset = 0;
    if (buf.byteLength < 2) return ticks;

    const numPackets = view.getInt16(offset, false); offset += 2;
    for (let i = 0; i < numPackets; i++) {
      if (offset + 2 > buf.byteLength) break;
      const packetLen = view.getInt16(offset, false); offset += 2;
      if (offset + packetLen > buf.byteLength) break;

      const token = view.getInt32(offset, false);
      const divisor = (token & 0xFF) === 9 ? 10000000 : 100;
      const tick = {
        token,
        lastPrice: view.getInt32(offset + 4, false) / divisor,
        lastQty: view.getInt32(offset + 8, false),
        avgPrice: view.getInt32(offset + 12, false) / divisor,
        volumeTraded: view.getInt32(offset + 16, false),
        totalBuyQty: view.getInt32(offset + 20, false),
        totalSellQty: view.getInt32(offset + 24, false),
        open: view.getInt32(offset + 28, false) / divisor,
        high: view.getInt32(offset + 32, false) / divisor,
        low: view.getInt32(offset + 36, false) / divisor,
        close: view.getInt32(offset + 40, false) / divisor,
      };
      if (packetLen >= 184) {
        tick.oi = view.getInt32(offset + 144, false);
      }
      if (packetLen >= 184) {
        const depth = { buy: [], sell: [] };
        for (let j = 0; j < 5; j++) {
          const base = offset + 44 + j * 12;
          depth.buy.push({ qty: view.getInt32(base,false), price: view.getInt32(base+4,false)/divisor, orders: view.getInt16(base+8,false) });
        }
        for (let j = 0; j < 5; j++) {
          const base = offset + 44 + 60 + j * 12;
          depth.sell.push({ qty: view.getInt32(base,false), price: view.getInt32(base+4,false)/divisor, orders: view.getInt16(base+8,false) });
        }
        tick.depth = depth;
      }
      ticks.push(tick);
      offset += packetLen;
    }
    return ticks;
  }

  function tokenToIndex(token) {
    const map = { 256265: 'NIFTY', 260105: 'BANKNIFTY', 408065: 'SENSEX', 384537: 'FINNIFTY' };
    return map[token] || 'NIFTY';
  }

  /* ═══════════════════════════════════════════
     UPSTOX WEBSOCKET
  ═══════════════════════════════════════════ */

  function connectUpstoxWS() {
    const { accessToken } = credentials;
    if (!accessToken) { startDemo(); return; }
    onConnCallback?.('connecting', 'Upstox');

    // Upstox v2 WebSocket
    const url = `wss://api.upstox.com/v2/feed/market-data-feed`;
    try {
      ws = new WebSocket(url, [], { headers: { Authorization: `Bearer ${accessToken}` } });
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        onConnCallback?.('live', 'Upstox');
        // Subscribe to indices
        const subMsg = {
          guid: 'signalEdge_sub',
          method: 'sub',
          data: {
            instrumentKeys: [
              'NSE_INDEX|Nifty 50',
              'NSE_INDEX|Nifty Bank',
              'BSE_INDEX|SENSEX',
              'NSE_INDEX|Nifty Fin Service'
            ]
          }
        };
        ws.send(JSON.stringify(subMsg));
        startPing();
      };

      ws.onmessage = (evt) => {
        try {
          // Upstox sends protobuf - simplified JSON fallback
          const data = JSON.parse(new TextDecoder().decode(evt.data));
          if (data.feeds) {
            Object.entries(data.feeds).forEach(([key, feed]) => {
              tickCount++;
              onTickCallback?.({
                index: upstoxKeyToIndex(key),
                price: feed.ff?.marketFF?.ltpc?.ltp,
                volume: feed.ff?.marketFF?.marketOHLC?.ohlc?.[0]?.volume,
                ts: Date.now(),
              });
            });
          }
        } catch(e) {}
      };

      ws.onerror = () => { onConnCallback?.('error', 'Upstox'); scheduleReconnect(() => connectUpstoxWS()); };
      ws.onclose = () => { onConnCallback?.('disconnected', 'Upstox'); scheduleReconnect(() => connectUpstoxWS()); };
    } catch(e) { startDemo(); }
  }

  function upstoxKeyToIndex(key) {
    if (key.includes('Nifty 50')) return 'NIFTY';
    if (key.includes('Nifty Bank')) return 'BANKNIFTY';
    if (key.includes('SENSEX')) return 'SENSEX';
    if (key.includes('Fin')) return 'FINNIFTY';
    return 'NIFTY';
  }

  /* ═══════════════════════════════════════════
     ANGEL ONE SMARTAPI
  ═══════════════════════════════════════════ */

  function connectAngelWS() {
    const { apiKey, clientCode, feedToken } = credentials;
    if (!apiKey || !feedToken) { startDemo(); return; }
    onConnCallback?.('connecting', 'Angel One');

    const url = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${apiKey}`;
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        onConnCallback?.('live', 'Angel One');
        // Subscribe to NIFTY, BANKNIFTY
        const sub = {
          action: 1, params: {
            mode: 3,
            tokenList: [
              { exchangeType: 1, tokens: ['99926000','99926009'] }, // NSE NIFTY, BANKNIFTY
              { exchangeType: 3, tokens: ['99919000'] }  // BSE SENSEX
            ]
          }
        };
        ws.send(JSON.stringify(sub));
        startPing();
      };

      ws.onmessage = (evt) => {
        if (!(evt.data instanceof ArrayBuffer)) return;
        const tick = parseAngelBinary(evt.data);
        if (tick) {
          tickCount++;
          onTickCallback?.(tick);
        }
      };

      ws.onerror = () => { onConnCallback?.('error', 'Angel One'); scheduleReconnect(() => connectAngelWS()); };
      ws.onclose = () => { onConnCallback?.('disconnected', 'Angel One'); scheduleReconnect(() => connectAngelWS()); };
    } catch(e) { startDemo(); }
  }

  function parseAngelBinary(buf) {
    const view = new DataView(buf);
    if (buf.byteLength < 10) return null;
    const token = '';
    const ltp = view.getInt32(4, false) / 100;
    return {
      index: 'NIFTY',
      price: ltp,
      ts: Date.now(),
    };
  }

  /* ═══════════════════════════════════════════
     DEMO MODE — REALISTIC SIMULATION
     Real market hours, real price patterns,
     tick-level simulation (50ms intervals)
  ═══════════════════════════════════════════ */

  let demoIntervals = [];
  const demoState = {
    NIFTY:      { price: 22650, trend: 0.0003, vol: 15, oi: 18500000, volume: 0 },
    BANKNIFTY:  { price: 48250, trend: -0.0002, vol: 22, oi: 9800000, volume: 0 },
    SENSEX:     { price: 74800, trend: 0.0001, vol: 12, oi: 4200000, volume: 0 },
    FINNIFTY:   { price: 21400, trend: 0.0002, vol: 18, oi: 3100000, volume: 0 },
  };

  let demoPhase = 0; // cycles through trending/ranging/volatile phases

  function startDemo() {
    mode = 'demo';
    onConnCallback?.('demo', 'Demo Mode');

    // Clear old intervals
    demoIntervals.forEach(clearInterval);
    demoIntervals = [];

    // ═══════════════════════════════════════════
    // PRE-SEED HISTORICAL DATA
    // Generate 5 hours of synthetic ticks so charts,
    // indicators, and signal engine work immediately
    // ═══════════════════════════════════════════
    preSeedHistoricalTicks();

    // Fire initial OI data immediately
    Object.keys(demoState).forEach(index => {
      const s = demoState[index];
      const spot = s.price;
      const step = index === 'BANKNIFTY' ? 100 : index === 'SENSEX' ? 100 : 50;
      const atm = Math.round(spot / step) * step;
      const chain = generateDemoOptionChain(index, spot, atm, step);
      onOICallback?.({ index, chain, spot });
    });

    // Simulate realistic tick stream — every 200ms per index (5 ticks/sec)
    Object.keys(demoState).forEach(index => {
      const interval = setInterval(() => {
        const s = demoState[index];
        const now = new Date();
        const hour = now.getHours();
        const min  = now.getMinutes();

        // Market hours 9:15–15:30 IST
        const marketOpen = (hour === 9 && min >= 15) || (hour >= 10 && hour < 15) || (hour === 15 && min <= 30);

        // Simulate realistic price movement
        const phase = Math.floor(Date.now() / 120000) % 4; // changes every 2 min
        let drift = 0;
        if (phase === 0) drift = s.trend;      // trending
        else if (phase === 1) drift = 0;        // ranging
        else if (phase === 2) drift = s.trend * 2; // strong trend
        else drift = -s.trend;                  // reversal

        // Random walk with drift
        const noise = (Math.random() - 0.5) * s.price * (s.vol / 10000);
        const driftAmt = s.price * drift;
        const newPrice = Math.max(s.price * 0.97, Math.min(s.price * 1.03, s.price + driftAmt + noise));
        s.price = parseFloat(newPrice.toFixed(2));

        // Volume spike simulation
        const baseVol = marketOpen ? (phase === 0 || phase === 2 ? 15000 : 8000) : 0;
        const volSpike = Math.random() < 0.05 ? baseVol * 3 : 0;
        s.volume = Math.round(baseVol + volSpike + Math.random() * 3000);

        // OI changes
        s.oi = Math.round(s.oi + (Math.random() - 0.49) * 10000);

        tickCount++;
        onTickCallback?.({
          index,
          price: s.price,
          volume: s.volume,
          oi: s.oi,
          high: s.price * (1 + s.vol / 20000),
          low: s.price * (1 - s.vol / 20000),
          open: s.price * (1 + (Math.random()-0.5) * 0.001),
          close: s.price,
          ts: Date.now(),
          bid: s.price - 0.5,
          ask: s.price + 0.5,
          demo: true,
        });
      }, 200);
      demoIntervals.push(interval);
    });

    // Simulate OI data every 2 seconds
    const oiInterval = setInterval(() => {
      Object.keys(demoState).forEach(index => {
        const s = demoState[index];
        const spot = s.price;
        const step = index === 'BANKNIFTY' ? 100 : index === 'SENSEX' ? 100 : 50;
        const atm = Math.round(spot / step) * step;
        const chain = generateDemoOptionChain(index, spot, atm, step);
        onOICallback?.({ index, chain, spot });
      });
    }, 2000);
    demoIntervals.push(oiInterval);
  }

  /* ═══════════════════════════════════════════
     HISTORICAL TICK PRE-SEEDER
     Generates 5 hours of realistic price history
     with trends, reversals, mean reversion, and
     volume patterns so all indicators work on load
  ═══════════════════════════════════════════ */

  function preSeedHistoricalTicks() {
    const now = Date.now();
    const HISTORY_MINUTES = 320; // ~5.3 hours — enough for 60+ candles on 5m timeframe
    const TICKS_PER_MINUTE = 5;  // 5 ticks per minute of history
    const totalTicks = HISTORY_MINUTES * TICKS_PER_MINUTE;

    // Seeded random for reproducible patterns
    let seed = 42;
    function seededRandom() {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    Object.keys(demoState).forEach(index => {
      const s = demoState[index];
      const startPrice = s.price;
      let price = startPrice * (1 - 0.003); // Start slightly below current
      const volBase = s.vol;

      for (let i = 0; i < totalTicks; i++) {
        const progress = i / totalTicks; // 0 → 1
        const ts = now - (HISTORY_MINUTES * 60 * 1000) + (i * (HISTORY_MINUTES * 60 * 1000 / totalTicks));

        // Multi-phase price simulation
        // Phase 0: gentle uptrend, Phase 1: consolidation, Phase 2: strong move, Phase 3: pullback
        const cyclePos = (progress * 4) % 1; // position within current cycle
        const cycleNum = Math.floor(progress * 4); // which cycle
        let drift = 0;
        let volMult = 1;

        if (cycleNum === 0) {
          // Morning drift up
          drift = s.trend * 1.5;
          volMult = 1.2;
        } else if (cycleNum === 1) {
          // Consolidation with slight oscillation
          drift = Math.sin(cyclePos * Math.PI * 4) * s.trend * 0.5;
          volMult = 0.7;
        } else if (cycleNum === 2) {
          // Strong trending move
          drift = s.trend * 3;
          volMult = 1.8;
        } else {
          // Mean reversion / pullback toward current price
          const distFromTarget = (startPrice - price) / startPrice;
          drift = distFromTarget * 0.003;
          volMult = 1.0;
        }

        // Random walk with structured drift
        const noise = (seededRandom() - 0.5) * price * (volBase / 8000);
        const driftAmt = price * drift;
        price = Math.max(price * 0.96, Math.min(price * 1.04, price + driftAmt + noise));
        price = parseFloat(price.toFixed(2));

        // Realistic intra-candle high/low spread
        const spread = price * (volBase / 15000) * (0.5 + seededRandom());
        const high = price + spread;
        const low = price - spread;

        // Volume pattern: higher at open/close of candles, spikes randomly
        const baseVol = 8000 + seededRandom() * 5000;
        const spike = seededRandom() < 0.04 ? baseVol * 3 : 0;
        const volume = Math.round((baseVol + spike) * volMult);

        // OI drift
        s.oi = Math.round(s.oi + (seededRandom() - 0.49) * 8000);

        onTickCallback?.({
          index,
          price,
          volume,
          oi: s.oi,
          high,
          low,
          open: price + (seededRandom() - 0.5) * spread * 0.3,
          close: price,
          ts,
          bid: price - 0.5,
          ask: price + 0.5,
          demo: true,
        });
      }

      // Update demoState to current price so real-time ticks continue from here
      s.price = price;
    });
  }

  function generateDemoOptionChain(index, spot, atm, step) {
    const strikes = [];
    for (let i = -8; i <= 8; i++) {
      const strike = atm + i * step;
      const itmCE = Math.max(0, spot - strike);
      const itmPE = Math.max(0, strike - spot);
      const dist = Math.abs(spot - strike);
      const timeVal = Math.max(5, (spot * 0.003) * Math.exp(-dist / (spot * 0.02)));

      const ceLTP = Math.round(itmCE + timeVal + Math.random() * 5);
      const peLTP = Math.round(itmPE + timeVal + Math.random() * 5);

      // Higher OI near ATM
      const oiWeight = Math.exp(-Math.pow(dist / (spot * 0.015), 2));
      const baseOI = 300000;
      const ceOI = Math.round(baseOI * oiWeight * (1 + Math.random() * 0.3));
      const peOI = Math.round(baseOI * oiWeight * (1 + Math.random() * 0.3));

      strikes.push({
        strike, atm: i === 0,
        ce: { ltp: ceLTP, oi: ceOI, iv: (12 + Math.abs(i) * 0.8 + Math.random()).toFixed(1), change: ((Math.random()-0.5)*10).toFixed(2) },
        pe: { ltp: peLTP, oi: peOI, iv: (12 + Math.abs(i) * 0.8 + Math.random()).toFixed(1), change: ((Math.random()-0.5)*10).toFixed(2) },
      });
    }

    // Find max OI strikes
    const maxCeOI = strikes.reduce((max, s) => s.ce.oi > max.oi ? { strike: s.strike, oi: s.ce.oi } : max, { strike: 0, oi: 0 });
    const maxPeOI = strikes.reduce((max, s) => s.pe.oi > max.oi ? { strike: s.strike, oi: s.pe.oi } : max, { strike: 0, oi: 0 });

    const totalCeOI = strikes.reduce((a,s) => a + s.ce.oi, 0);
    const totalPeOI = strikes.reduce((a,s) => a + s.pe.oi, 0);

    return { strikes, maxCeOI, maxPeOI, totalCeOI, totalPeOI };
  }

  function startPing() {
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ a: 'ping' }));
      }
    }, 5000);
  }

  function scheduleReconnect(fn) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(fn, 3000);
  }

  return { init, connect, disconnect, getTickRate };
})();
