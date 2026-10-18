// 이동평균선·볼린저밴드·RSI 차트: Alpha Vantage 무료 일봉으로 직접 계산해 그린다.
// 색: 주가는 주황 한 줄(강조), 이동평균선은 기간 순서대로 같은 파랑의 진하기를 달리한다(짧을수록 연함, 다크 모드는 반대).
// 선이 겹치므로 색만으로 구분하지 않도록 오른쪽 끝에 "200일" 같은 이름을 붙이고, 아래 표에 값을 함께 보여준다.
const taChartEl = document.getElementById("ta-chart");
const taRsiEl = document.getElementById("ta-rsi");
const taStatusEl = document.getElementById("ta-status");
const taSummaryEl = document.getElementById("ta-summary");
const taRangeSelect = document.getElementById("ta-range");
const TA_PREF_KEY = "taPrefs";
const TA_RANGES = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 };
const MA_PERIODS = [5, 20, 60, 120, 200];
const BB_PERIOD = 20;
const BB_K = 2;
const RSI_PERIOD = 14;
const TA_PAD = { top: 12, right: 52, bottom: 26, left: 56 };

let taData = null; // { rows, splits, full, ticker }

// ----- 계산 -----
function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function bollinger(values, n, k) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

// 와일더(Wilder) 방식 RSI
function rsi(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// ----- 설정(체크박스) -----
function readTaPrefs() {
  const defaults = { ma5: false, ma20: true, ma60: true, ma120: true, ma200: true, bb: false, rsi: false, range: "1Y" };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(TA_PREF_KEY) || "{}") }; } catch { return defaults; }
}

function saveTaPrefs(prefs) {
  try { localStorage.setItem(TA_PREF_KEY, JSON.stringify(prefs)); } catch { /* 저장소 사용 불가 */ }
}

const taPrefs = readTaPrefs();
for (const input of document.querySelectorAll("[data-ta]")) {
  input.checked = Boolean(taPrefs[input.dataset.ta]);
  input.addEventListener("change", () => {
    taPrefs[input.dataset.ta] = input.checked;
    saveTaPrefs(taPrefs);
    renderTaChart();
  });
}
if (TA_RANGES[taPrefs.range]) taRangeSelect.value = taPrefs.range;
taRangeSelect.addEventListener("change", () => {
  taPrefs.range = taRangeSelect.value;
  saveTaPrefs(taPrefs);
  renderTaChart();
});

// ----- 그리기 -----
function niceTicks(lo, hi, count = 5) {
  const step = niceStep((hi - lo) * (5 / count));
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step / 1e6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function pathFor(values, x, y, from) {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i + from).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

function fmtTaPrice(v) {
  return v >= 1000 ? `$${fmtNum(v, 0)}` : fmtUSD(v);
}

// 월이 바뀌는 지점에 날짜 눈금(최소 간격 유지)
function monthTicks(dates, x, minGap) {
  const out = [];
  let lastX = -Infinity;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].slice(0, 7) === dates[i - 1].slice(0, 7)) continue;
    const xx = x(i);
    if (xx - lastX < minGap) continue;
    const m = Number(dates[i].slice(5, 7));
    out.push({ x: xx, text: m === 1 ? `${dates[i].slice(0, 4)}년` : `${m}월` });
    lastX = xx;
  }
  return out;
}

function chartWidth(el) {
  return Math.round(Math.max(300, Math.min(960, el.parentElement.clientWidth || 640)));
}

function renderTaChart() {
  taChartEl.innerHTML = "";
  taRsiEl.innerHTML = "";
  taSummaryEl.innerHTML = "";
  if (!taData || taData.rows.length === 0) return;

  const rows = taData.rows;
  const closes = rows.map((r) => r.close);
  const dates = rows.map((r) => r.date);
  const n = Math.min(TA_RANGES[taPrefs.range] || 252, rows.length);
  const from = rows.length - n;

  const mas = MA_PERIODS.filter((p) => taPrefs[`ma${p}`]).map((p) => ({ p, values: sma(closes, p) }));
  const bb = taPrefs.bb ? bollinger(closes, BB_PERIOD, BB_K) : null;
  const rsiValues = taPrefs.rsi ? rsi(closes, RSI_PERIOD) : null;

  const visible = (arr) => arr.slice(from);
  const pool = [...visible(closes)];
  for (const m of mas) pool.push(...visible(m.values).filter((v) => v !== null));
  if (bb) pool.push(...visible(bb.upper).filter((v) => v !== null), ...visible(bb.lower).filter((v) => v !== null));
  let lo = Math.min(...pool);
  let hi = Math.max(...pool);
  const pad = (hi - lo) * 0.05 || hi * 0.05;
  lo -= pad;
  hi += pad;

  const W = chartWidth(taChartEl);
  const H = 320;
  const plotW = W - TA_PAD.left - TA_PAD.right;
  const plotH = H - TA_PAD.top - TA_PAD.bottom;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i) => TA_PAD.left + (i - from) * step;
  const y = (v) => TA_PAD.top + ((hi - v) / (hi - lo)) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "주가와 이동평균선 차트" });
  for (const t of niceTicks(lo, hi)) {
    svg.appendChild(svgEl("line", { x1: TA_PAD.left, x2: W - TA_PAD.right, y1: y(t), y2: y(t), class: "grid" }));
    const lab = svgEl("text", { x: TA_PAD.left - 8, y: y(t) + 4, class: "tick", "text-anchor": "end" });
    lab.textContent = fmtTaPrice(t);
    svg.appendChild(lab);
  }
  for (const t of monthTicks(dates.slice(from), (i) => x(i + from), 48)) {
    const lab = svgEl("text", { x: t.x, y: H - 6, class: "tick", "text-anchor": "middle" });
    lab.textContent = t.text;
    svg.appendChild(lab);
  }

  if (bb) {
    const up = visible(bb.upper);
    const lw = visible(bb.lower);
    let area = "";
    const idx = up.map((v, i) => (v === null ? null : i)).filter((i) => i !== null);
    if (idx.length) {
      area = idx.map((i, k) => `${k ? "L" : "M"}${x(i + from).toFixed(1)},${y(up[i]).toFixed(1)}`).join("") +
        [...idx].reverse().map((i) => `L${x(i + from).toFixed(1)},${y(lw[i]).toFixed(1)}`).join("") + "Z";
    }
    svg.appendChild(svgEl("path", { d: area, class: "bb-area" }));
    svg.appendChild(svgEl("path", { d: pathFor(up, x, y, from), class: "bb-line" }));
    svg.appendChild(svgEl("path", { d: pathFor(lw, x, y, from), class: "bb-line" }));
    svg.appendChild(svgEl("path", { d: pathFor(visible(bb.mid), x, y, from), class: "bb-mid" }));
  }

  // 긴 이동평균부터 그려서 짧은 선이 위에 오게 한다.
  for (const m of [...mas].reverse()) {
    svg.appendChild(svgEl("path", { d: pathFor(visible(m.values), x, y, from), class: `ma-line ma${m.p}` }));
  }
  svg.appendChild(svgEl("path", { d: pathFor(visible(closes), x, y, from), class: "price-line" }));

  // 오른쪽 끝 이름표: 겹치면(12px 이내) 건너뛰고 아래 표와 범례가 대신 알려준다.
  const ends = [{ label: "종가", v: closes[closes.length - 1], cls: "price" },
    ...mas.filter((m) => m.values[m.values.length - 1] !== null).map((m) => ({ label: `${m.p}일`, v: m.values[m.values.length - 1], cls: `ma${m.p}` }))];
  const placed = [];
  for (const e of ends.sort((a, b) => b.v - a.v)) {
    const yy = y(e.v);
    if (placed.some((p) => Math.abs(p - yy) < 12)) continue;
    placed.push(yy);
    svg.appendChild(svgEl("circle", { cx: W - TA_PAD.right + 6, cy: yy, r: 3, class: `end-dot ${e.cls}` }));
    const t = svgEl("text", { x: W - TA_PAD.right + 12, y: yy + 4, class: "end-label" });
    t.textContent = e.label;
    svg.appendChild(t);
  }

  // 마우스를 올리면 세로선과 그날 값들
  const cross = svgEl("line", { y1: TA_PAD.top, y2: TA_PAD.top + plotH, class: "crosshair", visibility: "hidden" });
  const dot = svgEl("circle", { r: 4, class: "hover-dot", visibility: "hidden" });
  svg.append(cross, dot);
  const tip = document.createElement("div");
  tip.className = "chart-tip ta-tip";
  tip.hidden = true;
  const hit = svgEl("rect", { x: TA_PAD.left, y: TA_PAD.top, width: plotW, height: plotH, class: "hit" });
  const onMove = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.touches ? e.touches[0].clientX : e.clientX) - box.left) * (W / box.width);
    const i = Math.max(from, Math.min(rows.length - 1, Math.round((px - TA_PAD.left) / (step || 1)) + from));
    const xx = x(i);
    cross.setAttribute("x1", xx);
    cross.setAttribute("x2", xx);
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", xx);
    dot.setAttribute("cy", y(closes[i]));
    dot.setAttribute("visibility", "visible");
    tip.innerHTML = "";
    const line = (cls, text) => {
      const row = document.createElement("div");
      if (cls) {
        const sw = document.createElement("span");
        sw.className = `tip-sw ${cls}`;
        row.appendChild(sw);
      }
      row.append(text);
      tip.appendChild(row);
    };
    line("", dates[i]);
    line("price", `종가 ${fmtUSD(closes[i])}`);
    for (const m of mas) if (m.values[i] !== null) line(`ma${m.p}`, `${m.p}일선 ${fmtUSD(m.values[i])}`);
    if (bb && bb.upper[i] !== null) line("bb", `볼린저 ${fmtUSD(bb.lower[i])} ~ ${fmtUSD(bb.upper[i])}`);
    if (rsiValues && rsiValues[i] !== null) line("", `RSI ${rsiValues[i].toFixed(1)}`);
    tip.hidden = false;
    const left = (xx / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 80), box.width - 80)}px`;
  };
  const onLeave = () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
  };
  hit.addEventListener("mousemove", onMove);
  hit.addEventListener("touchmove", onMove, { passive: true });
  hit.addEventListener("touchstart", onMove, { passive: true });
  hit.addEventListener("mouseleave", onLeave);
  svg.appendChild(hit);
  taChartEl.append(svg, tip);

  if (rsiValues) renderRsi(rsiValues, from, W, x, dates);
  renderTaSummary(closes, mas, bb, rsiValues);
}

function renderRsi(values, from, W, x, dates) {
  const H = 120;
  const top = 10;
  const plotH = H - top - 22;
  const y = (v) => top + ((100 - v) / 100) * plotH;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "RSI 14일 차트" });
  for (const [v, text] of [[70, "70 과매수"], [30, "30 과매도"]]) {
    svg.appendChild(svgEl("line", { x1: TA_PAD.left, x2: W - TA_PAD.right, y1: y(v), y2: y(v), class: "grid" }));
    const t = svgEl("text", { x: TA_PAD.left - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" });
    t.textContent = text.split(" ")[0];
    svg.appendChild(t);
    const t2 = svgEl("text", { x: W - TA_PAD.right + 6, y: y(v) + 4, class: "tick" });
    t2.textContent = text.split(" ")[1];
    svg.appendChild(t2);
  }
  svg.appendChild(svgEl("path", { d: pathFor(values.slice(from), x, y, from), class: "rsi-line" }));
  const title = svgEl("text", { x: TA_PAD.left, y: H - 4, class: "tick" });
  title.textContent = `RSI(${RSI_PERIOD}) · ${dates[dates.length - 1]} 기준 ${values[values.length - 1]?.toFixed(1) ?? "-"}`;
  svg.appendChild(title);
  taRsiEl.appendChild(svg);
}

function renderTaSummary(closes, mas, bb, rsiValues) {
  const last = closes[closes.length - 1];
  const lines = [];
  for (const m of mas) {
    const v = m.values[m.values.length - 1];
    if (v === null) {
      lines.push([`ma${m.p}`, `${m.p}일선`, "-", taData.full ? "거래일 수 부족" : "무료 플랜에서 100거래일만 제공되어 계산 불가"]);
      continue;
    }
    const gap = gapOf(last, v);
    lines.push([`ma${m.p}`, `${m.p}일선`, fmtUSD(v), `현재가가 ${fmtNum(Math.abs(gap), 1)}% ${gap >= 0 ? "위" : "아래"}`]);
  }
  if (bb) {
    const i = closes.length - 1;
    if (bb.upper[i] !== null) {
      const pctB = ((last - bb.lower[i]) / (bb.upper[i] - bb.lower[i])) * 100;
      const where = pctB > 100 ? "상단 돌파" : pctB < 0 ? "하단 이탈" : pctB >= 80 ? "상단 근처" : pctB <= 20 ? "하단 근처" : "밴드 안 중간";
      lines.push(["bb", `볼린저밴드(${BB_PERIOD},${BB_K})`, `${fmtUSD(bb.lower[i])} ~ ${fmtUSD(bb.upper[i])}`, `밴드 내 위치 ${fmtNum(pctB, 0)}% · ${where}`]);
    }
  }
  if (rsiValues) {
    const r = rsiValues[rsiValues.length - 1];
    if (r !== null) lines.push(["", `RSI(${RSI_PERIOD})`, r.toFixed(1), r >= 70 ? "과매수 구간(70 이상)" : r <= 30 ? "과매도 구간(30 이하)" : "중립(30~70)"]);
  }

  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>지표</th><th>최근 값</th><th>해석</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  const head = document.createElement("tr");
  head.innerHTML = '<td><span class="tip-sw price"></span>종가</td><td></td><td></td>';
  head.children[1].textContent = fmtUSD(last);
  head.children[2].textContent = taData.rows[taData.rows.length - 1].date;
  tbody.appendChild(head);
  for (const [cls, name, value, note] of lines) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    if (cls) {
      const sw = document.createElement("span");
      sw.className = `tip-sw ${cls}`;
      td.appendChild(sw);
    }
    td.append(name);
    tr.appendChild(td);
    for (const text of [value, note]) {
      const c = document.createElement("td");
      c.textContent = text;
      tr.appendChild(c);
    }
    tbody.appendChild(tr);
  }
  const wrap = document.createElement("div");
  wrap.className = "table-scroll ta-table";
  wrap.appendChild(table);
  taSummaryEl.appendChild(wrap);
}

async function loadTaChart(ticker) {
  taData = null;
  renderTaChart();
  const key = ApiKeyStore.get("alphavantage");
  if (!key) {
    setStatus(taStatusEl, "이동평균선 차트는 Alpha Vantage API 키가 있어야 그릴 수 있습니다. ('API 키 설정'에서 저장)", "warn");
    return;
  }
  setStatus(taStatusEl, `${ticker} 일봉 데이터를 불러오는 중입니다…`);
  try {
    const data = await fetchDailySeries(ticker, key);
    taData = { ...data, ticker };
  } catch (e) {
    setStatus(taStatusEl, e instanceof ApiError ? e.message : "일봉 데이터를 가져오는 중 알 수 없는 오류가 발생했습니다.", "err");
    return;
  }
  const notes = [`${ticker}: ${taData.rows[0].date} ~ ${taData.rows[taData.rows.length - 1].date} 일봉 ${taData.rows.length}개 (하루 한 번 받아 저장, 장 마감 기준)`];
  if (!taData.full) notes.push("무료 플랜에서 최근 100거래일만 받아 120일선·200일선은 계산할 수 없습니다.");
  if (taData.splits.length) {
    notes.push("액면분할 반영: " + taData.splits.map((s) => `${s.date} ${s.factor >= 1 ? `${s.factor}:1 분할` : `1:${Math.round(1 / s.factor)} 병합`}`).join(", "));
  }
  setStatus(taStatusEl, notes.join("\n"), taData.full ? "ok" : "warn");
  renderTaChart();
}

window.addEventListener("resize", () => {
  clearTimeout(window.taResizeTimer);
  window.taResizeTimer = setTimeout(() => { if (taData) renderTaChart(); }, 150);
});
