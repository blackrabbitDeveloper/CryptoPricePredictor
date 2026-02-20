/* ============================================================
   CryptoPricePredictor v2.1 — app.js
   
   Binance Public API · BTC / ETH / SOL
   Advanced TA: EMA(8/21/50), RSI(14), MACD(12/26/9),
     Bollinger(20,2), Stochastic(14,3), ATR(14), MeanRev(30d)
   
   Features:
     - 1m / 1h / 1d candlestick timeframes with overlays
     - Confidence dashboard per indicator
     - Prediction history with accuracy tracking
     - Mini sparkline on summary cards
     - 30s auto-refresh
   ============================================================ */

(() => {
  "use strict";

  // ── Config ─────────────────────────────────────────────
  const COINS = [
    { id: "BTC", symbol: "BTCUSDT", name: "Bitcoin",  icon: "₿" },
    { id: "ETH", symbol: "ETHUSDT", name: "Ethereum", icon: "Ξ" },
    { id: "SOL", symbol: "SOLUSDT", name: "Solana",   icon: "◎" },
  ];

  const TIMEFRAMES = {
    "1m": { interval: "1m", limit: 120, label: "1분봉" },
    "1h": { interval: "1h", limit: 168, label: "1시간봉" },
    "1d": { interval: "1d", limit: 90,  label: "1일봉" },
  };

  const REFRESH_MS = 30_000;
  const CACHE_TTL  = 20_000;
  const BINANCE    = "https://api.binance.com/api/v3";
  const HISTORY_KEY = "cpp_history_v2";
  const MAX_HISTORY = 100;

  // ── State ──────────────────────────────────────────────
  const cache    = new Map();
  const coinData = {};
  let activeCoin = null;
  let activeTF   = "1h";
  let history    = loadHistory();

  // ── Helpers ────────────────────────────────────────────
  function cached(key, ttl, fn) {
    const e = cache.get(key);
    if (e && Date.now() - e.ts < ttl) return Promise.resolve(e.data);
    return fn().then(d => { cache.set(key, { ts: Date.now(), data: d }); return d; });
  }

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function getTicker(sym) {
    return cached(`t:${sym}`, CACHE_TTL, () => fetchJSON(`${BINANCE}/ticker/24hr?symbol=${sym}`));
  }
  function getKlines(sym, interval, limit) {
    return cached(`k:${sym}:${interval}:${limit}`, CACHE_TTL, () =>
      fetchJSON(`${BINANCE}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
    );
  }

  function fmtUSD(v) {
    if (v == null || isNaN(v)) return "$—";
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: v >= 100 ? 2 : v >= 1 ? 3 : 4,
      maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 3 : 4,
    }).format(v);
  }
  function fmtPct(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
  function fmtNum(v, d = 2) { return v == null ? "—" : v.toFixed(d); }
  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  // ── Technical Indicators ───────────────────────────────
  function ema(data, period) {
    const k = 2 / (period + 1), r = [data[0]];
    for (let i = 1; i < data.length; i++) r.push(data[i] * k + r[i-1] * (1-k));
    return r;
  }

  function sma(data, period) {
    const r = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) { r.push(null); continue; }
      let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j];
      r.push(s / period);
    }
    return r;
  }

  function calcRSI(data, period = 14) {
    if (data.length < period + 1) return { value: 50, series: [] };
    const series = [];
    let gS = 0, lS = 0;
    for (let i = 1; i <= period; i++) { const d = data[i]-data[i-1]; d >= 0 ? gS += d : lS -= d; }
    let ag = gS/period, al = lS/period;
    for (let i = 0; i <= period; i++) series.push(50);
    for (let i = period+1; i < data.length; i++) {
      const d = data[i]-data[i-1];
      ag = (ag*(period-1) + Math.max(d,0))/period;
      al = (al*(period-1) + Math.max(-d,0))/period;
      series.push(al === 0 ? 100 : 100 - 100/(1 + ag/al));
    }
    return { value: series[series.length-1], series };
  }

  function calcMACD(data) {
    const e12 = ema(data,12), e26 = ema(data,26);
    const line = e12.map((v,i) => v - e26[i]);
    const sig = ema(line,9);
    const hist = line.map((v,i) => v - sig[i]);
    return { line: line[line.length-1], signal: sig[sig.length-1], histogram: hist[hist.length-1], histSeries: hist };
  }

  function calcBollinger(data, period = 20, mult = 2) {
    const mid = sma(data, period), upper = [], lower = [];
    for (let i = 0; i < data.length; i++) {
      if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
      let v = 0; for (let j = i-period+1; j<=i; j++) v += (data[j]-mid[i])**2;
      const std = Math.sqrt(v/period);
      upper.push(mid[i]+mult*std); lower.push(mid[i]-mult*std);
    }
    const lu = upper[upper.length-1]||data[data.length-1]*1.02;
    const ll = lower[lower.length-1]||data[data.length-1]*0.98;
    const lm = mid[mid.length-1]||data[data.length-1];
    return { upper, mid, lower, bbWidth: (lu-ll)/lm, pctB: (data[data.length-1]-ll)/(lu-ll||1), lastUpper: lu, lastLower: ll, lastMid: lm };
  }

  function calcStochastic(highs, lows, closes, kP = 14, dP = 3) {
    const kV = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < kP-1) { kV.push(50); continue; }
      let hh = -Infinity, ll = Infinity;
      for (let j = i-kP+1; j<=i; j++) { hh = Math.max(hh,highs[j]); ll = Math.min(ll,lows[j]); }
      kV.push(hh===ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
    }
    const dV = sma(kV.map(v=>v??50), dP);
    return { k: kV[kV.length-1], d: dV[dV.length-1]??50 };
  }

  function calcATR(highs, lows, closes, period = 14) {
    const trs = [highs[0]-lows[0]];
    for (let i = 1; i < closes.length; i++)
      trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
    const atr = ema(trs, period);
    return { value: atr[atr.length-1], series: atr };
  }

  // ── Prediction Engine v2 ──────────────────────────────
  function computePrediction(price, hCloses, dCloses, hHighs, hLows) {
    const ema8 = ema(hCloses,8), ema21 = ema(hCloses,21), ema50 = ema(hCloses,50);
    const emaCross821  = (ema8[ema8.length-1]-ema21[ema21.length-1])/price;
    const emaCross2150 = (ema21[ema21.length-1]-ema50[ema50.length-1])/price;
    const emaSignal = emaCross821*0.6 + emaCross2150*0.4;

    const rsiData = calcRSI(hCloses,14);
    let rsiSignal = 0;
    if (rsiData.value > 75) rsiSignal = -(rsiData.value-70)/100;
    else if (rsiData.value > 60) rsiSignal = -(rsiData.value-60)/200;
    else if (rsiData.value < 25) rsiSignal = (30-rsiData.value)/100;
    else if (rsiData.value < 40) rsiSignal = (40-rsiData.value)/200;

    const macd = calcMACD(hCloses);
    const macdSignal = macd.histogram / price;

    const bb = calcBollinger(hCloses,20,2);
    let bbSignal = 0;
    if (bb.pctB > 0.95) bbSignal = -(bb.pctB-0.8)*0.5;
    else if (bb.pctB < 0.05) bbSignal = (0.2-bb.pctB)*0.5;
    else bbSignal = (0.5-bb.pctB)*0.1;

    const stoch = calcStochastic(hHighs, hLows, hCloses, 14, 3);
    let stochSignal = 0;
    if (stoch.k > 80 && stoch.k > stoch.d) stochSignal = -0.02;
    else if (stoch.k < 20 && stoch.k < stoch.d) stochSignal = 0.02;

    const atr = calcATR(hHighs, hLows, hCloses, 14);
    const atrPct = atr.value / price;

    const dailyAvg = dCloses.reduce((s,v)=>s+v,0)/dCloses.length;
    const meanRevSignal = (dailyAvg-price)/dailyAvg;

    const mRaw = emaSignal*0.30 + rsiSignal*0.10 + macdSignal*0.25 + bbSignal*0.15 + stochSignal*0.10 + meanRevSignal*0.05;
    const oneMinute = price * (1 + mRaw * Math.min(atrPct*8, 0.03));

    const dRaw = emaSignal*0.20 + rsiSignal*0.15 + macdSignal*0.15 + bbSignal*0.15 + stochSignal*0.10 + meanRevSignal*0.20;
    const oneDay = price * (1 + dRaw * Math.min(atrPct*80, 0.15));

    const signals = {
      EMA:     { value: emaSignal,      direction: emaSignal>=0?"bullish":"bearish", strength: Math.min(Math.abs(emaSignal)*500,100) },
      RSI:     { value: rsiData.value,   direction: rsiSignal>0?"bullish":rsiSignal<0?"bearish":"neutral", strength: Math.min(Math.abs(rsiSignal)*400,100) },
      MACD:    { value: macd.histogram,  direction: macd.histogram>=0?"bullish":"bearish", strength: Math.min(Math.abs(macdSignal)*2000,100) },
      BB:      { value: bb.pctB,         direction: bbSignal>0?"bullish":bbSignal<0?"bearish":"neutral", strength: Math.min(Math.abs(bbSignal)*300,100) },
      Stoch:   { value: stoch.k,         direction: stochSignal>0?"bullish":stochSignal<0?"bearish":"neutral", strength: Math.abs(stochSignal)*2500 },
      ATR:     { value: atr.value,       direction: "neutral", strength: Math.min(atrPct*1000,100) },
      MeanRev: { value: meanRevSignal,   direction: meanRevSignal>0?"bullish":"bearish", strength: Math.min(Math.abs(meanRevSignal)*300,100) },
    };

    const bull = Object.values(signals).filter(s=>s.direction==="bullish").length;
    const bear = Object.values(signals).filter(s=>s.direction==="bearish").length;
    const overall = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";

    return {
      oneMinute, oneDay, rsi: rsiData.value, macd, bb, stoch, atr: atr.value, atrPct,
      ema8Last: ema8[ema8.length-1], ema21Last: ema21[ema21.length-1], ema50Last: ema50[ema50.length-1],
      signals, overall,
    };
  }

  // ── History System ─────────────────────────────────────
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY))); } catch {}
  }

  function recordPrediction(coinId, price, pred1m, pred1d) {
    // Don't record if last record for this coin is < 55s old
    const last = [...history].reverse().find(h => h.coin === coinId);
    if (last && Date.now() - last.ts < 55_000) return;

    history.push({
      ts: Date.now(),
      coin: coinId,
      price,
      pred1m, pred1d,
      actual1m: null, actual1mTs: null,
      actual1d: null, actual1dTs: null,
    });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    saveHistory();
  }

  async function resolveHistory() {
    const now = Date.now();
    let changed = false;

    for (const entry of history) {
      // Resolve 1m predictions (after 60s)
      if (entry.actual1m === null && now - entry.ts >= 60_000) {
        const coin = COINS.find(c => c.id === entry.coin);
        if (coin && coinData[coin.id]?.ticker) {
          entry.actual1m = parseFloat(coinData[coin.id].ticker.lastPrice);
          entry.actual1mTs = now;
          changed = true;
        }
      }
      // Resolve 1d predictions (after 24h)
      if (entry.actual1d === null && now - entry.ts >= 86_400_000) {
        const coin = COINS.find(c => c.id === entry.coin);
        if (coin && coinData[coin.id]?.ticker) {
          entry.actual1d = parseFloat(coinData[coin.id].ticker.lastPrice);
          entry.actual1dTs = now;
          changed = true;
        }
      }
    }
    if (changed) saveHistory();
  }

  function getHistoryStats(filter = "ALL") {
    const items = filter === "ALL" ? history : history.filter(h => h.coin === filter);
    const resolved1m = items.filter(h => h.actual1m !== null);
    const resolved1d = items.filter(h => h.actual1d !== null);

    let hit1m = 0, hit1d = 0;
    let totalErr1m = 0, totalErr1d = 0;

    for (const h of resolved1m) {
      const predDir = h.pred1m >= h.price ? 1 : -1;
      const actDir  = h.actual1m >= h.price ? 1 : -1;
      if (predDir === actDir) hit1m++;
      totalErr1m += Math.abs(h.pred1m - h.actual1m) / h.price * 100;
    }
    for (const h of resolved1d) {
      const predDir = h.pred1d >= h.price ? 1 : -1;
      const actDir  = h.actual1d >= h.price ? 1 : -1;
      if (predDir === actDir) hit1d++;
      totalErr1d += Math.abs(h.pred1d - h.actual1d) / h.price * 100;
    }

    return {
      total: items.length,
      resolved1m: resolved1m.length,
      resolved1d: resolved1d.length,
      accuracy1m: resolved1m.length > 0 ? (hit1m / resolved1m.length * 100) : null,
      accuracy1d: resolved1d.length > 0 ? (hit1d / resolved1d.length * 100) : null,
      avgErr1m: resolved1m.length > 0 ? totalErr1m / resolved1m.length : null,
      avgErr1d: resolved1d.length > 0 ? totalErr1d / resolved1d.length : null,
    };
  }

  function renderHistory() {
    const filter = document.getElementById("history-coin")?.value || "ALL";
    const stats = getHistoryStats(filter);

    // Summary
    const sumEl = document.getElementById("history-summary");
    sumEl.innerHTML = `
      <div class="hsummary-item">
        <span class="hsummary-item__label">총 기록</span>
        <span class="hsummary-item__val">${stats.total}건</span>
      </div>
      <div class="hsummary-item">
        <span class="hsummary-item__label">1분 방향 적중률</span>
        <span class="hsummary-item__val ${stats.accuracy1m !== null ? (stats.accuracy1m >= 50 ? 'up' : 'down') : 'neutral'}">
          ${stats.accuracy1m !== null ? fmtNum(stats.accuracy1m,1)+'%' : '—'} <small style="font-size:0.6rem;color:var(--text-muted)">(${stats.resolved1m}건)</small>
        </span>
      </div>
      <div class="hsummary-item">
        <span class="hsummary-item__label">1분 평균 오차</span>
        <span class="hsummary-item__val">${stats.avgErr1m !== null ? fmtNum(stats.avgErr1m,3)+'%' : '—'}</span>
      </div>
      <div class="hsummary-item">
        <span class="hsummary-item__label">1일 방향 적중률</span>
        <span class="hsummary-item__val ${stats.accuracy1d !== null ? (stats.accuracy1d >= 50 ? 'up' : 'down') : 'neutral'}">
          ${stats.accuracy1d !== null ? fmtNum(stats.accuracy1d,1)+'%' : '—'} <small style="font-size:0.6rem;color:var(--text-muted)">(${stats.resolved1d}건)</small>
        </span>
      </div>
      <div class="hsummary-item">
        <span class="hsummary-item__label">1일 평균 오차</span>
        <span class="hsummary-item__val">${stats.avgErr1d !== null ? fmtNum(stats.avgErr1d,3)+'%' : '—'}</span>
      </div>`;

    // Table
    const items = filter === "ALL" ? history : history.filter(h => h.coin === filter);
    const tbody = document.getElementById("history-body");
    tbody.innerHTML = "";

    const display = items.slice().reverse().slice(0, 30);
    for (const h of display) {
      const tr = document.createElement("tr");

      const m1Result = h.actual1m !== null
        ? ((h.pred1m >= h.price ? 1 : -1) === (h.actual1m >= h.price ? 1 : -1) ? "적중" : "실패")
        : "대기중";
      const m1Cls = m1Result === "적중" ? "result-hit" : m1Result === "실패" ? "result-miss" : "result-pending";

      const d1Result = h.actual1d !== null
        ? ((h.pred1d >= h.price ? 1 : -1) === (h.actual1d >= h.price ? 1 : -1) ? "적중" : "실패")
        : "대기중";
      const d1Cls = d1Result === "적중" ? "result-hit" : d1Result === "실패" ? "result-miss" : "result-pending";

      tr.innerHTML = `
        <td>${fmtTime(h.ts)}</td>
        <td>${h.coin}</td>
        <td>${fmtUSD(h.price)}</td>
        <td>${fmtUSD(h.pred1m)}</td>
        <td>${h.actual1m !== null ? fmtUSD(h.actual1m) : '—'}</td>
        <td class="${m1Cls}">${m1Result}</td>
        <td>${fmtUSD(h.pred1d)}</td>
        <td>${h.actual1d !== null ? fmtUSD(h.actual1d) : '—'}</td>
        <td class="${d1Cls}">${d1Result}</td>`;
      tbody.appendChild(tr);
    }
  }

  // ── Mini Sparkline on Summary Cards ────────────────────
  function drawSparkline(coinId, closes) {
    const canvasId = `${coinId.toLowerCase()}-spark`;
    let canvas = document.getElementById(canvasId);
    if (!canvas) {
      // Create canvas element dynamically
      const card = document.querySelector(`.scard[data-coin="${coinId}"]`);
      if (!card) return;
      const priceEl = card.querySelector(".scard__price");
      canvas = document.createElement("canvas");
      canvas.id = canvasId;
      canvas.className = "scard__spark";
      canvas.height = 48;
      priceEl.insertAdjacentElement("afterend", canvas);
    }

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;

    const data = closes.slice(-48);
    if (data.length < 2) return;

    const min = Math.min(...data) * 0.9995;
    const max = Math.max(...data) * 1.0005;
    const range = max - min || 1;
    const toX = i => (i / (data.length-1)) * W;
    const toY = v => H - ((v-min)/range) * (H-4) - 2;

    ctx.clearRect(0,0,W,H);

    // Gradient fill
    const up = data[data.length-1] >= data[0];
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, up ? "rgba(52,211,153,0.15)" : "rgba(251,113,133,0.15)");
    grad.addColorStop(1, "transparent");

    ctx.beginPath();
    ctx.moveTo(toX(0), H);
    for (let i = 0; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
    ctx.lineTo(toX(data.length-1), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = toX(i), y = toY(data[i]);
      i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.strokeStyle = up ? "#34d399" : "#fb7185";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // ── Summary Card Update ────────────────────────────────
  function updateSummaryCard(coin, ticker, prediction) {
    const p = coin.id.toLowerCase();
    const price = parseFloat(ticker.lastPrice);
    const pct = parseFloat(ticker.priceChangePercent);
    const el = id => document.getElementById(id);

    el(`${p}-price`).textContent = fmtUSD(price);

    const badge = el(`${p}-change`);
    badge.textContent = fmtPct(pct);
    badge.className = `scard__badge ${pct >= 0 ? "up" : "down"}`;

    // 1m prediction + %
    const p1mEl = el(`${p}-p1m`);
    p1mEl.textContent = fmtUSD(prediction.oneMinute);
    p1mEl.className = `sp__val ${prediction.oneMinute >= price ? "up" : "down"}`;
    const p1mPct = el(`${p}-p1m-pct`);
    if (p1mPct) {
      const diff1m = ((prediction.oneMinute - price) / price) * 100;
      p1mPct.textContent = fmtPct(diff1m);
      p1mPct.className = `sp__pct ${diff1m >= 0 ? "up" : "down"}`;
    }

    // 1d prediction + %
    const p1dEl = el(`${p}-p1d`);
    p1dEl.textContent = fmtUSD(prediction.oneDay);
    p1dEl.className = `sp__val ${prediction.oneDay >= price ? "up" : "down"}`;
    const p1dPct = el(`${p}-p1d-pct`);
    if (p1dPct) {
      const diff1d = ((prediction.oneDay - price) / price) * 100;
      p1dPct.textContent = fmtPct(diff1d);
      p1dPct.className = `sp__pct ${diff1d >= 0 ? "up" : "down"}`;
    }

    el(`${p}-indicators`).textContent =
      `RSI ${fmtNum(prediction.rsi,1)} · MACD ${prediction.macd.histogram>=0?"▲":"▼"}${fmtNum(Math.abs(prediction.macd.histogram),2)} · ` +
      `BB%B ${fmtNum(prediction.bb.pctB*100,1)}% · Stoch ${fmtNum(prediction.stoch.k,1)}/${fmtNum(prediction.stoch.d,1)} · ` +
      `ATR ${fmtUSD(prediction.atr)}`;

    document.querySelector(`.scard[data-coin="${coin.id}"]`)?.classList.remove("scard--loading");
  }

  // ── Confidence Dashboard ───────────────────────────────
  function renderConfidence() {
    const grid = document.getElementById("conf-grid");
    grid.innerHTML = "";
    for (const coin of COINS) {
      const cd = coinData[coin.id];
      if (!cd?.prediction) continue;
      const pred = cd.prediction;
      const vCls = pred.overall==="bullish"?"bullish":pred.overall==="bearish"?"bearish":"neutral";
      const vTxt = pred.overall==="bullish"?"강세":pred.overall==="bearish"?"약세":"중립";

      let bars = "";
      for (const [name, sig] of Object.entries(pred.signals)) {
        const cls = sig.direction==="bullish"?"bullish":sig.direction==="bearish"?"bearish":"neutral";
        bars += `<div class="conf-bar-row"><span class="conf-bar-row__label">${name}</span><div class="conf-bar-track"><div class="conf-bar-fill ${cls}" style="width:${Math.min(sig.strength,100)}%"></div></div><span class="conf-bar-row__val">${fmtNum(sig.strength,0)}%</span></div>`;
      }

      const card = document.createElement("div");
      card.className = "conf-card";
      card.innerHTML = `<div class="conf-card__head"><span class="conf-card__coin">${coin.icon} ${coin.name}</span><span class="conf-card__verdict ${vCls}">${vTxt}</span></div><div class="conf-bar-group">${bars}</div>`;
      grid.appendChild(card);
    }
  }

  // ── Detail Chart ───────────────────────────────────────
  function drawDetailChart() {
    if (!activeCoin) return;
    const cd = coinData[activeCoin];
    if (!cd) return;
    const klines = cd.klines?.[activeTF];
    if (!klines?.length) return;

    const canvas = document.getElementById("detail-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width*dpr; canvas.height = rect.height*dpr;
    ctx.scale(dpr,dpr);
    const W = rect.width, H = rect.height;

    const closes = klines.map(k=>parseFloat(k[4]));
    const highs = klines.map(k=>parseFloat(k[2]));
    const lows = klines.map(k=>parseFloat(k[3]));
    const opens = klines.map(k=>parseFloat(k[1]));
    const vols = klines.map(k=>parseFloat(k[5]));

    const showEMA = document.getElementById("ov-ema")?.checked;
    const showBB = document.getElementById("ov-bb")?.checked;
    const showVol = document.getElementById("ov-vol")?.checked;

    let allV = [...highs, ...lows];
    if (showBB) { const b = calcBollinger(closes,20,2); allV = allV.concat(b.upper.filter(v=>v!==null), b.lower.filter(v=>v!==null)); }
    const pMin = Math.min(...allV)*0.998, pMax = Math.max(...allV)*1.002, pR = pMax-pMin||1;

    const cTop = 8, cBot = showVol ? H*0.78 : H-8, cH = cBot-cTop;
    const n = closes.length;
    const cW = Math.max(1, (W/n)*0.6), gap = W/n;
    const toX = i => gap*i + gap/2;
    const toY = v => cTop + cH - ((v-pMin)/pR)*cH;

    ctx.clearRect(0,0,W,H);

    // Grid
    ctx.strokeStyle = "rgba(99,102,241,0.06)"; ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const y = cTop + (cH/4)*i;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
      ctx.fillStyle = "rgba(78,90,114,0.5)";
      ctx.font = `${10*(dpr>1?0.85:1)}px JetBrains Mono`;
      ctx.fillText(fmtUSD(pMax-(pR/4)*i), 4, y-3);
    }

    // Volume
    if (showVol) {
      const vMax = Math.max(...vols), vH = H-cBot-4;
      for (let i=0;i<n;i++) {
        const x = toX(i)-cW/2, h = (vols[i]/vMax)*vH;
        ctx.fillStyle = closes[i]>=opens[i] ? "rgba(52,211,153,0.2)" : "rgba(251,113,133,0.2)";
        ctx.fillRect(x, H-2-h, cW, h);
      }
    }

    // Bollinger
    if (showBB) {
      const bD = calcBollinger(closes,20,2);
      ctx.beginPath(); let s=false;
      for (let i=0;i<n;i++) { if(bD.upper[i]===null) continue; const x=toX(i); !s?(ctx.moveTo(x,toY(bD.upper[i])),s=true):ctx.lineTo(x,toY(bD.upper[i])); }
      for (let i=n-1;i>=0;i--) { if(bD.lower[i]===null) continue; ctx.lineTo(toX(i),toY(bD.lower[i])); }
      ctx.closePath(); ctx.fillStyle="rgba(99,102,241,0.06)"; ctx.fill();

      for (const band of [bD.upper,bD.mid,bD.lower]) {
        ctx.beginPath(); let s2=false;
        for(let i=0;i<n;i++){if(band[i]===null)continue;const x=toX(i),y=toY(band[i]);!s2?(ctx.moveTo(x,y),s2=true):ctx.lineTo(x,y);}
        ctx.strokeStyle = band===bD.mid?"rgba(99,102,241,0.35)":"rgba(99,102,241,0.2)";
        ctx.lineWidth = band===bD.mid?1:0.8; ctx.setLineDash(band===bD.mid?[]:[3,3]); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // Candlesticks
    for (let i=0;i<n;i++) {
      const x=toX(i), oY=toY(opens[i]), cY=toY(closes[i]), hY=toY(highs[i]), lY=toY(lows[i]);
      const bull = closes[i]>=opens[i], col = bull?"#34d399":"#fb7185";
      ctx.beginPath(); ctx.moveTo(x,hY); ctx.lineTo(x,lY); ctx.strokeStyle=col; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle=col; ctx.fillRect(x-cW/2, Math.min(oY,cY), cW, Math.max(Math.abs(oY-cY),1));
    }

    // EMA
    if (showEMA) {
      const e8=ema(closes,8), e21=ema(closes,21), e50=closes.length>=50?ema(closes,50):null;
      for (const [s,c] of [[e8,"#fbbf24"],[e21,"#818cf8"],[e50,"#22d3ee"]]) {
        if(!s) continue; ctx.beginPath();
        for(let i=0;i<s.length;i++){const x=toX(i),y=toY(s[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
        ctx.strokeStyle=c; ctx.lineWidth=1.2; ctx.stroke();
      }
    }

    // Prediction marker
    if (cd.prediction) {
      const pred = cd.prediction;
      const pP = activeTF==="1d"?pred.oneDay:pred.oneMinute;
      const lX=toX(n-1), lY=toY(closes[n-1]), pX=W-6, pY=toY(Math.max(pMin,Math.min(pMax,pP)));
      const up = pP>=closes[n-1];

      ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(lX,lY); ctx.lineTo(pX,pY);
      ctx.strokeStyle = up?"#34d399":"#fb7185"; ctx.lineWidth=1.5; ctx.stroke(); ctx.setLineDash([]);

      ctx.beginPath(); ctx.arc(pX,pY,5,0,Math.PI*2);
      ctx.fillStyle = up?"#34d399":"#fb7185"; ctx.fill();
      ctx.strokeStyle="#0c1220"; ctx.lineWidth=2; ctx.stroke();

      ctx.font = "bold 11px JetBrains Mono"; ctx.fillStyle = up?"#34d399":"#fb7185";
      ctx.textAlign = "right"; ctx.fillText(fmtUSD(pP), pX-10, pY-10); ctx.textAlign = "start";
    }

    updateDetailStats();
  }

  function updateDetailStats() {
    const cd = coinData[activeCoin];
    if (!cd?.prediction) return;
    const pred = cd.prediction, price = parseFloat(cd.ticker.lastPrice);
    const items = [
      { label:"현재가", val: fmtUSD(price) },
      { label:"1분 예측", val: fmtUSD(pred.oneMinute), cls: pred.oneMinute>=price?"up":"down" },
      { label:"1일 예측", val: fmtUSD(pred.oneDay), cls: pred.oneDay>=price?"up":"down" },
      { label:"RSI(14)", val: fmtNum(pred.rsi,1) },
      { label:"MACD Hist", val: fmtNum(pred.macd.histogram,2), cls: pred.macd.histogram>=0?"up":"down" },
      { label:"BB %B", val: fmtNum(pred.bb.pctB*100,1)+"%" },
      { label:"Stoch K/D", val:`${fmtNum(pred.stoch.k,0)}/${fmtNum(pred.stoch.d,0)}` },
      { label:"ATR", val: fmtUSD(pred.atr) },
      { label:"EMA 8/21/50", val:`${fmtUSD(pred.ema8Last)} / ${fmtUSD(pred.ema21Last)} / ${fmtUSD(pred.ema50Last)}` },
    ];
    document.getElementById("detail-stats").innerHTML = items.map(i =>
      `<div class="stat"><span class="stat__label">${i.label}</span><span class="stat__val ${i.cls||""}">${i.val}</span></div>`
    ).join("");
  }

  // ── Detail Panel Control ───────────────────────────────
  function openDetail(coinId) {
    const coin = COINS.find(c=>c.id===coinId);
    if(!coin) return;
    activeCoin = coinId;
    document.getElementById("detail-panel").style.display = "";
    document.getElementById("dp-icon").textContent = coin.icon;
    document.getElementById("dp-title").textContent = coin.name;
    document.getElementById("dp-pair").textContent = `${coin.id} / USDT`;
    document.querySelectorAll(".scard__expand").forEach(b=>b.classList.remove("active"));
    document.querySelector(`.scard__expand[data-target="${coinId}"]`)?.classList.add("active");
    loadTimeframeAndDraw();
    document.getElementById("detail-panel").scrollIntoView({ behavior:"smooth", block:"nearest" });
  }

  function closeDetail() {
    activeCoin = null;
    document.getElementById("detail-panel").style.display = "none";
    document.querySelectorAll(".scard__expand").forEach(b=>b.classList.remove("active"));
  }

  async function loadTimeframeAndDraw() {
    if (!activeCoin) return;
    const coin = COINS.find(c=>c.id===activeCoin);
    const tf = TIMEFRAMES[activeTF];
    try {
      const kl = await getKlines(coin.symbol, tf.interval, tf.limit);
      if (!coinData[coin.id]) coinData[coin.id] = {};
      if (!coinData[coin.id].klines) coinData[coin.id].klines = {};
      coinData[coin.id].klines[activeTF] = kl;
      drawDetailChart();
    } catch(e) { console.error("TF load error:", e); }
  }

  // ── Events ─────────────────────────────────────────────
  function bindEvents() {
    document.querySelectorAll(".scard__expand").forEach(btn =>
      btn.addEventListener("click", () => {
        const t = btn.dataset.target;
        activeCoin === t ? closeDetail() : openDetail(t);
      })
    );

    document.getElementById("dp-close").addEventListener("click", closeDetail);

    document.getElementById("tf-group").addEventListener("click", e => {
      const btn = e.target.closest(".tf-btn");
      if (!btn) return;
      activeTF = btn.dataset.tf;
      document.querySelectorAll(".tf-btn").forEach(b=>b.classList.remove("tf-btn--active"));
      btn.classList.add("tf-btn--active");
      loadTimeframeAndDraw();
    });

    ["ov-ema","ov-bb","ov-vol"].forEach(id =>
      document.getElementById(id)?.addEventListener("change", drawDetailChart)
    );

    // History filter
    document.getElementById("history-coin")?.addEventListener("change", renderHistory);

    // History clear
    document.getElementById("history-clear")?.addEventListener("click", () => {
      history = [];
      saveHistory();
      renderHistory();
    });

    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawDetailChart(); refreshSparklines(); }, 200); });
  }

  function refreshSparklines() {
    for (const coin of COINS) {
      const cd = coinData[coin.id];
      if (!cd?.klines?.["1h"]) continue;
      const closes = cd.klines["1h"].map(k=>parseFloat(k[4]));
      drawSparkline(coin.id, closes);
    }
  }

  // ── Main Refresh ───────────────────────────────────────
  async function refresh() {
    const statusEl = document.getElementById("status-text");
    const pulseEl = document.getElementById("pulse");

    try {
      await Promise.all(COINS.map(async coin => {
        const [ticker, hKl, dKl] = await Promise.all([
          getTicker(coin.symbol),
          getKlines(coin.symbol, "1h", 168),
          getKlines(coin.symbol, "1d", 30),
        ]);

        const closes = hKl.map(k=>parseFloat(k[4]));
        const highs  = hKl.map(k=>parseFloat(k[2]));
        const lows   = hKl.map(k=>parseFloat(k[3]));
        const dCloses= dKl.map(k=>parseFloat(k[4]));
        const price  = parseFloat(ticker.lastPrice);

        const prediction = computePrediction(price, closes, dCloses, highs, lows);

        coinData[coin.id] = {
          ticker, prediction,
          klines: { ...(coinData[coin.id]?.klines||{}), "1h": hKl, "1d": dKl },
        };

        updateSummaryCard(coin, ticker, prediction);
        drawSparkline(coin.id, closes);
        recordPrediction(coin.id, price, prediction.oneMinute, prediction.oneDay);
      }));

      renderConfidence();
      await resolveHistory();
      renderHistory();

      if (activeCoin) drawDetailChart();

      pulseEl.classList.remove("error");
      statusEl.textContent = `LIVE · ${new Date().toLocaleTimeString("ko-KR")}`;
    } catch(err) {
      console.error("Refresh error:", err);
      pulseEl.classList.add("error");
      statusEl.textContent = `오류 — 재시도 중...`;
    }
  }

  // ══════════════════════════════════════════════════════
  //  HOT ALTCOIN TAB
  // ══════════════════════════════════════════════════════

  const EXCLUDE_SYMBOLS = new Set([
    // Stablecoins
    "USDCUSDT","BUSDUSDT","TUSDUSDT","DAIUSDT","FDUSDUSDT","USDPUSDT","EURUSDT",
    // Leveraged tokens
    "BTCDOWNUSDT","BTCUPUSDT","ETHDOWNUSDT","ETHUPUSDT",
    // Main coins (already in main tab)
    "BTCUSDT","ETHUSDT","SOLUSDT",
  ]);

  // Also exclude anything with "UP","DOWN","BEAR","BULL" in name
  function isExcluded(sym) {
    if (EXCLUDE_SYMBOLS.has(sym)) return true;
    const base = sym.replace("USDT", "");
    return /UP$|DOWN$|BEAR$|BULL$|^USD/.test(base);
  }

  let altSortMode = "gainers"; // gainers | losers | volume
  let altCoins = [];            // sorted list of alt tickers
  let activeAltSymbol = null;

  async function fetchAllTickers() {
    return cached("all-tickers", 25_000, () =>
      fetchJSON(`${BINANCE}/ticker/24hr`)
    );
  }

  function filterAndSortAlts(tickers) {
    // Filter USDT pairs, exclude stables/leverage/main
    let alts = tickers.filter(t => {
      if (!t.symbol.endsWith("USDT")) return false;
      if (isExcluded(t.symbol)) return false;
      if (parseFloat(t.quoteVolume) < 1_000_000) return false; // min $1M 24h vol
      return true;
    });

    // Sort
    if (altSortMode === "gainers") {
      alts.sort((a,b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    } else if (altSortMode === "losers") {
      alts.sort((a,b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent));
    } else {
      alts.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    }

    return alts.slice(0, 12);
  }

  function fmtVol(v) {
    const n = parseFloat(v);
    if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
    return `${n.toFixed(0)}`;
  }

  function fmtPrice(v) {
    const n = parseFloat(v);
    if (n >= 1000) return `${n.toFixed(2)}`;
    if (n >= 1) return `${n.toFixed(3)}`;
    if (n >= 0.01) return `${n.toFixed(4)}`;
    return `${n.toFixed(6)}`;
  }

  function getAltTags(ticker) {
    const tags = [];
    const pct = Math.abs(parseFloat(ticker.priceChangePercent));
    const vol = parseFloat(ticker.quoteVolume);
    if (pct > 15) tags.push({ text: `🔥 ${pct > 30 ? '🚀 박포적' : '급변'}`, hot: true });
    if (vol > 500_000_000) tags.push({ text: '💧 대량거래', hot: true });
    if (vol > 100_000_000) tags.push({ text: '💰 고볼륨', hot: false });
    else tags.push({ text: '📊 일반', hot: false });
    return tags;
  }

  function drawAltSparkline(canvasEl, closes) {
    if (!canvasEl || closes.length < 2) return;
    const ctx = canvasEl.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr; canvasEl.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const min = Math.min(...closes)*0.999, max = Math.max(...closes)*1.001, range = max-min||1;
    const toX = i => (i/(closes.length-1))*W;
    const toY = v => H - ((v-min)/range)*(H-4) - 2;
    const up = closes[closes.length-1] >= closes[0];
    ctx.clearRect(0,0,W,H);
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, up?"rgba(52,211,153,0.15)":"rgba(251,113,133,0.15)"); grad.addColorStop(1,"transparent");
    ctx.beginPath(); ctx.moveTo(toX(0),H);
    for(let i=0;i<closes.length;i++) ctx.lineTo(toX(i),toY(closes[i]));
    ctx.lineTo(toX(closes.length-1),H); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
    ctx.beginPath();
    for(let i=0;i<closes.length;i++){const x=toX(i),y=toY(closes[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
    ctx.strokeStyle=up?"#34d399":"#fb7185"; ctx.lineWidth=1.3; ctx.lineJoin="round"; ctx.stroke();
  }

  async function renderAltGrid() {
    const grid = document.getElementById("alt-grid");
    if (!altCoins.length) { grid.innerHTML = '<div class="alt-loading">데이터 없음</div>'; return; }

    grid.innerHTML = "";
    altCoins.forEach((t, idx) => {
      const pct = parseFloat(t.priceChangePercent);
      const tags = getAltTags(t);
      const base = t.symbol.replace("USDT","");

      const card = document.createElement("div");
      card.className = "acard";
      card.style.animationDelay = `${idx * 0.04}s`;
      card.dataset.symbol = t.symbol;

      card.innerHTML = `
        <div class="acard__top">
          <div class="acard__rank ${idx<3?'top3':''}">${idx+1}</div>
          <div>
            <div class="acard__name">${base}</div>
            <div class="acard__symbol">${t.symbol}</div>
          </div>
          <div class="acard__change ${pct>=0?'up':'down'}">${fmtPct(pct)}</div>
        </div>
        <div class="acard__row">
          <span class="acard__price">${fmtPrice(t.lastPrice)}</span>
          <span class="acard__vol">Vol ${fmtVol(t.quoteVolume)}</span>
        </div>
        <canvas class="acard__spark" data-spark="${t.symbol}" height="36"></canvas>
        <div class="acard__tags">${tags.map(tg => `<span class="acard__tag ${tg.hot?'hot':''}">${tg.text}</span>`).join("")}</div>`;

      card.addEventListener("click", () => openAltDetail(t.symbol));
      grid.appendChild(card);
    });

    // Load sparklines for visible alt cards
    loadAltSparklines();
  }

  async function loadAltSparklines() {
    for (const t of altCoins) {
      const canvas = document.querySelector(`canvas[data-spark="${t.symbol}"]`);
      if (!canvas) continue;
      try {
        const kl = await getKlines(t.symbol, "1h", 48);
        const closes = kl.map(k => parseFloat(k[4]));
        drawAltSparkline(canvas, closes);
      } catch { /* skip */ }
    }
  }

  async function openAltDetail(symbol) {
    activeAltSymbol = symbol;
    const panel = document.getElementById("alt-detail");
    panel.style.display = "";

    const base = symbol.replace("USDT","");
    const ticker = altCoins.find(t => t.symbol === symbol);
    const pct = ticker ? parseFloat(ticker.priceChangePercent) : 0;

    document.getElementById("ad-icon").textContent = "🪙";
    document.getElementById("ad-title").textContent = base;
    document.getElementById("ad-pair").textContent = `${base} / USDT`;

    const badge = document.getElementById("ad-change");
    badge.textContent = fmtPct(pct);
    badge.className = `alt-detail__badge ${pct>=0?'up':'down'}`;

    document.getElementById("ad-price").textContent = ticker ? fmtPrice(ticker.lastPrice) : "$—";

    try {
      const [hKl, dKl] = await Promise.all([
        getKlines(symbol, "1h", 168),
        getKlines(symbol, "1d", 30),
      ]);

      const closes = hKl.map(k=>parseFloat(k[4]));
      const highs = hKl.map(k=>parseFloat(k[2]));
      const lows = hKl.map(k=>parseFloat(k[3]));
      const dCloses = dKl.map(k=>parseFloat(k[4]));
      const price = parseFloat(ticker.lastPrice);

      const pred = computePrediction(price, closes, dCloses, highs, lows);

      // Stats
      document.getElementById("ad-stats").innerHTML = [
        { label:"RSI(14)", val: fmtNum(pred.rsi,1) },
        { label:"MACD Hist", val: fmtNum(pred.macd.histogram,4), cls: pred.macd.histogram>=0?"up":"down" },
        { label:"BB %B", val: fmtNum(pred.bb.pctB*100,1)+"%" },
        { label:"Stoch K/D", val:`${fmtNum(pred.stoch.k,0)}/${fmtNum(pred.stoch.d,0)}` },
        { label:"ATR", val: fmtPrice(pred.atr) },
        { label:"종합", val: pred.overall==="bullish"?"강세":pred.overall==="bearish"?"약세":"중립", cls: pred.overall==="bullish"?"up":pred.overall==="bearish"?"down":"" },
      ].map(i => `<div class="stat"><span class="stat__label">${i.label}</span><span class="stat__val ${i.cls||""}">${i.val}</span></div>`).join("");

      // Predictions
      const diff1m = ((pred.oneMinute-price)/price)*100;
      const diff1d = ((pred.oneDay-price)/price)*100;
      document.getElementById("ad-preds").innerHTML = `
        <div class="sp">
          <span class="sp__label">1분 예측</span>
          <span class="sp__val ${pred.oneMinute>=price?'up':'down'}">${fmtPrice(pred.oneMinute)}</span>
          <span class="sp__pct ${diff1m>=0?'up':'down'}">${fmtPct(diff1m)}</span>
        </div>
        <div class="sp-div"></div>
        <div class="sp">
          <span class="sp__label">1일 예측</span>
          <span class="sp__val ${pred.oneDay>=price?'up':'down'}">${fmtPrice(pred.oneDay)}</span>
          <span class="sp__pct ${diff1d>=0?'up':'down'}">${fmtPct(diff1d)}</span>
        </div>`;

      // Chart — draw candlestick
      drawAltDetailChart(hKl, pred);

    } catch(e) {
      console.error("Alt detail error:", e);
      document.getElementById("ad-stats").innerHTML = '<span style="color:var(--red)">데이터 로드 실패</span>';
    }

    panel.scrollIntoView({ behavior:"smooth", block:"nearest" });
  }

  function drawAltDetailChart(klines, pred) {
    const canvas = document.getElementById("ad-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio||1;
    const rect = canvas.getBoundingClientRect();
    canvas.width=rect.width*dpr; canvas.height=rect.height*dpr;
    ctx.scale(dpr,dpr);
    const W=rect.width, H=rect.height;

    const closes=klines.map(k=>parseFloat(k[4])),highs=klines.map(k=>parseFloat(k[2]));
    const lows=klines.map(k=>parseFloat(k[3])),opens=klines.map(k=>parseFloat(k[1]));
    const n=closes.length;
    const pMin=Math.min(...lows)*0.998,pMax=Math.max(...highs)*1.002,pR=pMax-pMin||1;
    const cW=Math.max(1,(W/n)*0.6),gap=W/n;
    const toX=i=>gap*i+gap/2;
    const toY=v=>8+(H-16)-((v-pMin)/pR)*(H-16);

    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle="rgba(99,102,241,0.06)";ctx.lineWidth=0.5;
    for(let i=0;i<4;i++){const y=8+((H-16)/3)*i;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

    for(let i=0;i<n;i++){
      const x=toX(i),oY=toY(opens[i]),cY=toY(closes[i]),hY=toY(highs[i]),lY=toY(lows[i]);
      const bull=closes[i]>=opens[i],col=bull?"#34d399":"#fb7185";
      ctx.beginPath();ctx.moveTo(x,hY);ctx.lineTo(x,lY);ctx.strokeStyle=col;ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=col;ctx.fillRect(x-cW/2,Math.min(oY,cY),cW,Math.max(Math.abs(oY-cY),1));
    }

    // EMA overlays
    const e8=ema(closes,8),e21=ema(closes,21);
    for(const[s,c]of[[e8,"#fbbf24"],[e21,"#818cf8"]]){
      ctx.beginPath();
      for(let i=0;i<s.length;i++){const x=toX(i),y=toY(s[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
      ctx.strokeStyle=c;ctx.lineWidth=1;ctx.stroke();
    }

    // Prediction dot
    if(pred){
      const pP=pred.oneDay,lX=toX(n-1),lY2=toY(closes[n-1]),pX=W-6;
      const pY=toY(Math.max(pMin,Math.min(pMax,pP)));
      const up=pP>=closes[n-1];
      ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(lX,lY2);ctx.lineTo(pX,pY);
      ctx.strokeStyle=up?"#34d399":"#fb7185";ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(pX,pY,4,0,Math.PI*2);
      ctx.fillStyle=up?"#34d399":"#fb7185";ctx.fill();
      ctx.strokeStyle="#0c1220";ctx.lineWidth=1.5;ctx.stroke();
    }
  }

  function closeAltDetail() {
    activeAltSymbol = null;
    document.getElementById("alt-detail").style.display = "none";
  }

  async function refreshAltTab() {
    try {
      const allTickers = await fetchAllTickers();
      altCoins = filterAndSortAlts(allTickers);
      await renderAltGrid();
    } catch(e) {
      console.error("Alt refresh error:", e);
      document.getElementById("alt-grid").innerHTML = '<div class="alt-loading" style="color:var(--red)">데이터 로드 실패 — 재시도 중...</div>';
    }
  }

  // ── Tab System ─────────────────────────────────────────
  let currentTab = "main";

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("tab-btn--active", b.dataset.tab === tab));
    document.getElementById("tab-main").style.display = tab === "main" ? "" : "none";
    document.getElementById("tab-alt").style.display = tab === "alt" ? "" : "none";

    if (tab === "alt" && altCoins.length === 0) {
      refreshAltTab();
    }
  }

  function bindAltEvents() {
    // Tab switching
    document.getElementById("tab-nav").addEventListener("click", e => {
      const btn = e.target.closest(".tab-btn");
      if (btn) switchTab(btn.dataset.tab);
    });

    // Sort buttons
    document.getElementById("alt-sort-group").addEventListener("click", e => {
      const btn = e.target.closest(".alt-sort-btn");
      if (!btn) return;
      altSortMode = btn.dataset.sort;
      document.querySelectorAll(".alt-sort-btn").forEach(b => b.classList.toggle("alt-sort-btn--active", b.dataset.sort === altSortMode));
      // Re-sort existing data
      fetchAllTickers().then(tickers => {
        altCoins = filterAndSortAlts(tickers);
        renderAltGrid();
      });
    });

    // Refresh button
    document.getElementById("alt-refresh-btn").addEventListener("click", e => {
      const btn = e.currentTarget;
      btn.classList.add("spinning");
      // Clear cache to force fresh
      cache.delete("all-tickers");
      refreshAltTab().finally(() => setTimeout(() => btn.classList.remove("spinning"), 500));
    });

    // Alt detail close
    document.getElementById("ad-close").addEventListener("click", closeAltDetail);
  }

  // ── Init ───────────────────────────────────────────────
  bindEvents();
  bindAltEvents();
  refresh();
  setInterval(() => {
    refresh();
    if (currentTab === "alt") refreshAltTab();
  }, REFRESH_MS);

})();
