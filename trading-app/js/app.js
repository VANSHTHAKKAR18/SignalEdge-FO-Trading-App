/* app.js — Main Application Orchestrator */
/* State management, data flow, real-time processing loop */

const App = (() => {

  /* ═══════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════ */

  const MAX_TICKS = 5000; // Store max 5000 ticks per index (enough for 15m candles)
  const dirtyIndices = new Set(); // Track which indices need candle rebuilding

  const state = {
    activeIndex: 'NIFTY',
    activeTF: '5m',

    // Tick store — raw ticks per index
    ticks: {
      NIFTY: [], BANKNIFTY: [], SENSEX: [], FINNIFTY: []
    },

    // Current computed candles per timeframe per index
    candles: {
      NIFTY:      { '1m': [], '3m': [], '5m': [], '15m': [] },
      BANKNIFTY:  { '1m': [], '3m': [], '5m': [], '15m': [] },
      SENSEX:     { '1m': [], '3m': [], '5m': [], '15m': [] },
      FINNIFTY:   { '1m': [], '3m': [], '5m': [], '15m': [] },
    },

    // Latest prices
    prices: {
      NIFTY:     { spot: 0, futures: 0, prev: 0, high: 0, low: 0, open: 0, oi: 0, volume: 0 },
      BANKNIFTY: { spot: 0, futures: 0, prev: 0, high: 0, low: 0, open: 0, oi: 0, volume: 0 },
      SENSEX:    { spot: 0, futures: 0, prev: 0, high: 0, low: 0, open: 0, oi: 0, volume: 0 },
      FINNIFTY:  { spot: 0, futures: 0, prev: 0, high: 0, low: 0, open: 0, oi: 0, volume: 0 },
    },

    // Option chain data
    optionChain: {
      NIFTY: null, BANKNIFTY: null, SENSEX: null, FINNIFTY: null
    },

    // Signals
    signals: {
      NIFTY: null, BANKNIFTY: null, SENSEX: null, FINNIFTY: null
    },

    // VIX
    vix: 14.5,

    // Config
    confThreshold: 75,
    confirmThreshold: 90,

    // Tick rate tracking
    lastTickRateUpdate: Date.now(),
    lastSignalUpdate: { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0, FINNIFTY: 0 },
    lastAlertSignature: { NIFTY: '', BANKNIFTY: '', SENSEX: '', FINNIFTY: '' },
  };

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */

  function init() {
    UI.initCharts();
    setupNav();
    setupIndexTabs();
    setupTFTabs();
    setupBrokerSelect();
    setupSettings();

    // ═══════════════════════════════════════════
    // PRE-SEED HISTORICAL CANDLES
    // Generate candles directly (bypasses tick pipeline)
    // so charts + signal engine work on first paint
    // ═══════════════════════════════════════════
    preSeedCandles();
    dirtyIndices.clear(); // Prevent signal engine from overwriting pre-seeded candles

    // Init broker with callbacks
    Broker.init(onTick, onOIUpdate, onConnChange);

    // Start with demo mode
    Broker.connect('demo', {});

    // Run signal engine + UI once immediately
    runSignalEngine();
    setTimeout(() => {
      runUIUpdate();
      // Force chart render after frame
      const candles = state.candles[state.activeIndex][state.activeTF];
      if (candles && candles.length > 2) {
        UI.updateChart(candles, state.activeIndex);
      }
    }, 50);

    // Clock
    setInterval(UI.updateClock, 1000);
    UI.updateClock();

    // Tick rate display
    setInterval(() => {
      const rate = Broker.getTickRate();
      document.getElementById('tick-rate').textContent = `${rate}/s`;
      document.getElementById('latency').textContent = '< 5ms';
    }, 1000);

    // Signal engine loop — runs every 500ms (don't need per-tick)
    setInterval(runSignalEngine, 500);

    // UI update loop — chart + metrics updates every 200ms
    setInterval(runUIUpdate, 200);

    console.log('SignalEdge initialized');
  }

  /* ═══════════════════════════════════════════
     PRE-SEED HISTORICAL CANDLES
     Generates 5+ hrs of realistic OHLCV candles
     directly into state.candles for all indices
     and all timeframes so everything works on load
  ═══════════════════════════════════════════ */

  function preSeedCandles() {
    const now = Date.now();
    let seed = 42;
    function srand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    const configs = {
      NIFTY:     { base: 22650, vol: 0.0008, trend: 0.00005 },
      BANKNIFTY: { base: 48250, vol: 0.0012, trend: -0.00003 },
      SENSEX:    { base: 74800, vol: 0.0006, trend: 0.00003 },
      FINNIFTY:  { base: 21400, vol: 0.0009, trend: 0.00004 },
    };

    const timeframes = { '1m': 1, '3m': 3, '5m': 5, '15m': 15 };

    Object.entries(configs).forEach(([index, cfg]) => {
      // Generate 1m candles first (finest resolution), then aggregate up
      const oneMinCandles = [];
      let price = cfg.base;
      const totalBars = 340; // ~5.6 hours of 1m bars

      for (let i = 0; i < totalBars; i++) {
        const ts = now - (totalBars - i) * 60000;

        // Phase-based trend: 4 market phases
        const phase = Math.floor((i / totalBars) * 4);
        let drift = 0;
        if (phase === 0) drift = cfg.trend * 2;       // morning rally
        else if (phase === 1) drift = cfg.trend * -0.3; // consolidation
        else if (phase === 2) drift = cfg.trend * 4;    // afternoon breakout
        else drift = -cfg.trend * 1.5;                  // pullback to close

        // Micro-oscillation for realism
        drift += Math.sin(i * 0.15) * cfg.vol * 0.2;

        const move = price * (drift + (srand() - 0.5) * cfg.vol * 2);
        const open = price;
        price = price + move;
        const close = price;
        const high = Math.max(open, close) + Math.abs(move) * (0.3 + srand() * 0.7);
        const low = Math.min(open, close) - Math.abs(move) * (0.3 + srand() * 0.7);

        // Volume: higher in phases 0 and 2 (trending), spikes randomly
        const phaseVol = (phase === 0 || phase === 2) ? 1.5 : 0.8;
        const volSpike = srand() < 0.06 ? 3 : 1;
        const volume = Math.round((6000 + srand() * 8000) * phaseVol * volSpike);

        oneMinCandles.push({
          bucket: Math.floor(ts / 60000) * 60000,
          time: new Date(ts),
          open: parseFloat(open.toFixed(2)),
          high: parseFloat(high.toFixed(2)),
          low: parseFloat(low.toFixed(2)),
          close: parseFloat(close.toFixed(2)),
          volume,
        });
      }

      // Store 1m candles directly
      state.candles[index]['1m'] = oneMinCandles;

      // Aggregate to higher timeframes
      Object.entries(timeframes).forEach(([tf, mins]) => {
        if (mins === 1) return; // already done
        const agg = [];
        let cur = null;
        for (const c of oneMinCandles) {
          const bucket = Math.floor(c.bucket / (mins * 60000)) * (mins * 60000);
          if (!cur || cur.bucket !== bucket) {
            if (cur) agg.push(cur);
            cur = { bucket, time: new Date(bucket), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
          } else {
            cur.high = Math.max(cur.high, c.high);
            cur.low = Math.min(cur.low, c.low);
            cur.close = c.close;
            cur.volume += c.volume;
          }
        }
        if (cur) agg.push(cur);
        state.candles[index][tf] = agg;
      });

      // Set current price from last candle
      const lastCandle = oneMinCandles[oneMinCandles.length - 1];
      const p = state.prices[index];
      p.spot = lastCandle.close;
      p.prev = oneMinCandles[oneMinCandles.length - 2]?.close || lastCandle.close;
      p.open = oneMinCandles[0].open;
      p.high = Math.max(...oneMinCandles.map(c => c.high));
      p.low = Math.min(...oneMinCandles.map(c => c.low));
      p.futures = parseFloat((lastCandle.close * 1.002).toFixed(2));

      // Seed-populate some ticks for continuity with real-time loop
      const lastFew = oneMinCandles.slice(-5);
      lastFew.forEach(c => {
        state.ticks[index].push({ price: c.close, volume: c.volume, oi: 0, ts: c.bucket });
      });
    });

    // Set VIX
    state.vix = parseFloat((12 + srand() * 6).toFixed(2));

    console.log('Pre-seeded candles:', Object.entries(state.candles).map(([k,v]) => `${k}: 1m=${v['1m'].length} 5m=${v['5m'].length} 15m=${v['15m'].length}`).join(', '));
    console.log('NIFTY 5m candle sample:', JSON.stringify(state.candles.NIFTY['5m'].slice(-2)));
    console.log('Prices after preseed:', JSON.stringify({NIFTY: state.prices.NIFTY.spot, BANK: state.prices.BANKNIFTY.spot}));
  }

  /* ═══════════════════════════════════════════
     TICK HANDLER — called on EVERY tick
  ═══════════════════════════════════════════ */

  function onTick(tick) {
    const { index, price, volume, oi, high, low, open, ts, bid, ask } = tick;
    if (!index || !price) return;

    const p = state.prices[index];
    if (!p) return;

    p.prev = p.spot || price;
    p.spot = price;
    if (volume) p.volume = volume;
    if (oi) p.oi = oi;
    if (high) p.high = Math.max(p.high || price, high);
    if (low) p.low = p.low ? Math.min(p.low, low) : low;
    if (open && !p.open) p.open = open;

    // Store tick (candles are rebuilt periodically in signal engine loop, not per-tick)
    const ticks = state.ticks[index];
    ticks.push({ price, volume: volume || 0, oi: oi || 0, ts: ts || Date.now() });
    if (ticks.length > MAX_TICKS) ticks.shift();
    dirtyIndices.add(index);

    // Simulate futures price (spot + basis)
    const basisMap = { NIFTY: 0.002, BANKNIFTY: 0.0018, SENSEX: 0.0015, FINNIFTY: 0.002 };
    const noise = (Math.random() - 0.5) * 0.0002;
    p.futures = parseFloat((price * (1 + (basisMap[index] || 0.002) + noise)).toFixed(2));

    // Simulate VIX drift
    if (index === 'NIFTY') {
      state.vix = parseFloat((state.vix + (Math.random()-0.5)*0.01).toFixed(2));
      state.vix = Math.max(8, Math.min(40, state.vix));
    }
  }

  /* ═══════════════════════════════════════════
     OI UPDATE HANDLER
  ═══════════════════════════════════════════ */

  function onOIUpdate(data) {
    const { index, chain } = data;
    if (!index || !chain) return;
    state.optionChain[index] = chain;

    // If on option chain page and matches selected index, update
    const ocPage = document.getElementById('page-optionchain');
    if (ocPage?.classList.contains('active')) {
      const sel = document.getElementById('oc-index-sel')?.value || 'NIFTY';
      if (sel === index) {
        UI.renderOptionChain({ chain, spot: state.prices[index].spot });
      }
    }
  }

  /* ═══════════════════════════════════════════
     SIGNAL ENGINE LOOP
  ═══════════════════════════════════════════ */

  function appendTickToCandles(index) {
    // Append latest ticks to existing candle arrays instead of rebuilding from scratch.
    // This preserves pre-seeded historical candles.
    const ticks = state.ticks[index];
    if (ticks.length === 0) return;

    ['1m','3m','5m','15m'].forEach(tf => {
      const mins = parseInt(tf);
      const msPerCandle = mins * 60 * 1000;
      const candles = state.candles[index][tf];
      if (!candles || candles.length === 0) {
        // No pre-seeded data, build from ticks
        state.candles[index][tf] = Engine.buildCandles(ticks, mins);
        return;
      }

      // Get the last few ticks that are newer than the last candle
      const lastCandle = candles[candles.length - 1];
      const lastBucket = lastCandle.bucket;

      for (const tick of ticks) {
        const bucket = Math.floor(tick.ts / msPerCandle) * msPerCandle;
        if (bucket === lastBucket) {
          // Update existing last candle
          lastCandle.high = Math.max(lastCandle.high, tick.price);
          lastCandle.low = Math.min(lastCandle.low, tick.price);
          lastCandle.close = tick.price;
          lastCandle.volume = (lastCandle.volume || 0) + (tick.volume || 0);
        } else if (bucket > lastBucket) {
          // New candle
          candles.push({
            bucket, time: new Date(bucket),
            open: tick.price, high: tick.price, low: tick.price, close: tick.price,
            volume: tick.volume || 0,
          });
        }
      }

      // Keep max 500 candles
      if (candles.length > 500) candles.splice(0, candles.length - 500);
    });
  }

  function runSignalEngine() {
    // Append new ticks to existing candle arrays (preserves pre-seeded history)
    if (dirtyIndices.size > 0) {
      dirtyIndices.forEach(index => appendTickToCandles(index));
      dirtyIndices.clear();
    }

    const indices = ['NIFTY','BANKNIFTY','SENSEX','FINNIFTY'];

    indices.forEach(index => {
      const p = state.prices[index];
      if (!p.spot) return;

      const candles1m  = state.candles[index]['1m'];
      const candles3m  = state.candles[index]['3m'];
      const candles5m  = state.candles[index]['5m'];
      const candles15m = state.candles[index]['15m'];

      if (!candles5m || candles5m.length < 20) return;

      const oiData = state.optionChain[index] ?
        { callOI: state.optionChain[index].totalCeOI, putOI: state.optionChain[index].totalPeOI } :
        { callOI: 400000, putOI: 480000 }; // default bullish leaning

      const signal = Engine.generateSignal({
        index,
        candles1m,
        candles3m:  candles3m?.length >= 5  ? candles3m  : candles5m,
        candles5m,
        candles15m: candles15m?.length >= 5 ? candles15m : candles5m,
        oiData,
        spotPrice:    p.spot,
        futuresPrice: p.futures,
        iv: state.vix * 0.9,
      });

      signal.index = index;
      signal.basis = p.futures - p.spot;
      signal.iv = state.vix * 0.9;
      state.signals[index] = signal;

      // Fire alerts for new/changed signals
      checkAndFireAlerts(index, signal);
    });
  }

  function checkAndFireAlerts(index, signal) {
    if (!signal) return;
    const threshold = state.confThreshold;
    const confirmThreshold = state.confirmThreshold;

    // Signature = type + confidence band (prevents re-alerting same signal)
    const sig = `${signal.type}-${Math.floor(signal.confidence / 10)}`;
    if (sig === state.lastAlertSignature[index]) return;
    state.lastAlertSignature[index] = sig;

    if (signal.type !== 'WAIT' && signal.confidence >= confirmThreshold) {
      UI.addAlert('signal',
        `★ ${index} ${signal.type} CONFIRMED — ${signal.confidence}%`,
        `${signal.instrument} · Entry ₹${signal.entryPrice} · T1 ₹${signal.t1} · SL ₹${signal.sl}`
      );
    } else if (signal.type !== 'WAIT' && signal.confidence >= threshold) {
      UI.addAlert('signal',
        `${index} ${signal.type} Signal — ${signal.confidence}%`,
        `${signal.instrument} · Entry ₹${signal.entryPrice}`
      );
    }

    // Bollinger squeeze alert
    if (signal.indicators?.volatility?.details?.bb?.squeeze) {
      const sqSig = `squeeze-${index}`;
      if (sqSig !== state.lastAlertSignature[`bb-${index}`]) {
        state.lastAlertSignature[`bb-${index}`] = sqSig;
        UI.addAlert('info', `${index} Bollinger Squeeze`, 'Breakout expected — monitor closely');
      }
    }
  }

  /* ═══════════════════════════════════════════
     UI UPDATE LOOP — 200ms
  ═══════════════════════════════════════════ */

  function runUIUpdate() {
    const index = state.activeIndex;
    const p = state.prices[index];
    if (!p.spot) return;

    // Update top metrics
    const oi = state.optionChain[index];
    const pcr = oi ? (oi.totalPeOI / (oi.totalCeOI || 1)) : 1.1;
    UI.updateMetrics({
      index, spot: p.spot, futures: p.futures,
      prev: p.prev, prevSpot: p.prev,
      open: p.open, high: p.high, low: p.low,
      pcr, iv: state.vix * 0.9,
      atr: state.signals[index]?.atr,
      oiChange: (Math.random() - 0.48) * 20000,
    });

    UI.updateTopbarVIX(state.vix);

    // Update all tab prices
    ['NIFTY','BANKNIFTY','SENSEX','FINNIFTY'].forEach(idx => {
      const pp = state.prices[idx];
      if (!pp.spot) return;
      UI.updateMetrics({ index: idx, spot: pp.spot, prevSpot: pp.prev });
    });

    // Update signal panel if on dashboard
    const signal = state.signals[index];
    if (signal) {
      UI.updateSignalPanel(signal);
    }

    // Update chart (only if on dashboard)
    const dashPage = document.getElementById('page-dashboard');
    if (dashPage?.classList.contains('active')) {
      const tf = state.activeTF;
      const candles = state.candles[index][tf];
      if (!state._chartLogOnce) {
        console.log('Chart update check:', { index, tf, candlesExist: !!candles, candlesLen: candles?.length, dashActive: true });
        state._chartLogOnce = true;
      }
      if (candles && candles.length > 2) {
        UI.updateChart(candles, index);
      }
    }

    // Update signals list page
    const sigPage = document.getElementById('page-signals');
    if (sigPage?.classList.contains('active')) {
      const allSignals = Object.values(state.signals).filter(s => s && s.type !== 'WAIT' && s.confidence >= state.confThreshold);
      UI.renderSignalsList(allSignals);
    }

    // Update indicators page
    const indPage = document.getElementById('page-indicators');
    if (indPage?.classList.contains('active') && signal) {
      UI.renderIndicators(signal);
    }
  }

  /* ═══════════════════════════════════════════
     CONNECTION HANDLER
  ═══════════════════════════════════════════ */

  function onConnChange(status, broker) {
    UI.updateConnStatus(status, broker);
    if (status === 'live') {
      UI.addAlert('info', `Connected to ${broker}`, 'Real-time data streaming active');
    } else if (status === 'error') {
      UI.addAlert('warning', `${broker} connection error`, 'Retrying in 3 seconds…');
    } else if (status === 'demo') {
      UI.addAlert('info', 'Demo Mode Active', 'Simulated real-time data · Switch broker to go live');
    }
  }

  /* ═══════════════════════════════════════════
     NAVIGATION
  ═══════════════════════════════════════════ */

  function setupNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`page-${page}`)?.classList.add('active');
      });
    });
  }

  function setupIndexTabs() {
    document.querySelectorAll('.idx-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.idx-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.activeIndex = tab.dataset.index;
        UI.setCurrentIndex(state.activeIndex);
        // Force chart refresh
        const candles = state.candles[state.activeIndex][state.activeTF];
        if (candles?.length > 2) UI.updateChart(candles, state.activeIndex);
      });
    });

    document.getElementById('oc-index-sel')?.addEventListener('change', (e) => {
      const chain = state.optionChain[e.target.value];
      if (chain) UI.renderOptionChain({ chain, spot: state.prices[e.target.value].spot });
    });
  }

  function setupTFTabs() {
    document.querySelectorAll('.tf-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tf-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.activeTF = tab.dataset.tf;
      });
    });
  }

  function setupBrokerSelect() {
    document.getElementById('broker-select')?.addEventListener('change', (e) => {
      const broker = e.target.value;
      if (broker === 'demo') {
        enableDemo();
      } else {
        // Prompt to go to settings
        UI.addAlert('info', `Select ${broker} in API Setup`, 'Go to API Setup tab and enter your credentials');
        document.querySelector('[data-page="settings"]')?.click();
      }
    });
  }

  function setupSettings() {
    document.getElementById('conf-threshold')?.addEventListener('input', (e) => {
      state.confThreshold = parseInt(e.target.value);
    });
    document.getElementById('confirm-threshold')?.addEventListener('input', (e) => {
      state.confirmThreshold = parseInt(e.target.value);
    });
  }

  /* ═══════════════════════════════════════════
     BROKER CONNECT FUNCTIONS (called from HTML)
  ═══════════════════════════════════════════ */

  window.connectKite = function() {
    const apiKey = document.getElementById('kite-api-key')?.value?.trim();
    const apiSecret = document.getElementById('kite-api-secret')?.value?.trim();
    const accessToken = document.getElementById('kite-access-token')?.value?.trim();
    if (!apiKey || !accessToken) {
      UI.addAlert('warning', 'Missing credentials', 'Enter API Key and Access Token');
      return;
    }
    document.getElementById('broker-select').value = 'zerodha';
    Broker.connect('zerodha', { apiKey, apiSecret, accessToken });
    UI.addAlert('info', 'Connecting to Zerodha Kite…', 'WebSocket stream starting');
  };

  window.connectUpstox = function() {
    const accessToken = document.getElementById('upstox-token')?.value?.trim();
    if (!accessToken) { UI.addAlert('warning', 'Missing token', 'Enter Upstox access token'); return; }
    document.getElementById('broker-select').value = 'upstox';
    Broker.connect('upstox', { accessToken });
  };

  window.connectAngel = function() {
    const apiKey = document.getElementById('angel-api-key')?.value?.trim();
    const clientCode = document.getElementById('angel-client')?.value?.trim();
    if (!apiKey) { UI.addAlert('warning', 'Missing credentials', 'Enter Angel One API Key'); return; }
    document.getElementById('broker-select').value = 'angel';
    Broker.connect('angel', { apiKey, clientCode });
  };

  window.enableDemo = function() {
    document.getElementById('broker-select').value = 'demo';
    Broker.connect('demo', {});
  };

  window.saveSettings = function() {
    state.confThreshold = parseInt(document.getElementById('conf-threshold')?.value || 75);
    state.confirmThreshold = parseInt(document.getElementById('confirm-threshold')?.value || 90);
    UI.addAlert('info', 'Settings saved', `Signal threshold: ${state.confThreshold}% · Confirmation: ${state.confirmThreshold}%`);
  };

  /* ═══════════════════════════════════════════
     START
  ═══════════════════════════════════════════ */

  document.addEventListener('DOMContentLoaded', init);

})();
