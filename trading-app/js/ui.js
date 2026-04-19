/* ui.js — UI Rendering Engine */
/* Chart.js price/volume charts, option chain, indicators, alerts */

const UI = (() => {

  let priceChart = null;
  let volumeChart = null;
  let currentIndex = 'NIFTY';
  const MAX_CANDLES_CHART = 80;

  /* ═══════════════════════════════════════════
     CHART INIT
  ═══════════════════════════════════════════ */

  function initCharts() {
    const priceCtx = document.getElementById('priceChart')?.getContext('2d');
    const volCtx   = document.getElementById('volumeChart')?.getContext('2d');
    if (!priceCtx || !volCtx) return;

    Chart.defaults.color = '#4a5568';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';

    priceChart = new Chart(priceCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Price', data: [], borderColor: '#00e676',
            borderWidth: 1.5, fill: true,
            backgroundColor: (ctx) => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.chartArea?.height || 200);
              g.addColorStop(0, 'rgba(0,230,118,0.15)');
              g.addColorStop(1, 'rgba(0,230,118,0.0)');
              return g;
            },
            pointRadius: 0, tension: 0.3,
          },
          {
            label: 'EMA9', data: [], borderColor: '#ff9800',
            borderWidth: 1, fill: false, pointRadius: 0, tension: 0.3,
            borderDash: []
          },
          {
            label: 'EMA21', data: [], borderColor: '#448aff',
            borderWidth: 1, fill: false, pointRadius: 0, tension: 0.3,
          },
          {
            label: 'BB Upper', data: [], borderColor: 'rgba(255,255,255,0.15)',
            borderWidth: 0.8, fill: false, pointRadius: 0, tension: 0.3, borderDash: [3,3],
          },
          {
            label: 'BB Lower', data: [], borderColor: 'rgba(255,255,255,0.15)',
            borderWidth: 0.8, fill: false, pointRadius: 0, tension: 0.3, borderDash: [3,3],
          },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111827',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleFont: { family: "'IBM Plex Mono', monospace", size: 11 },
            bodyFont: { family: "'IBM Plex Mono', monospace", size: 11 },
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}`
            }
          }
        },
        scales: {
          x: {
            display: true, grid: { display: false },
            ticks: { maxTicksLimit: 8, font: { size: 10, family: "'IBM Plex Mono', monospace" }, color: '#4a5568' }
          },
          y: {
            display: true,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { font: { size: 10, family: "'IBM Plex Mono', monospace" }, color: '#4a5568' }
          }
        }
      }
    });

    volumeChart = new Chart(volCtx, {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Volume', data: [], backgroundColor: [], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });
  }

  function updateChart(candles, index) {
    if (!priceChart || !candles || candles.length < 2) return;
    const slice = candles.slice(-MAX_CANDLES_CHART);
    const closes = slice.map(c => c.close);
    const highs = slice.map(c => c.high || c.close);
    const lows  = slice.map(c => c.low || c.close);
    const labels = slice.map(c => {
      const d = new Date(c.bucket || c.time);
      return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    });

    // Calculate overlays
    const ema9s = closes.map((_,i) => i >= 9 ? Engine.calcEMA(closes.slice(0, i+1), 9) : null);
    const ema21s = closes.map((_,i) => i >= 21 ? Engine.calcEMA(closes.slice(0, i+1), 21) : null);
    const bb = closes.map((_,i) => {
      if (i < 20) return { upper: null, lower: null };
      const res = Engine.calcBollingerBands(closes.slice(0, i+1));
      return { upper: res.upper, lower: res.lower };
    });

    priceChart.data.labels = labels;
    priceChart.data.datasets[0].data = closes;
    priceChart.data.datasets[1].data = ema9s;
    priceChart.data.datasets[2].data = ema21s;
    priceChart.data.datasets[3].data = bb.map(b => b.upper);
    priceChart.data.datasets[4].data = bb.map(b => b.lower);
    priceChart.update('none');

    // Volume chart
    const volumes = slice.map(c => c.volume || 0);
    const avgVol = volumes.reduce((a,b) => a+b, 0) / volumes.length;
    volumeChart.data.labels = labels;
    volumeChart.data.datasets[0].data = volumes;
    volumeChart.data.datasets[0].backgroundColor = volumes.map(v =>
      v > avgVol * 1.5 ? 'rgba(0,230,118,0.6)' : 'rgba(255,255,255,0.1)'
    );
    volumeChart.update('none');
  }

  /* ═══════════════════════════════════════════
     SIGNAL PANEL
  ═══════════════════════════════════════════ */

  function updateSignalPanel(signal) {
    if (!signal) return;

    // Score arc
    const arc = document.getElementById('score-arc');
    const scoreNum = document.getElementById('score-num');
    if (arc && scoreNum) {
      const pct = signal.confidence / 100;
      const dash = 314 * pct;
      arc.style.strokeDashoffset = 314 - dash;
      arc.style.stroke = signal.confidence >= 90 ? '#00e676' :
                         signal.confidence >= 75 ? '#448aff' :
                         signal.confidence >= 60 ? '#ffa726' : '#ff4757';
      scoreNum.textContent = signal.confidence;
    }

    // Badge
    const badge = document.getElementById('signal-badge');
    if (badge) {
      badge.textContent = signal.type;
      badge.className = `signal-badge-large ${signal.type}`;
    }

    // Instrument & entry
    setText('signal-instrument', signal.instrument || '—');
    setText('signal-entry', signal.entryPrice ? `₹${signal.entryPrice}` : '—');
    setText('sig-refresh', `Updated ${new Date().toLocaleTimeString('en-IN')}`);

    // Targets
    if (signal.type !== 'WAIT') {
      setText('t1-price', `₹${signal.t1 || '—'}`);
      setText('t2-price', `₹${signal.t2 || '—'}`);
      setText('t3-price', `₹${signal.t3 || '—'}`);
      setText('t1-time', signal.t1Time || '—');
      setText('t2-time', signal.t2Time || '—');
      setText('t3-time', signal.t3Time || '—');
      if (signal.t1 && signal.entryPrice) {
        const pct1 = ((signal.t1 - signal.entryPrice) / signal.entryPrice * 100).toFixed(1);
        const pct2 = ((signal.t2 - signal.entryPrice) / signal.entryPrice * 100).toFixed(1);
        const pct3 = ((signal.t3 - signal.entryPrice) / signal.entryPrice * 100).toFixed(1);
        setText('t1-pct', `+${pct1}%`);
        setText('t2-pct', `+${pct2}%`);
        setText('t3-pct', `+${pct3}%`);
      }
      setText('sl-price', `₹${signal.sl || '—'}`);
      if (signal.sl && signal.entryPrice) {
        const slPct = ((signal.sl - signal.entryPrice) / signal.entryPrice * 100).toFixed(1);
        setText('sl-pct', `${slPct}%`);
      }
    } else {
      ['t1-price','t2-price','t3-price','t1-time','t2-time','t3-time','t1-pct','t2-pct','t3-pct','sl-price','sl-pct'].forEach(id => setText(id, '—'));
    }

    // Confirmation banner
    const banner = document.getElementById('confirm-banner');
    if (banner) {
      banner.style.display = signal.confirmed ? 'flex' : 'none';
      if (signal.confirmed) {
        const desc = `${signal.type} ${signal.instrument} · ${signal.confidence}% confidence · All conditions aligned`;
        setText('confirm-desc', desc);
      }
    }

    // Score breakdown
    const tf = signal.indicators;
    if (tf) {
      updateBar('bk-trend', 'bk-trend-val', tf.trend.score);
      updateBar('bk-mom', 'bk-mom-val', tf.momentum.score);
      updateBar('bk-vol', 'bk-vol-val', tf.volatility.score);
      updateBar('bk-volm', 'bk-volm-val', tf.volume.score);
    }

    // Reasons
    const reasonsList = document.getElementById('reasons-list');
    if (reasonsList && signal.reasons) {
      reasonsList.innerHTML = signal.reasons.slice(0,6).map(r =>
        `<div class="reason-item"><div class="reason-dot" style="background:${r.color}"></div>${r.text}</div>`
      ).join('');
    }

    // Timeframes
    if (signal.timeframes) {
      const tfs = {
        '1m': signal.timeframes.tf1m,
        '3m': signal.timeframes.tf3m,
        '5m': signal.timeframes.tf5m,
        '15m': signal.timeframes.tf15m,
      };
      let bullCount = 0, bearCount = 0;
      Object.entries(tfs).forEach(([tf, data]) => {
        const id = tf.replace('m','m');
        const s = data?.finalScore || 50;
        const dir = s >= 60 ? 'BULL' : s <= 40 ? 'BEAR' : 'NEUT';
        const color = s >= 60 ? '#00e676' : s <= 40 ? '#ff4757' : '#ffa726';
        const sigEl = document.getElementById(`mtf-${tf}-sig`);
        const scoreEl = document.getElementById(`mtf-${tf}-score`);
        const cell = document.getElementById(`mtf-${tf}`);
        if (sigEl) { sigEl.textContent = dir; sigEl.style.color = color; }
        if (scoreEl) { scoreEl.textContent = s; scoreEl.style.color = '#4a5568'; }
        if (cell) cell.style.borderColor = s >= 60 ? 'rgba(0,230,118,0.3)' : s <= 40 ? 'rgba(255,71,87,0.3)' : 'transparent';
        if (dir === 'BULL') bullCount++;
        if (dir === 'BEAR') bearCount++;
      });
      const alignCount = signal.type === 'BUY' ? bullCount : signal.type === 'SELL' ? bearCount : 0;
      setText('mtf-summary', alignCount >= 3
        ? `${alignCount}/4 timeframes ${signal.type === 'BUY' ? 'bullish' : 'bearish'} — signal confirmed`
        : `${alignCount}/4 timeframes agree — insufficient alignment`
      );
    }
  }

  function updateBar(barId, valId, score) {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    if (bar) {
      bar.style.width = `${score}%`;
      bar.style.background = score >= 65 ? '#00e676' : score >= 50 ? '#448aff' : '#ff4757';
    }
    if (val) {
      val.textContent = Math.round(score);
      val.className = `bk-val ${score >= 65 ? 'text-green' : score < 40 ? 'text-red' : 'text-amber'}`;
    }
  }

  /* ═══════════════════════════════════════════
     METRICS
  ═══════════════════════════════════════════ */

  function updateMetrics(data) {
    const { index, spot, futures, pcr, iv, atr, oiChange, prevSpot } = data;
    const chg = spot && prevSpot ? spot - prevSpot : 0;
    const chgPct = prevSpot ? (chg / prevSpot * 100) : 0;
    const isUp = chg >= 0;
    const color = isUp ? '#00e676' : '#ff4757';
    const sign  = isUp ? '+' : '';

    // Tab prices
    const tabPrice = document.getElementById(`tab-price-${index}`);
    const tabChg   = document.getElementById(`tab-chg-${index}`);
    if (tabPrice) { tabPrice.textContent = formatPrice(spot); tabPrice.style.color = color; }
    if (tabChg)   { tabChg.textContent = `${sign}${chgPct.toFixed(2)}%`; tabChg.style.color = color; }

    if (index !== currentIndex) return;

    // Chart header
    setStyleText('chart-price', formatPrice(spot), 'color', color);
    setStyleText('chart-chg', `${sign}${chg.toFixed(2)} (${sign}${chgPct.toFixed(2)}%)`, 'color', color);
    document.getElementById('chart-index-label').textContent = index;

    // Metric cards
    setVal('m-spot', formatPrice(spot), color);
    setVal('m-spot-sub', `Open: ${formatPrice(data.open || spot)}`);
    setVal('m-fut', formatPrice(futures));
    const basis = futures && spot ? futures - spot : 0;
    setVal('m-fut-sub', `Basis: ${basis >= 0 ? '+' : ''}${basis.toFixed(2)} (${basis >= 0 ? '▲ Bullish' : '▼ Bearish'})`);
    const pcrColor = pcr > 1.2 ? '#00e676' : pcr < 0.8 ? '#ff4757' : '#ffa726';
    setVal('m-pcr', pcr?.toFixed(2) || '—', pcrColor);
    setVal('m-pcr-sub', pcr > 1.2 ? 'Bullish sentiment' : pcr < 0.8 ? 'Bearish sentiment' : 'Neutral');
    setVal('m-iv', `${iv?.toFixed(1) || '—'}%`);
    setVal('m-iv-sub', iv > 20 ? 'High IV — avoid buying' : iv > 15 ? 'Elevated IV' : 'Normal IV');
    setVal('m-atr', atr?.toFixed(2) || '—');
    setVal('m-atr-sub', atr > 50 ? 'High volatility' : 'Normal range');
    const oiColor = (oiChange || 0) > 0 ? '#00e676' : '#ff4757';
    setVal('m-oi', oiChange ? `${oiChange > 0 ? '+' : ''}${(oiChange/1000).toFixed(1)}K` : '—', oiColor);
    setVal('m-oi-sub', (oiChange || 0) > 0 ? 'Long buildup' : 'Short buildup / unwinding');
  }

  function updateTopbarVIX(vix) {
    setStyleText('vix-val', vix?.toFixed(2) || '—', 'color', vix > 20 ? '#ff4757' : vix > 15 ? '#ffa726' : '#00e676');
  }

  /* ═══════════════════════════════════════════
     OPTION CHAIN
  ═══════════════════════════════════════════ */

  function renderOptionChain(data) {
    const { chain, spot } = data;
    if (!chain || !chain.strikes) return;
    const body = document.getElementById('option-chain-body');
    if (!body) return;

    const maxCeStrike = chain.maxCeOI?.strike;
    const maxPeStrike = chain.maxPeOI?.strike;
    const atm = chain.strikes.find(s => s.atm)?.strike;

    body.innerHTML = chain.strikes.map(s => {
      const isAtm = s.atm;
      const isMaxCe = s.strike === maxCeStrike;
      const isMaxPe = s.strike === maxPeStrike;
      const rowClass = isAtm ? 'oc-row atm' : isMaxCe ? 'oc-row max-call-oi' : isMaxPe ? 'oc-row max-put-oi' : 'oc-row';
      const cePct = chain.totalCeOI ? ((s.ce.oi / chain.totalCeOI) * 100).toFixed(1) : '0';
      const pePct = chain.totalPeOI ? ((s.pe.oi / chain.totalPeOI) * 100).toFixed(1) : '0';
      const ceChgClass = parseFloat(s.ce.change) >= 0 ? 'oc-change pos' : 'oc-change neg';
      const peChgClass = parseFloat(s.pe.change) >= 0 ? 'oc-change pos' : 'oc-change neg';
      const ceOIBar = `<div style="height:3px;background:rgba(255,71,87,${Math.min(1, s.ce.oi/500000)});border-radius:1px;margin-top:2px;"></div>`;
      const peOIBar = `<div style="height:3px;background:rgba(0,230,118,${Math.min(1, s.pe.oi/500000)});border-radius:1px;margin-top:2px;"></div>`;

      return `<div class="${rowClass}">
        <div class="oc-ce-data">
          <div class="oc-cell">${formatOI(s.ce.oi)}${ceOIBar}</div>
          <div class="oc-cell ${ceChgClass}">${s.ce.change}%</div>
          <div class="oc-cell">${s.ce.iv}%</div>
          <div class="oc-cell oc-ltp" style="color:#ff4757">₹${s.ce.ltp}</div>
        </div>
        <div class="oc-strike-cell">${s.strike}${isAtm ? '<br><span style="font-size:0.55rem;color:#ff6b35">ATM</span>' : ''}</div>
        <div class="oc-pe-data">
          <div class="oc-cell oc-ltp" style="color:#00e676">₹${s.pe.ltp}</div>
          <div class="oc-cell">${s.pe.iv}%</div>
          <div class="oc-cell ${peChgClass}">${s.pe.change}%</div>
          <div class="oc-cell">${formatOI(s.pe.oi)}${peOIBar}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ═══════════════════════════════════════════
     INDICATORS PAGE
  ═══════════════════════════════════════════ */

  function renderIndicators(signal) {
    const grid = document.getElementById('ind-grid');
    if (!grid || !signal?.indicators) return;
    const tf = signal.indicators;
    const { trend, momentum, volatility, volume } = tf;

    const cards = [
      {
        title: 'Trend Indicators (35%)',
        items: [
          { label: 'EMA 9', val: trend.details?.ema9?.toFixed(2) || '—', sig: trend.direction === 'bull' ? 'BULL' : trend.direction === 'bear' ? 'BEAR' : 'NEUT' },
          { label: 'EMA 21', val: trend.details?.ema21?.toFixed(2) || '—', sig: '' },
          { label: 'EMA 50', val: trend.details?.ema50?.toFixed(2) || '—', sig: '' },
          { label: 'EMA Alignment', val: trend.details?.emaAligned ? 'Bullish' : trend.details?.emaBearish ? 'Bearish' : 'Neutral', sig: trend.details?.emaAligned ? 'BULL' : trend.details?.emaBearish ? 'BEAR' : 'NEUT' },
          { label: 'MACD Histogram', val: trend.details?.macd?.hist?.toFixed(4) || '—', sig: (trend.details?.macd?.hist || 0) > 0 ? 'BULL' : 'BEAR' },
          { label: 'Trend Score', val: trend.score?.toFixed(0), sig: trend.score >= 65 ? 'BULL' : trend.score < 40 ? 'BEAR' : 'NEUT' },
        ]
      },
      {
        title: 'Momentum Indicators (25%)',
        items: [
          { label: 'RSI (14)', val: momentum.details?.rsi?.toFixed(1) || '—', sig: (momentum.details?.rsi || 50) > 60 ? 'BULL' : (momentum.details?.rsi || 50) < 40 ? 'BEAR' : 'NEUT' },
          { label: 'Stochastic %K', val: momentum.details?.stoch?.k?.toFixed(1) || '—', sig: (momentum.details?.stoch?.k || 50) > 60 ? 'BULL' : (momentum.details?.stoch?.k || 50) < 40 ? 'BEAR' : 'NEUT' },
          { label: 'Stochastic %D', val: momentum.details?.stoch?.d?.toFixed(1) || '—', sig: '' },
          { label: 'RSI Divergence', val: momentum.details?.divergence || 'None', sig: momentum.details?.divergence === 'bullish' ? 'BULL' : momentum.details?.divergence === 'bearish' ? 'BEAR' : 'NEUT' },
          { label: 'Momentum Score', val: momentum.score?.toFixed(0), sig: momentum.score >= 65 ? 'BULL' : momentum.score < 40 ? 'BEAR' : 'NEUT' },
        ]
      },
      {
        title: 'Volatility Indicators (20%)',
        items: [
          { label: 'Bollinger Upper', val: volatility.details?.bb?.upper?.toFixed(2) || '—', sig: '' },
          { label: 'Bollinger Lower', val: volatility.details?.bb?.lower?.toFixed(2) || '—', sig: '' },
          { label: 'BB Bandwidth', val: volatility.details?.bb?.bandwidth?.toFixed(4) || '—', sig: '' },
          { label: 'BB Squeeze', val: volatility.details?.bb?.squeeze ? 'YES — Breakout near' : 'No', sig: volatility.details?.bb?.squeeze ? 'BULL' : 'NEUT' },
          { label: 'ATR (14)', val: volatility.details?.atr?.toFixed(2) || '—', sig: (volatility.details?.atr || 0) > (volatility.details?.atrOld || 0) ? 'BULL' : 'NEUT' },
          { label: 'Volatility Score', val: volatility.score?.toFixed(0), sig: volatility.score >= 65 ? 'BULL' : 'NEUT' },
        ]
      },
      {
        title: 'Volume Indicators (20%)',
        items: [
          { label: 'Vol Ratio vs Avg', val: volume.details?.volRatio?.toFixed(2) + 'x' || '—', sig: (volume.details?.volRatio || 1) > 1.5 ? 'BULL' : (volume.details?.volRatio || 1) < 0.7 ? 'BEAR' : 'NEUT' },
          { label: 'OBV Trend', val: volume.details?.obvRising ? 'Rising' : 'Falling', sig: volume.details?.obvRising ? 'BULL' : 'BEAR' },
          { label: 'Avg Volume', val: volume.details?.avgVol ? formatOI(volume.details.avgVol) : '—', sig: '' },
          { label: 'Last Candle Vol', val: volume.details?.lastVol ? formatOI(volume.details.lastVol) : '—', sig: '' },
          { label: 'Volume Score', val: volume.score?.toFixed(0), sig: volume.score >= 65 ? 'BULL' : volume.score < 40 ? 'BEAR' : 'NEUT' },
        ]
      },
      {
        title: 'F&O Analysis',
        items: [
          { label: 'PCR', val: signal.oiSignal?.pcr || '—', sig: parseFloat(signal.oiSignal?.pcr || 1) > 1.2 ? 'BULL' : parseFloat(signal.oiSignal?.pcr || 1) < 0.8 ? 'BEAR' : 'NEUT' },
          { label: 'OI Sentiment', val: signal.oiSignal?.sentiment || '—', sig: '' },
          { label: 'Futures Basis', val: signal.basis !== undefined ? `${signal.basis >= 0 ? '+' : ''}${signal.basis?.toFixed(2)}` : '—', sig: (signal.basis || 0) >= 0 ? 'BULL' : 'BEAR' },
          { label: 'IV Level', val: signal.iv ? `${signal.iv?.toFixed(1)}%` : '—', sig: (signal.iv || 0) < 15 ? 'BULL' : (signal.iv || 0) > 22 ? 'BEAR' : 'NEUT' },
        ]
      }
    ];

    grid.innerHTML = cards.map(card => `
      <div class="ind-card">
        <div class="ind-card-title">${card.title}</div>
        ${card.items.map(item => `
          <div class="ind-item">
            <span class="ind-item-label">${item.label}</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="ind-item-val ${item.sig === 'BULL' ? 'bull' : item.sig === 'BEAR' ? 'bear' : item.sig === 'NEUT' ? 'neut' : ''}">${item.val}</span>
              ${item.sig ? `<span class="ind-item-sig ${item.sig === 'BULL' ? 'sig-bull' : item.sig === 'BEAR' ? 'sig-bear' : 'sig-neut'}">${item.sig}</span>` : ''}
            </div>
          </div>`).join('')}
      </div>`).join('');
  }

  /* ═══════════════════════════════════════════
     SIGNALS PAGE
  ═══════════════════════════════════════════ */

  function renderSignalsList(signals) {
    const list = document.getElementById('signals-list');
    if (!list) return;
    if (!signals || signals.length === 0) {
      list.innerHTML = '<div style="color:#4a5568;font-size:0.8rem;padding:1rem">No active signals. Analyzing market conditions…</div>';
      return;
    }
    list.innerHTML = signals.map(sig => `
      <div class="signal-row ${sig.type === 'BUY' ? 'buy-sig' : sig.type === 'SELL' ? 'sell-sig' : 'wait-sig'}">
        <div>
          <div class="sig-dir-badge ${sig.type}">${sig.type}</div>
          ${sig.confirmed ? '<div style="font-size:0.6rem;color:#00e676;margin-top:4px;text-align:center">★ CONFIRMED</div>' : ''}
        </div>
        <div class="sig-details">
          <div class="sig-name">${sig.index} · ${sig.instrument}</div>
          <div style="font-size:0.7rem;color:#4a5568;margin:3px 0">${new Date().toLocaleTimeString('en-IN')}</div>
          <div class="sig-reasons-mini">${(sig.reasons || []).slice(0,3).map(r => `· ${r.text}`).join('<br>')}</div>
        </div>
        <div class="sig-metrics">
          <div class="sig-metric-row"><span>Entry</span><span style="color:#00e5ff">₹${sig.entryPrice || '—'}</span></div>
          <div class="sig-metric-row"><span>T1</span><span style="color:#00e676">₹${sig.t1 || '—'}</span></div>
          <div class="sig-metric-row"><span>T2</span><span style="color:#00e676">₹${sig.t2 || '—'}</span></div>
          <div class="sig-metric-row"><span>SL</span><span style="color:#ff4757">₹${sig.sl || '—'}</span></div>
          <div class="sig-metric-row"><span>ETA T1</span><span>${sig.t1Time || '—'}</span></div>
        </div>
        <div>
          <div class="sig-conf ${sig.confidence >= 90 ? 'text-green' : sig.confidence >= 75 ? 'text-blue' : 'text-amber'}">${sig.confidence}%</div>
          <div style="font-size:0.6rem;color:#4a5568;text-align:right;margin-top:2px">confidence</div>
        </div>
      </div>`).join('');
  }

  /* ═══════════════════════════════════════════
     ALERTS
  ═══════════════════════════════════════════ */

  const alertLog = [];
  let alertBadgeCount = 0;

  function addAlert(type, msg, detail) {
    const color = type === 'signal' ? '#00e676' : type === 'warning' ? '#ff4757' : type === 'oi' ? '#448aff' : '#ffa726';
    const now = new Date().toLocaleTimeString('en-IN');
    alertLog.unshift({ type, msg, detail, time: now, color });
    if (alertLog.length > 100) alertLog.pop();

    // Update badge
    alertBadgeCount++;
    const badge = document.getElementById('alert-badge');
    if (badge) badge.textContent = alertBadgeCount;

    // Render in alerts page
    const container = document.getElementById('alerts-container');
    if (container) {
      container.innerHTML = alertLog.map(a => `
        <div class="alert-entry">
          <div class="alert-dot-lg" style="background:${a.color}"></div>
          <div class="alert-content">
            <div class="alert-msg">${a.msg}</div>
            ${a.detail ? `<div class="alert-detail">${a.detail}</div>` : ''}
          </div>
          <div class="alert-time-str">${a.time}</div>
        </div>`).join('');
    }

    // Show toast
    showToast(type, msg, detail);

    // Play sound if enabled
    const soundEl = document.getElementById('sound-toggle');
    if (soundEl?.checked) playBeep(type);
  }

  function clearAlerts() {
    alertLog.length = 0;
    alertBadgeCount = 0;
    const badge = document.getElementById('alert-badge');
    if (badge) badge.textContent = '0';
    const container = document.getElementById('alerts-container');
    if (container) container.innerHTML = '';
  }
  window.clearAlerts = clearAlerts;

  /* ═══════════════════════════════════════════
     TOAST NOTIFICATIONS
  ═══════════════════════════════════════════ */

  function showToast(type, title, msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const colorClass = type === 'signal' ? 'green' : type === 'warning' ? 'red' : type === 'oi' ? 'blue' : 'amber';
    const icon = type === 'signal' ? '◎' : type === 'warning' ? '⚠' : type === 'oi' ? '⊞' : '◉';
    const toast = document.createElement('div');
    toast.className = `toast ${colorClass}`;
    toast.innerHTML = `<span class="toast-icon">${icon}</span><div class="toast-body"><div class="toast-title">${title}</div>${msg ? `<div class="toast-msg">${msg}</div>` : ''}</div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'toast-out 0.3s ease forwards'; setTimeout(() => toast.remove(), 300); }, 4000);
  }

  function playBeep(type) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = type === 'signal' ? 880 : type === 'warning' ? 440 : 660;
      gain.gain.value = 0.1;
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     CONNECTIVITY STATUS
  ═══════════════════════════════════════════ */

  function updateConnStatus(status, broker) {
    const dot  = document.getElementById('conn-dot');
    const text = document.getElementById('conn-text');
    const pill = document.getElementById('live-pill');
    if (!dot || !text) return;
    dot.className = `conn-dot ${status}`;
    text.textContent = status === 'live' ? `Live · ${broker}` :
                       status === 'demo' ? `Demo · ${broker}` :
                       status === 'connecting' ? 'Connecting…' :
                       status === 'error' ? 'Error — retrying' : 'Disconnected';
    if (pill) {
      pill.style.background = status === 'live' ? 'rgba(0,230,118,0.12)' : status === 'demo' ? 'rgba(255,167,38,0.12)' : 'rgba(255,71,87,0.12)';
      pill.style.color = status === 'live' ? '#00e676' : status === 'demo' ? '#ffa726' : '#ff4757';
      pill.innerHTML = `<span class="live-dot-anim" style="background:${status === 'live' ? '#00e676' : '#ffa726'}"></span> ${status.toUpperCase()}`;
    }
  }

  function updateClock() {
    const el = document.getElementById('market-time');
    const sess = document.getElementById('market-session');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false, timeZone:'Asia/Kolkata' });
    const h = now.getHours(), m = now.getMinutes();
    const isMarket = (h === 9 && m >= 15) || (h >= 10 && h < 15) || (h === 15 && m <= 30);
    if (sess) {
      sess.textContent = isMarket ? 'Market Open · NSE/BSE' : (h < 9 || (h === 9 && m < 15)) ? 'Pre-Market' : 'Market Closed';
      sess.style.color = isMarket ? '#00e676' : '#4a5568';
    }
  }

  /* ═══════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════ */

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setVal(id, val, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (color) el.style.color = color;
  }

  function setStyleText(id, val, prop, pval) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (prop && pval) el.style[prop] = pval;
  }

  function formatPrice(p) {
    if (!p) return '—';
    return p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatOI(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function setCurrentIndex(idx) { currentIndex = idx; }

  return {
    initCharts, updateChart, updateSignalPanel, updateMetrics,
    updateTopbarVIX, renderOptionChain, renderIndicators,
    renderSignalsList, addAlert, updateConnStatus, updateClock,
    setCurrentIndex, formatPrice, formatOI
  };
})();
