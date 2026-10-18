// 그래프: TradingView 무료 위젯(주가 차트)과 Finnhub 무료 자료로 그린 EPS 실제 vs 예상 그래프
const tvContainer = document.getElementById("tv-chart");
const chartsStatusEl = document.getElementById("charts-status");
const epsChartEl = document.getElementById("eps-chart");
const epsStatusEl = document.getElementById("eps-status");
const epsTableEl = document.getElementById("eps-table");
const TV_SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const SVG_NS = "http://www.w3.org/2000/svg";
const TV_HEIGHT = 420;

let chartTicker = "";
let epsRows = [];

const prefersDark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

// TradingView 위젯은 스크립트 태그 안의 JSON 설정을 읽어 차트를 iframe으로 그린다. 키가 필요 없다.
function showPriceChart(ticker) {
  tvContainer.innerHTML = "";
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "100%";
  const script = document.createElement("script");
  script.src = TV_SCRIPT;
  script.async = true;
  // autosize는 iframe이 150px로 쪼그라드는 경우가 있어 높이를 직접 정한다(.tv-chart 높이와 맞춤).
  script.textContent = JSON.stringify({
    width: "100%",
    height: TV_HEIGHT,
    symbol: ticker,
    interval: "D",
    range: "12M",
    timezone: "Asia/Seoul",
    theme: prefersDark() ? "dark" : "light",
    style: "1",
    locale: "kr",
    allow_symbol_change: false,
    hide_side_toolbar: true,
    calendar: false,
    support_host: "https://www.tradingview.com",
  });
  script.onerror = () => setStatus(chartsStatusEl, "주가 차트(TradingView)를 불러오지 못했습니다. 인터넷 연결이나 광고 차단 확장 프로그램을 확인해 주세요.", "err");
  tvContainer.append(widget, script);
}

// ----- EPS 실제 vs 예상 (세로 막대 + 예상치 눈금) -----
// 그래프 너비는 화면 폭에 맞춘다(글씨가 휴대폰에서 작아지지 않도록 viewBox를 실제 픽셀 너비와 같게).
const W_MIN = 300;
const W_MAX = 640;
const H = 260;
const PAD = { top: 28, right: 12, bottom: 34, left: 48 };
const BAR_W = 24;
const TICK_W = 44;

function niceStep(range) {
  const raw = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// 끝(값 쪽)만 4px 둥글고 기준선 쪽은 각진 막대
function barPath(x, y0, y1, w, r) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, h, w / 2);
  if (h === 0) return "";
  if (up) {
    return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 + rr} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 - rr} V${y0} Z`;
}

const surprisePct = (r) =>
  r.actual !== null && r.estimate !== null && r.estimate !== 0
    ? ((r.actual - r.estimate) / Math.abs(r.estimate)) * 100
    : null;

// 예상 EPS가 0에 가까우면(예: $0.05) %가 수백 %로 부풀려지므로 달러 차이로 보여준다.
const SMALL_ESTIMATE = 0.1;

function surpriseText(r) {
  if (r.actual === null) return "발표 전";
  if (r.estimate === null) return "";
  const diff = r.actual - r.estimate;
  if (Math.abs(diff) < 0.005) return "예상 부합";
  const word = diff > 0 ? "상회" : "하회";
  if (Math.abs(r.estimate) < SMALL_ESTIMATE) return `${diff > 0 ? "+" : ""}${fmtUSD(diff)} ${word}`;
  return `${fmtPct(surprisePct(r))} ${word}`;
}

function renderEpsChart() {
  epsChartEl.innerHTML = "";
  epsTableEl.innerHTML = "";
  if (epsRows.length === 0) return;

  const values = epsRows.flatMap((r) => [r.actual, r.estimate]).filter((v) => v !== null);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const W = Math.round(Math.max(W_MIN, Math.min(W_MAX, epsChartEl.parentElement.clientWidth || W_MAX)));
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
  const band = (W - PAD.left - PAD.right) / epsRows.length;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "분기별 EPS 실제치와 예상치 비교 그래프" });

  for (let v = lo; v <= hi + step / 2; v += step) {
    const yy = y(v);
    svg.appendChild(svgEl("line", { x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy, class: Math.abs(v) < step / 1e6 ? "axis-zero" : "grid" }));
    const t = svgEl("text", { x: PAD.left - 8, y: yy + 4, class: "tick", "text-anchor": "end" });
    t.textContent = fmtUSD(Number(v.toFixed(2))).replace(/\.00$/, "");
    svg.appendChild(t);
  }

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;

  epsRows.forEach((r, i) => {
    const cx = PAD.left + band * i + band / 2;
    const g = svgEl("g", { class: "eps-col" });
    if (r.actual !== null) {
      g.appendChild(svgEl("path", { d: barPath(cx - BAR_W / 2, y(0), y(r.actual), BAR_W, 4), class: "bar" }));
    }
    if (r.estimate !== null) {
      g.appendChild(svgEl("line", { x1: cx - TICK_W / 2, x2: cx + TICK_W / 2, y1: y(r.estimate), y2: y(r.estimate), class: "est" }));
    }
    // 막대 끝에는 이 그래프의 핵심인 '예상 대비 %'만 적는다. 값은 툴팁과 표에.
    const capV = Math.max(r.actual ?? -Infinity, r.estimate ?? -Infinity);
    const cap = svgEl("text", { x: cx, y: Math.min(y(capV), y(0)) - 8, class: "cap", "text-anchor": "middle" });
    cap.textContent = surpriseText(r);
    g.appendChild(cap);
    const lab = svgEl("text", { x: cx, y: H - PAD.bottom + 20, class: "tick", "text-anchor": "middle" });
    lab.textContent = r.label;
    g.appendChild(lab);

    // 막대보다 넓은 투명 영역으로 마우스·터치를 받는다.
    const hit = svgEl("rect", { x: cx - band / 2, y: PAD.top, width: band, height: plotH, class: "hit" });
    const show = (e) => {
      tip.hidden = false;
      tip.textContent = `${r.label} (${r.period} 결산) · 실제 ${r.actual === null ? "발표 전" : fmtUSD(r.actual)} · 예상 ${r.estimate === null ? "-" : fmtUSD(r.estimate)}${surpriseText(r) ? ` · ${surpriseText(r)}` : ""}`;
      const box = epsChartEl.getBoundingClientRect();
      const px = (e.touches ? e.touches[0].clientX : e.clientX) - box.left;
      tip.style.left = `${Math.min(Math.max(px, 90), box.width - 90)}px`;
      g.classList.add("active");
    };
    const hide = () => { tip.hidden = true; g.classList.remove("active"); };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("touchstart", show, { passive: true });
    hit.addEventListener("mouseleave", hide);
    g.appendChild(hit);
    svg.appendChild(g);
  });

  epsChartEl.append(svg, tip);

  // 표로 보기
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>분기</th><th>실제 EPS</th><th>예상 EPS</th><th>예상 대비</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  for (const r of [...epsRows].reverse()) {
    const tr = document.createElement("tr");
    for (const text of [`${r.label} (${r.period})`, r.actual === null ? "발표 전" : fmtUSD(r.actual), r.estimate === null ? "-" : fmtUSD(r.estimate), surpriseText(r) || "-"]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  epsTableEl.appendChild(table);
}

async function loadEpsChart(ticker) {
  epsRows = [];
  renderEpsChart();
  const key = ApiKeyStore.get("finnhub");
  if (!key) {
    setStatus(epsStatusEl, "EPS 그래프는 Finnhub API 키가 있어야 그릴 수 있습니다.", "warn");
    return;
  }
  setStatus(epsStatusEl, `${ticker} 분기 EPS 자료를 불러오는 중입니다…`);
  try {
    epsRows = await fetchEarningsHistory(ticker, key, (sec) =>
      setStatus(epsStatusEl, `Finnhub 분당 호출 한도(60회)를 넘지 않도록 ${sec}초 기다리는 중입니다…`, "warn"));
  } catch (e) {
    setStatus(epsStatusEl, e instanceof ApiError ? e.message : "EPS 자료를 가져오는 중 알 수 없는 오류가 발생했습니다.", "err");
    return;
  }
  if (epsRows.length === 0) {
    setStatus(epsStatusEl, `${ticker}: 분기 EPS 자료가 없습니다.`, "warn");
    return;
  }
  const judged = epsRows.filter((r) => r.actual !== null && r.estimate !== null);
  const beats = judged.filter((r) => r.actual - r.estimate >= 0.005).length;
  setStatus(epsStatusEl, judged.length
    ? `${ticker}: 최근 ${judged.length}개 분기 중 ${beats}번 예상치 상회`
    : `${ticker}: 예상치와 비교할 수 있는 분기가 없습니다.`, "ok");
  renderEpsChart();
}

function loadCharts(ticker) {
  chartTicker = ticker;
  setStatus(chartsStatusEl, "");
  showPriceChart(ticker);
  loadTaChart(ticker);
  loadEpsChart(ticker);
}

let resizeTimer = null;
let lastChartWidth = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = epsChartEl.parentElement.clientWidth;
    if (epsRows.length && w !== lastChartWidth) {
      lastChartWidth = w;
      renderEpsChart();
    }
  }, 150);
});

// 화면 모드(라이트/다크)가 바뀌면 TradingView 차트 테마도 맞춘다.
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (chartTicker) showPriceChart(chartTicker);
  });
}
