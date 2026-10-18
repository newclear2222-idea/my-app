// 맨 위 시장 지표 4개: TradingView 무료 미니 차트 위젯(키 불필요, 페이지를 열어 두면 계속 갱신)
// 거래소 사정으로 위젯에서 시세가 안 나오는 종목이 있을 수 있어, 칸마다 다른 시세 출처로 바꿔 볼 수 있게 했다.
const MARKET_WIDGET = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
const MARKET_HEIGHT = 170;
const MARKET_PREF_KEY = "marketSymbols";
const MARKET_RANGE_KEY = "marketRange";

const MARKET_TILES = [
  { id: "nasdaq", name: "나스닥 종합지수", symbols: ["NASDAQ:IXIC", "NASDAQ:NDX"] },
  { id: "kospi", name: "코스피", symbols: ["KRX:KOSPI", "TVC:KOSPI"] },
  { id: "usdkrw", name: "원/달러 환율", symbols: ["FX_IDC:USDKRW", "FX:USDKRW"] },
  { id: "wti", name: "WTI 유가", symbols: ["TVC:USOIL", "NYMEX:CL1!"] },
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
    const symbol = tile.symbols[idx];
    const card = document.createElement("article");
    card.className = "market-tile";
    card.innerHTML = '<div class="market-tile-head"><strong></strong><button type="button" class="link-btn"></button></div>';
    card.querySelector("strong").textContent = tile.name;
    const btn = card.querySelector("button");
    btn.textContent = "다른 시세로 보기";
    btn.title = `지금: ${symbol}. 차트가 안 나오면 눌러서 ${tile.symbols[(idx + 1) % tile.symbols.length]}로 바꿔 보세요.`;
    btn.addEventListener("click", () => {
      prefs[tile.id] = (idx + 1) % tile.symbols.length;
      saveMarketPrefs(prefs);
      renderMarket();
    });
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
