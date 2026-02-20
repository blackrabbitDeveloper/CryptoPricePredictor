/* ============================================================
   CryptoPricePredictor — app.js
   Binance Public API (no key, CORS-friendly, generous limits)
   Technical indicators: EMA, RSI, MACD, Mean Reversion
   ============================================================ */

(() => {
  "use strict";

  // ── Config ──────────────────────────────────────────────
  const COINS = [
    { id: "BTC", symbol: "BTCUSDT", name: "Bitcoin" },
    { id: "ETH", symbol: "ETHUSDT", name: "Ethereum" },
  ];
  const REFRESH_MS = 30_000; // 30초마다 갱신
  const CACHE_TTL = 25_000;
  const BINANCE = "https://api.binance.com/api/v3";

  // ── Cache ───────────────────────────────────────────────
  const cache = new Map();

  function cached(key, ttl, fetcher) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < ttl) return Promise.resolve(entry.data);
    return fetcher().then((data) => {
      cache.set(key, { ts: Date.now(), data });
      return data;
    });
  }

  // ── Binance API helpers ─────────────────────────────────
  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // 현재가 + 24h 변동
  function getTicker(symbol) {
    return cached(`ticker:${symbol}`, CACHE_TTL, () =>
      fetchJSON(`${BINANCE}/ticker/24hr?symbol=${symbol}`)
    );
  }

  // 1시간봉 최근 168개 (7일)
  function getKlines(symbol) {
    return cached(`klines:${symbol}`, CACHE_TTL, () =>
      fetchJSON(`${BINANCE}/klines?symbol=${symbol}&interval=1h&limit=168`)
    );
  }

  // 1일봉 최근 30개 (30일)
  function getDailyKlines(symbol) {
    return cached(`daily:${symbol}`, CACHE_TTL, () =>
      fetchJSON(`${BINANCE}/klines?symbol=${symbol}&interval=1d&limit=30`)
    );
  }

  // ── Technical indicators ────────────────────────────────
  function ema(data, period) {
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  function rsi(data, period = 14) {
    if (data.length < period + 1) return 50; // neutral default
    let gainSum = 0, lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const diff = data[i] - data[i - 1];
      if (diff >= 0) gainSum += diff;
      else lossSum -= diff;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    for (let i = period + 1; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function computeMACD(data) {
    const ema12 = ema(data, 12);
    const ema26 = ema(data, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signal = ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signal[i]);
    return {
      macd: macdLine[macdLine.length - 1],
      signal: signal[signal.length - 1],
      histogram: histogram[histogram.length - 1],
    };
  }

  // ── Prediction engine ──────────────────────────────────
  function predict(currentPrice, hourlyCloses, dailyCloses) {
    // 1) Short-term momentum via EMA crossover
    const ema8 = ema(hourlyCloses, 8);
    const ema21 = ema(hourlyCloses, 21);
    const shortMomentum =
      (ema8[ema8.length - 1] - ema21[ema21.length - 1]) / currentPrice;

    // 2) RSI mean reversion signal
    const currentRSI = rsi(hourlyCloses, 14);
    let rsiSignal = 0;
    if (currentRSI > 70) rsiSignal = -(currentRSI - 70) / 100; // overbought → expect pullback
    else if (currentRSI < 30) rsiSignal = (30 - currentRSI) / 100; // oversold → expect bounce

    // 3) MACD momentum
    const macd = computeMACD(hourlyCloses);
    const macdSignal = macd.histogram / currentPrice;

    // 4) Mean reversion from 30d daily average
    const dailyAvg =
      dailyCloses.reduce((s, v) => s + v, 0) / dailyCloses.length;
    const meanRevSignal = (dailyAvg - currentPrice) / dailyAvg;

    // 5) Volatility scaling
    const returns = [];
    for (let i = 1; i < hourlyCloses.length; i++) {
      returns.push(
        (hourlyCloses[i] - hourlyCloses[i - 1]) / hourlyCloses[i - 1]
      );
    }
    const volatility =
      Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) || 0.001;

    // 1-minute prediction (very short-term, small moves)
    const minuteFactor =
      shortMomentum * 0.4 +
      rsiSignal * 0.1 +
      macdSignal * 0.3 +
      meanRevSignal * 0.01;
    const oneMinute = currentPrice * (1 + minuteFactor * 0.015);

    // 1-day prediction (accumulate signals)
    const dayFactor =
      shortMomentum * 0.25 +
      rsiSignal * 0.25 +
      macdSignal * 0.2 +
      meanRevSignal * 0.3;
    const oneDay = currentPrice * (1 + dayFactor * 1.2);

    return {
      oneMinute,
      oneDay,
      rsi: currentRSI,
      macd,
      volatility,
      ema8Last: ema8[ema8.length - 1],
      ema21Last: ema21[ema21.length - 1],
    };
  }

  // ── Chart drawing ──────────────────────────────────────
  function drawChart(canvasId, closes, predPrice) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    const allVals = [...closes, predPrice];
    const min = Math.min(...allVals) * 0.999;
    const max = Math.max(...allVals) * 1.001;
    const range = max - min || 1;

    const toX = (i, total) => (i / (total - 1)) * W;
    const toY = (v) => H - ((v - min) / range) * (H - 8) - 4;

    ctx.clearRect(0, 0, W, H);

    // Area fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(99,102,241,0.18)");
    grad.addColorStop(1, "rgba(99,102,241,0)");

    ctx.beginPath();
    ctx.moveTo(toX(0, closes.length), H);
    for (let i = 0; i < closes.length; i++) {
      ctx.lineTo(toX(i, closes.length), toY(closes[i]));
    }
    ctx.lineTo(toX(closes.length - 1, closes.length), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < closes.length; i++) {
      const x = toX(i, closes.length);
      const y = toY(closes[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Prediction dot (dashed line to it)
    const lastX = toX(closes.length - 1, closes.length);
    const lastY = toY(closes[closes.length - 1]);
    const predX = W - 4;
    const predY = toY(predPrice);

    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(predX, predY);
    ctx.strokeStyle = predPrice >= closes[closes.length - 1] ? "#34d399" : "#fb7185";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    ctx.beginPath();
    ctx.arc(predX, predY, 4, 0, Math.PI * 2);
    ctx.fillStyle = predPrice >= closes[closes.length - 1] ? "#34d399" : "#fb7185";
    ctx.fill();
    ctx.strokeStyle = "#0d1117";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Formatting ─────────────────────────────────────────
  function fmtUSD(v) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: v >= 100 ? 2 : 2,
      maximumFractionDigits: v >= 100 ? 2 : 4,
    }).format(v);
  }

  function fmtPct(v) {
    const sign = v >= 0 ? "+" : "";
    return `${sign}${v.toFixed(2)}%`;
  }

  // ── DOM update ─────────────────────────────────────────
  function updateCoin(coin, ticker, hourlyKlines, dailyKlines) {
    const prefix = coin.id.toLowerCase();
    const price = parseFloat(ticker.lastPrice);
    const changePct = parseFloat(ticker.priceChangePercent);

    // Close prices
    const hourlyCloses = hourlyKlines.map((k) => parseFloat(k[4]));
    const dailyCloses = dailyKlines.map((k) => parseFloat(k[4]));

    const pred = predict(price, hourlyCloses, dailyCloses);

    // Price
    document.getElementById(`${prefix}-price`).textContent = fmtUSD(price);

    // 24h change
    const changeEl = document.getElementById(`${prefix}-change`);
    changeEl.textContent = fmtPct(changePct);
    changeEl.className = `card__change ${changePct >= 0 ? "up" : "down"}`;

    // Predictions
    const pred1mEl = document.getElementById(`${prefix}-pred-1m`);
    pred1mEl.textContent = fmtUSD(pred.oneMinute);
    pred1mEl.className = `pred__value ${pred.oneMinute >= price ? "up" : "down"}`;

    const pred1dEl = document.getElementById(`${prefix}-pred-1d`);
    pred1dEl.textContent = fmtUSD(pred.oneDay);
    pred1dEl.className = `pred__value ${pred.oneDay >= price ? "up" : "down"}`;

    // Meta
    document.getElementById(`${prefix}-meta`).textContent =
      `RSI(14): ${pred.rsi.toFixed(1)} · ` +
      `MACD: ${pred.macd.histogram >= 0 ? "▲" : "▼"} ${pred.macd.histogram.toFixed(2)} · ` +
      `EMA8/21: ${fmtUSD(pred.ema8Last)} / ${fmtUSD(pred.ema21Last)}`;

    // Chart
    drawChart(`${prefix}-chart`, hourlyCloses.slice(-72), pred.oneDay);

    // Remove loading state
    document
      .querySelector(`.card[data-coin="${coin.id}"]`)
      ?.classList.remove("card--loading");
  }

  // ── Main loop ──────────────────────────────────────────
  async function refresh() {
    const statusEl = document.getElementById("status-text");

    try {
      await Promise.all(
        COINS.map(async (coin) => {
          const [ticker, hourly, daily] = await Promise.all([
            getTicker(coin.symbol),
            getKlines(coin.symbol),
            getDailyKlines(coin.symbol),
          ]);
          updateCoin(coin, ticker, hourly, daily);
        })
      );
      statusEl.textContent = `LIVE · ${new Date().toLocaleTimeString("ko-KR")}`;
    } catch (err) {
      console.error("Refresh error:", err);
      statusEl.textContent = `오류 발생 — 재시도 중...`;
    }
  }

  // Initial + interval
  refresh();
  setInterval(refresh, REFRESH_MS);

  // Redraw charts on resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 300);
  });
})();
