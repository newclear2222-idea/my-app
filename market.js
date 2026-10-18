// 맨 위 시장 지표: TradingView 무료 미니 차트 위젯(키 불필요, 페이지를 열어 두면 계속 갱신)
// 나스닥·S&P 500·코스피 같은 거래소 지수는 라이선스 제한으로 위젯에 "트레이딩뷰에서만 쓸 수 있습니다"가 뜨므로,
// 위젯에서 표시되는 CFD·ETF 심볼을 쓰고 카드 제목 아래에 실제 지수가 아니라는 안내를 붙인다.
// 표시가 안 되는 심볼이 있으면 칸마다 "다른 시세로 보기"로 다음 후보로 바꿀 수 있다. (market-check.html로 한 번에 확인 가능)
const MARKET_WIDGET = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
const MARKET_HEIGHT = 170;
const MARKET_PREF_KEY = "marketSymbolsV2";
const MARKET_RANGE_KEY = "marketRange";

const MARKET_TILES = [
  {
    id: "nasdaq",
    name: "나스닥",
    symbols: [
      { symbol: "FOREXCOM:NSXUSD", note: "나스닥100 추종 CFD 기준" },
      { symbol: "NASDAQ:QQQ", note: "나스닥100 추종 ETF(QQQ) 기준" },
    ],
  },
  {
    id: "sp500",
    name: "S&P 500",
    symbols: [
      { symbol: "FOREXCOM:SPXUSD", note: "S&P 500 추종 CFD 기준" },
      { symbol: "AMEX:SPY", note: "S&P 500 추종 ETF(SPY) 기준" },
    ],
  },
  {
    id: "kospi",
    name: "코스피",
    symbols: [
      { symbol: "AMEX:EWY", note: "한국 주식 ETF(EWY, 달러) 기준 · 환율 영향 포함" },
    ],
  },
  {
    id: "usdkrw",
    name: "원/달러 환율",
    symbols: [
      { symbol: "FX_IDC:USDKRW", note: "" },
      { symbol: "FX:USDKRW", note: "" },
    ],
  },
  {
    id: "wti",
    name: "WTI 유가",
    symbols: [
      { symbol: "TVC:USOIL", note: "WTI 원유 CFD 기준" },
      { symbol: "NYMEX:CL1!", note: "WTI 근월물 선물 기준" },
    ],
  },
];

const marketGrid = document.getElementById("market-grid");
const marketRange = document.getElementById("market-range");

function readMarketPrefs() {
  try { return JSON.parse(localStorage.getItem(MARKET_PREF_KEY) || "{}"); } catch { return {}; }
}

function saveMarketPrefs(prefs) {
  try { localStorage.setItem(MARKET_PREF_KEY, JSON.stringify(prefs)); } catch { /* 저장소 사용 불가 */ }
}

function marketWidget(symbol) {
  const box = document.createElement("div");
  box.className = "tradingview-widget-container market-widget";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  const script = document.createElement("script");
  script.src = MARKET_WIDGET;
  script.async = true;
  script.textContent = JSON.stringify({
    symbol,
    width: "100%",
    height: MARKET_HEIGHT,
    locale: "kr",
    dateRange: marketRange.value,
    colorTheme: prefersDark() ? "dark" : "light",
    isTransparent: true,
    autosize: false,
    chartOnly: false,
    noTimeScale: false,
  });
  box.append(inner, script);
  return box;
}

function renderMarket() {
  const prefs = readMarketPrefs();
  marketGrid.innerHTML = "";
  for (const tile of MARKET_TILES) {
    const idx = Math.min(prefs[tile.id] || 0, tile.symbols.length - 1);
    const { symbol, note } = tile.symbols[idx];
    const card = document.createElement("article");
    card.className = "market-tile";
    card.innerHTML = `
      <div class="market-tile-head"><strong></strong><button type="button" class="link-btn"></button></div>
      <p class="market-note"></p>`;
    card.querySelector("strong").textContent = tile.name;
    card.querySelector(".market-note").textContent = note;
    const btn = card.querySelector("button");
    if (tile.symbols.length > 1) {
      const next = tile.symbols[(idx + 1) % tile.symbols.length].symbol;
      btn.textContent = "다른 시세로 보기";
      btn.title = `지금: ${symbol}. 차트가 안 나오면 눌러서 ${next}로 바꿔 보세요.`;
      btn.addEventListener("click", () => {
        prefs[tile.id] = (idx + 1) % tile.symbols.length;
        saveMarketPrefs(prefs);
        renderMarket();
      });
    } else {
      btn.remove();
    }
    card.appendChild(marketWidget(symbol));
    marketGrid.appendChild(card);
  }
}

try {
  const savedRange = localStorage.getItem(MARKET_RANGE_KEY);
  if (savedRange && [...marketRange.options].some((o) => o.value === savedRange)) marketRange.value = savedRange;
} catch { /* 저장소 사용 불가 */ }

marketRange.addEventListener("change", () => {
  try { localStorage.setItem(MARKET_RANGE_KEY, marketRange.value); } catch { /* 저장소 사용 불가 */ }
  renderMarket();
});

if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderMarket);
}

renderMarket();
