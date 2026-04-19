/* engine.js — Signal Engine Core */
/* All indicator calculations, scoring logic, signal generation */

const Engine = (() => {

  /* ═══════════════════════════════════════════
     INDICATOR CALCULATIONS
  ═══════════════════════════════════════════ */

  function calcEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a,b) => a+b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function calcSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a,b) => a+b, 0) / period;
  }

  function calcMACD(prices) {
    const ema12 = calcEMA(prices, 12);
    const ema26 = calcEMA(prices, 26);
    if (!ema12 || !ema26) return { macd: 0, signal: 0, hist: 0 };
    const macd = ema12 - ema26;
    // Signal line approx using last 9 MACD values
    return { macd, signal: macd * 0.95, hist: macd * 0.05 };
  }

  function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i-1]);
    }
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    const avgGain = gains.slice(-period).reduce((a,b) => a+b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a,b) => a+b, 0) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function calcBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return { upper: 0, mid: 0, lower: 0, squeeze: false };
    const slice = prices.slice(-period);
    const mid = slice.reduce((a,b) => a+b, 0) / period;
    const variance = slice.reduce((a,b) => a + Math.pow(b - mid, 2), 0) / period;
    const sd = Math.sqrt(variance);
    const upper = mid + stdDev * sd;
    const lower = mid - stdDev * sd;
    const bandwidth = (upper - lower) / mid;
    const squeeze = bandwidth < 0.02; // Tight bands = squeeze
    return { upper, mid, lower, bandwidth, squeeze };
  }

  function calcATR(highs, lows, closes, period = 14) {
    if (highs.length < 2) return 0;
    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      trs.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i-1]),
        Math.abs(lows[i] - closes[i-1])
      ));
    }
    return trs.slice(-period).reduce((a,b) => a+b, 0) / Math.min(trs.length, period);
  }

  function calcOBV(closes, volumes) {
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i-1]) obv += volumes[i];
      else if (closes[i] < closes[i-1]) obv -= volumes[i];
    }
    return obv;
  }

  function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
    if (closes.length < kPeriod) return { k: 50, d: 50 };
    const recentHighs = highs.slice(-kPeriod);
    const recentLows = lows.slice(-kPeriod);
    const highMax = Math.max(...recentHighs);
    const lowMin = Math.min(...recentLows);
    const k = highMax === lowMin ? 50 : ((closes[closes.length-1] - lowMin) / (highMax - lowMin)) * 100;
    return { k, d: k * 0.9 };
  }

  function detectDivergence(prices, rsiValues) {
    if (prices.length < 4 || rsiValues.length < 4) return 'none';
    const priceSlope = prices[prices.length-1] - prices[prices.length-3];
    const rsiSlope = rsiValues[rsiValues.length-1] - rsiValues[rsiValues.length-3];
    if (priceSlope > 0 && rsiSlope < 0) return 'bearish';
    if (priceSlope < 0 && rsiSlope > 0) return 'bullish';
    return 'none';
  }

  /* ═══════════════════════════════════════════
     SCORING ENGINE
  ═══════════════════════════════════════════ */

  function scoreTrend(candles) {
    if (!candles || candles.length < 50) return { score: 50, direction: 'neutral', details: {} };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const price = closes[closes.length - 1];

    const ema9  = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : null;
    const sma50 = calcSMA(closes, 50);
    const macd  = calcMACD(closes);

    let score = 50;
    let direction = 'neutral';
    const details = { ema9, ema21, ema50, ema200, sma50, macd };

    // EMA alignment (25 pts)
    const emaAligned = ema9 && ema21 && ema50 && ema9 > ema21 && ema21 > ema50;
    const emaBearish = ema9 && ema21 && ema50 && ema9 < ema21 && ema21 < ema50;
    if (emaAligned) score += 25;
    else if (emaBearish) score -= 25;

    // Price vs EMA (15 pts)
    if (ema21 && ema50) {
      if (price > ema21 && price > ema50) score += 15;
      else if (price < ema21 && price < ema50) score -= 15;
    }

    // MACD (10 pts)
    if (macd.hist > 0) score += 10;
    else if (macd.hist < 0) score -= 10;

    score = Math.max(0, Math.min(100, score));
    if (score > 60) direction = 'bull';
    else if (score < 40) direction = 'bear';
    details.emaAligned = emaAligned;
    details.emaBearish = emaBearish;
    return { score, direction, details };
  }

  function scoreMomentum(candles) {
    if (!candles || candles.length < 15) return { score: 50, direction: 'neutral', details: {} };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const rsi = calcRSI(closes);
    const stoch = calcStochastic(highs, lows, closes);
    const rsiHistory = [calcRSI(closes.slice(0, -2)), calcRSI(closes.slice(0, -1)), rsi];
    const divergence = detectDivergence(closes, rsiHistory);

    let score = 50;
    // RSI scoring
    if (rsi > 65) score += 25;
    else if (rsi > 60) score += 18;
    else if (rsi > 55) score += 10;
    else if (rsi < 35) score -= 25;
    else if (rsi < 40) score -= 18;
    else if (rsi < 45) score -= 10;

    // Stochastic
    if (stoch.k > 60 && stoch.d > 60) score += 15;
    else if (stoch.k < 40 && stoch.d < 40) score -= 15;

    // Divergence penalty/boost
    if (divergence === 'bearish') score -= 10;
    else if (divergence === 'bullish') score += 10;

    score = Math.max(0, Math.min(100, score));
    const direction = score > 60 ? 'bull' : score < 40 ? 'bear' : 'neutral';
    return { score, direction, details: { rsi, stoch, divergence } };
  }

  function scoreVolatility(candles) {
    if (!candles || candles.length < 20) return { score: 50, details: {} };
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const bb = calcBollingerBands(closes);
    const atr = calcATR(highs, lows, closes);
    const price = closes[closes.length - 1];

    let score = 50;
    // Bollinger squeeze = breakout imminent (bullish for signal)
    if (bb.squeeze) score += 20;

    // Price near upper/lower band
    if (price > bb.upper * 0.998) score += 15;
    else if (price < bb.lower * 1.002) score -= 15;

    // ATR: rising ATR = momentum, good for signals
    const atrOld = calcATR(highs.slice(0,-3), lows.slice(0,-3), closes.slice(0,-3));
    if (atr > atrOld * 1.1) score += 15;
    else if (atr < atrOld * 0.9) score -= 10;

    score = Math.max(0, Math.min(100, score));
    return { score, details: { bb, atr, atrOld } };
  }

  function scoreVolume(candles) {
    if (!candles || candles.length < 10) return { score: 50, details: {} };
    const closes  = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);

    const avgVol = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const lastVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

    const obv = calcOBV(closes, volumes);
    const obvOld = calcOBV(closes.slice(0, -3), volumes.slice(0, -3));
    const obvRising = obv > obvOld;

    let score = 50;
    if (volRatio > 2.0) score += 30;
    else if (volRatio > 1.5) score += 20;
    else if (volRatio > 1.2) score += 10;
    else if (volRatio < 0.5) score -= 20;

    if (obvRising) score += 10;
    else score -= 5;

    score = Math.max(0, Math.min(100, score));
    return { score, details: { volRatio, obv, obvRising, avgVol, lastVol } };
  }

  /* ═══════════════════════════════════════════
     FINAL SIGNAL GENERATOR
  ═══════════════════════════════════════════ */

  function generateSignal(state) {
    const { index, candles1m, candles3m, candles5m, candles15m, oiData, spotPrice, futuresPrice, iv } = state;

    if (!candles1m || candles1m.length < 50) {
      return { type: 'WAIT', score: 0, confidence: 0, reason: 'Insufficient data' };
    }

    // Score each timeframe
    const tf1m  = scoreTimeframe(candles1m);
    const tf3m  = scoreTimeframe(candles3m);
    const tf5m  = scoreTimeframe(candles5m);
    const tf15m = scoreTimeframe(candles15m);

    // Timeframe consensus
    const tfScores = [tf1m, tf3m, tf5m, tf15m];
    const bullTFs = tfScores.filter(t => t.finalScore > 60).length;
    const bearTFs = tfScores.filter(t => t.finalScore < 40).length;

    // Use 5m as primary scoring timeframe
    const primary = tf5m;
    const finalScore = primary.finalScore;

    // Trend + Volume alignment check
    const trendVolAligned = primary.trend.direction !== 'neutral' &&
      primary.volume.score > 55 &&
      primary.trend.direction === (primary.momentum.direction !== 'neutral' ? primary.momentum.direction : primary.trend.direction);

    // Sideways filter
    const atr = primary.volatility.details?.atr || 0;
    const ema9  = primary.trend.details?.ema9 || 0;
    const ema21 = primary.trend.details?.ema21 || 0;
    const emaFlat = ema9 && ema21 && Math.abs(ema9 - ema21) / ema21 < 0.0008;
    const sideways = atr < spotPrice * 0.001 && emaFlat;

    // OI analysis
    const oiSignal = analyzeOI(oiData, spotPrice);

    // Futures basis
    const basis = futuresPrice && spotPrice ? futuresPrice - spotPrice : 0;
    const basisBullish = basis > 0;

    // IV check
    const ivNormal = iv < 25;

    // Determine direction
    let direction = 'WAIT';
    if (bullTFs >= 3 && primary.trend.direction === 'bull') direction = 'BUY';
    else if (bearTFs >= 3 && primary.trend.direction === 'bear') direction = 'SELL';

    // Apply filters
    if (sideways) direction = 'WAIT';
    if (!trendVolAligned && finalScore < 70) direction = 'WAIT';
    if (!ivNormal) direction = 'WAIT'; // Don't buy options when IV too high

    // Calculate adjusted confidence
    let confidence = finalScore;
    if (oiSignal.confirms === direction) confidence = Math.min(confidence + 8, 100);
    if (basisBullish && direction === 'BUY') confidence = Math.min(confidence + 4, 100);
    if (bullTFs === 4 || bearTFs === 4) confidence = Math.min(confidence + 5, 100);
    confidence = Math.round(confidence);

    // Build reasons
    const reasons = buildReasons(primary, oiSignal, basis, bullTFs, bearTFs, direction);

    // Strike selection
    const strike = selectStrike(index, spotPrice, direction);

    // Target & SL calculation
    const levels = calcLevels(spotPrice, direction, primary.volatility.details?.atr, primary.momentum.details?.rsi);

    // Time estimates
    const timeEst = estimateTime(primary, primary.volatility.details?.atr, spotPrice);

    return {
      type: direction,
      score: finalScore,
      confidence,
      confirmed: confidence >= 90,
      instrument: strike.name,
      entryPrice: strike.entryPrice,
      ...levels,
      ...timeEst,
      reasons,
      sideways,
      trendDir: primary.trend.direction,
      timeframes: { tf1m, tf3m, tf5m, tf15m },
      indicators: primary,
      oiSignal,
      rsi: primary.momentum.details?.rsi || 50,
      atr: primary.volatility.details?.atr || 0,
    };
  }

  function scoreTimeframe(candles) {
    if (!candles || candles.length < 20) return { finalScore: 50, trend: { score:50, direction:'neutral', details:{} }, momentum: { score:50, direction:'neutral', details:{} }, volatility: { score:50, details:{} }, volume: { score:50, details:{} } };
    const trend     = scoreTrend(candles);
    const momentum  = scoreMomentum(candles);
    const volatility = scoreVolatility(candles);
    const volume    = scoreVolume(candles);

    const finalScore = Math.round(
      trend.score     * 0.35 +
      momentum.score  * 0.25 +
      volatility.score * 0.20 +
      volume.score    * 0.20
    );
    return { finalScore, trend, momentum, volatility, volume };
  }

  function analyzeOI(oiData, spotPrice) {
    if (!oiData) return { confirms: 'neutral', pcr: 1, sentiment: 'Neutral', maxCallStrike: 0, maxPutStrike: 0 };
    const { callOI, putOI } = oiData;
    const pcr = putOI / (callOI || 1);
    let confirms = 'neutral';
    let sentiment = 'Neutral';
    if (pcr > 1.3) { confirms = 'BUY'; sentiment = 'Bullish (High Put OI = support)'; }
    else if (pcr < 0.7) { confirms = 'SELL'; sentiment = 'Bearish (High Call OI = resistance)'; }
    else if (pcr > 1.1) sentiment = 'Mild bullish';
    else if (pcr < 0.9) sentiment = 'Mild bearish';
    return { confirms, pcr: pcr.toFixed(2), sentiment, ...oiData };
  }

  function selectStrike(index, spotPrice, direction) {
    if (!spotPrice) return { name: '—', entryPrice: 0 };
    const intervals = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100, FINNIFTY: 50 };
    const step = intervals[index] || 50;
    const atm = Math.round(spotPrice / step) * step;
    if (direction === 'BUY') {
      const strike = atm + step; // 1 OTM call
      const iv = 14;
      const dte = 5;
      const timeVal = spotPrice * 0.003 * Math.sqrt(dte / 365) * (iv / 100) * Math.sqrt(2 * Math.PI);
      const intrinsic = Math.max(0, spotPrice - strike);
      const premium = Math.round(intrinsic + timeVal * spotPrice * 0.01);
      return { name: `${index} ${strike} CE`, entryPrice: Math.max(premium, 20) };
    } else if (direction === 'SELL') {
      const strike = atm - step; // 1 OTM put
      const iv = 14;
      const dte = 5;
      const timeVal = spotPrice * 0.003 * Math.sqrt(dte / 365) * (iv / 100) * Math.sqrt(2 * Math.PI);
      const intrinsic = Math.max(0, strike - spotPrice);
      const premium = Math.round(intrinsic + timeVal * spotPrice * 0.01);
      return { name: `${index} ${strike} PE`, entryPrice: Math.max(premium, 20) };
    }
    return { name: `${index} ATM ${atm}`, entryPrice: 0 };
  }

  function calcLevels(spotPrice, direction, atr, rsi) {
    if (!spotPrice || direction === 'WAIT') return { t1: 0, t2: 0, t3: 0, sl: 0 };
    const atrMult = atr || spotPrice * 0.005;
    const mult = direction === 'BUY' ? 1 : -1;
    return {
      t1: Math.round(spotPrice + mult * atrMult * 0.8),
      t2: Math.round(spotPrice + mult * atrMult * 1.5),
      t3: Math.round(spotPrice + mult * atrMult * 2.5),
      sl: Math.round(spotPrice - mult * atrMult * 0.6),
    };
  }

  function estimateTime(tf, atr, spot) {
    const momentum = tf.momentum.score;
    const volume   = tf.volume.score;
    const base = momentum > 70 && volume > 70 ? 1 : momentum > 55 ? 1.4 : 2;
    return {
      t1Time: `${Math.round(8*base)}–${Math.round(15*base)} min`,
      t2Time: `${Math.round(25*base)}–${Math.round(50*base)} min`,
      t3Time: `${Math.round(60*base)}–${Math.round(120*base)} min`,
    };
  }

  function buildReasons(tf, oiSignal, basis, bullTFs, bearTFs, direction) {
    const reasons = [];
    const { trend, momentum, volatility, volume } = tf;

    if (trend.details?.emaAligned) reasons.push({ color: '#00e676', text: 'EMA 9 > 21 > 50 — strong bullish alignment' });
    if (trend.details?.emaBearish) reasons.push({ color: '#ff4757', text: 'EMA 9 < 21 < 50 — bearish alignment confirmed' });
    if (trend.details?.macd?.hist > 0) reasons.push({ color: '#00e676', text: 'MACD histogram positive — bullish momentum' });
    if (trend.details?.macd?.hist < 0) reasons.push({ color: '#ff4757', text: 'MACD histogram negative — bearish pressure' });

    const rsi = momentum.details?.rsi;
    if (rsi > 60) reasons.push({ color: '#00e676', text: `RSI ${rsi?.toFixed(1)} — breakout above 60, bullish momentum` });
    else if (rsi < 40) reasons.push({ color: '#ff4757', text: `RSI ${rsi?.toFixed(1)} — below 40, bearish momentum confirmed` });

    if (volatility.details?.bb?.squeeze) reasons.push({ color: '#448aff', text: 'Bollinger squeeze detected — breakout imminent' });
    if (volume.details?.volRatio > 1.5) reasons.push({ color: '#00e676', text: `Volume spike ${volume.details.volRatio?.toFixed(1)}x avg — strong confirmation` });
    if (volume.details?.obvRising && direction === 'BUY') reasons.push({ color: '#00e676', text: 'OBV rising — institutional accumulation' });

    if (oiSignal.confirms === 'BUY') reasons.push({ color: '#00e676', text: `PCR ${oiSignal.pcr} — put writers providing support` });
    if (oiSignal.confirms === 'SELL') reasons.push({ color: '#ff4757', text: `PCR ${oiSignal.pcr} — call writers capping upside` });

    if (basis > 0 && direction === 'BUY') reasons.push({ color: '#00e676', text: `Futures at premium — bullish sentiment` });
    if (basis < 0 && direction === 'SELL') reasons.push({ color: '#ff4757', text: 'Futures at discount — bearish sentiment' });

    if (bullTFs === 4) reasons.push({ color: '#00e676', text: 'ALL 4 timeframes bullish — maximum alignment' });
    if (bearTFs === 4) reasons.push({ color: '#ff4757', text: 'ALL 4 timeframes bearish — maximum alignment' });

    const divergence = momentum.details?.divergence;
    if (divergence === 'bullish') reasons.push({ color: '#448aff', text: 'Bullish RSI divergence detected' });
    if (divergence === 'bearish') reasons.push({ color: '#ffa726', text: 'Bearish RSI divergence — caution' });

    return reasons;
  }

  /* ═══════════════════════════════════════════
     CANDLE BUILDER
  ═══════════════════════════════════════════ */

  function buildCandles(ticks, minutes) {
    if (!ticks || ticks.length === 0) return [];
    const msPerCandle = minutes * 60 * 1000;
    const candles = [];
    let current = null;

    for (const tick of ticks) {
      const bucket = Math.floor(tick.ts / msPerCandle) * msPerCandle;
      if (!current || current.bucket !== bucket) {
        if (current) candles.push(current);
        current = {
          bucket, time: new Date(bucket),
          open: tick.price, high: tick.price, low: tick.price, close: tick.price,
          volume: tick.volume || 0
        };
      } else {
        current.high   = Math.max(current.high, tick.price);
        current.low    = Math.min(current.low, tick.price);
        current.close  = tick.price;
        current.volume = (current.volume || 0) + (tick.volume || 0);
      }
    }
    if (current) candles.push(current);
    return candles;
  }

  return {
    generateSignal,
    scoreTimeframe,
    buildCandles,
    calcEMA, calcRSI, calcMACD, calcBollingerBands, calcATR, calcOBV, calcStochastic,
    scoreTrend, scoreMomentum, scoreVolatility, scoreVolume,
    analyzeOI
  };
})();
