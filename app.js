const CONFIG = {
    ids: ["bitcoin", "ethereum"],
    symbols: {
      bitcoin: "BTC",
      ethereum: "ETH",
    },
    vsCurrency: "usd",
    refreshMs: 60_000,
    cacheTtlMs: 45_000,
  };
  
  const memoryCache = new Map();
  
  function formatUsd(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 2 : 4,
    }).format(value);
  }
  
  function slope(series) {
    if (series.length < 2) return 0;
    const first = series[0];
    const last = series[series.length - 1];
    return (last - first) / Math.max(first, 1e-8);
  }
  
  function safeFetch(url) {
    return fetch(url, {
      headers: {
        Accept: "application/json",
      },
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      return response.json();
    });
  }
  
  function getCached(key) {
    const now = Date.now();
  
    const inMemory = memoryCache.get(key);
    if (inMemory && now - inMemory.time < CONFIG.cacheTtlMs) {
      return inMemory.value;
    }
  
    const local = localStorage.getItem(key);
    if (!local) return null;
  
    try {
      const parsed = JSON.parse(local);
      if (now - parsed.time < CONFIG.cacheTtlMs) {
        memoryCache.set(key, parsed);
        return parsed.value;
      }
    } catch {
      localStorage.removeItem(key);
    }
  
    return null;
  }
  
  function setCached(key, value) {
    const payload = { time: Date.now(), value };
    memoryCache.set(key, payload);
    localStorage.setItem(key, JSON.stringify(payload));
  }
  
  async function fetchCoinData(coinId) {
    const cacheKey = `coin:${coinId}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
  
    const [simple, market] = await Promise.all([
      safeFetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${CONFIG.vsCurrency}`
      ),
      safeFetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${CONFIG.vsCurrency}&days=30&interval=hourly`
      ),
    ]);
  
    const currentPrice = simple?.[coinId]?.[CONFIG.vsCurrency];
    const prices = (market?.prices || []).map((entry) => entry[1]).filter(Boolean);
  
    if (!currentPrice || prices.length === 0) {
      throw new Error(`가격 데이터를 파싱할 수 없습니다: ${coinId}`);
    }
  
    const result = { currentPrice, prices };
    setCached(cacheKey, result);
    return result;
  }
  
  function predict(currentPrice, prices) {
    const minuteWindow = prices.slice(-120);
    const dayWindow = prices.slice(-24 * 30);
  
    const minuteSlope = slope(minuteWindow);
    const dayMean = dayWindow.reduce((acc, v) => acc + v, 0) / dayWindow.length;
    const meanReversion = (dayMean - currentPrice) / dayMean;
  
    const oneMinutePrediction = currentPrice * (1 + minuteSlope * 0.08 + meanReversion * 0.02);
    const oneDayPrediction =
      currentPrice * (1 + minuteSlope * 0.65 + meanReversion * 0.45);
  
    return {
      oneMinutePrediction,
      oneDayPrediction,
      minuteSlope,
    };
  }
  
  function trendClass(current, predicted) {
    if (predicted >= current) return "up";
    return "down";
  }
  
  function renderCard(coinId, currentPrice, prediction) {
    const template = document.getElementById("coin-template");
    const card = template.content.firstElementChild.cloneNode(true);
  
    card.querySelector(".coin-name").textContent =
      coinId === "bitcoin" ? "Bitcoin" : "Ethereum";
    card.querySelector(".coin-symbol").textContent = CONFIG.symbols[coinId];
    card.querySelector(".current-price").textContent = `현재가: ${formatUsd(currentPrice)}`;
  
    const minEl = card.querySelector(".pred-minute");
    minEl.textContent = formatUsd(prediction.oneMinutePrediction);
    minEl.classList.add(trendClass(currentPrice, prediction.oneMinutePrediction));
  
    const dayEl = card.querySelector(".pred-day");
    dayEl.textContent = formatUsd(prediction.oneDayPrediction);
    dayEl.classList.add(trendClass(currentPrice, prediction.oneDayPrediction));
  
    const slopePct = (prediction.minuteSlope * 100).toFixed(3);
    card.querySelector(".meta").textContent = `단기 트렌드 기울기: ${slopePct}% (최근 120시간 기준)`;
  
    return card;
  }
  
  async function refresh() {
    const cardsEl = document.getElementById("cards");
    const updatedEl = document.getElementById("last-updated");
    cardsEl.innerHTML = "";
  
    try {
      const rows = await Promise.all(
        CONFIG.ids.map(async (coinId) => {
          const { currentPrice, prices } = await fetchCoinData(coinId);
          const prediction = predict(currentPrice, prices);
          return renderCard(coinId, currentPrice, prediction);
        })
      );
  
      rows.forEach((card) => cardsEl.appendChild(card));
      updatedEl.textContent = `마지막 업데이트: ${new Date().toLocaleString("ko-KR")}`;
    } catch (error) {
      updatedEl.textContent = "데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      cardsEl.innerHTML = `<article class="card"><p>${error.message}</p></article>`;
    }
  }
  
  refresh();
  setInterval(refresh, CONFIG.refreshMs);
  