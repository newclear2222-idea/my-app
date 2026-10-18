// 실적발표 자료 분석 화면: 붙여넣은 글을 분석해 숫자 목록·추가 정보를 보여주고, 확인한 값을 입력칸에 적용한다.
const earningsText = document.getElementById("earnings-text");
const earningsSharesInput = document.getElementById("earnings-shares");
const earningsSharesNote = document.getElementById("earnings-shares-note");
const earningsStatusEl = document.getElementById("earnings-status");
const earningsResultsEl = document.getElementById("earnings-results");
const EARNINGS_LABEL = "실적발표";

// 분석 결과. 다시 분석하거나 지우기 전까지 유지되고, 주가·주식 수가 바뀌면 다시 그린다.
let earningsCandidates = null;

const GROWTH_KEYS = ["revenue", "eps", "fcf", "netIncome", "ocf", "grossProfit"];

function periodText(c) {
  if (c.period === "guidance") {
    return `가이던스(${{ quarter: "분기", annual: "연간" }[c.guidanceSpan] || "기간 불명"})`;
  }
  return { quarter: "분기 실적", annual: "연간 실적", ttm: "최근 12개월" }[c.period] || "기간 불명";
}

const isQuarterly = (c) => c.period === "quarter" || (c.period === "guidance" && c.guidanceSpan === "quarter");
const isActual = (c) => c.period !== "guidance";

// $2.10B (21.0억 달러)
function fmtBig(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  let en;
  if (abs >= 1e9) en = `${sign}$${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) en = `${sign}$${(abs / 1e6).toFixed(1)}M`;
  else en = fmtUSD(v);
  const ko = abs >= 1e8 ? ` (${sign}${fmtNum(abs / 1e8, 1)}억 달러)` : "";
  return en + ko;
}

function fmtShares(v) {
  return abs1e9(v) ? `${fmtNum(v / 1e9, 2)}B주 (${fmtNum(v / 1e6, 1)}백만 주)` : `${fmtNum(v / 1e6, 1)}백만 주`;
}
const abs1e9 = (v) => Math.abs(v) >= 1e9;

function valueText(c) {
  const range = (fmt) => (c.low !== null && c.high !== null ? ` (범위 ${fmt(c.low)} ~ ${fmt(c.high)})` : "");
  if (c.kind === "ratio") return `${fmtNum(c.value, 1)}%`;
  if (c.kind === "count") return fmtShares(c.value);
  if (c.kind === "perShare") return c.value === null ? "" : fmtUSD(c.value) + range(fmtUSD);
  return c.value === null ? "" : fmtBig(c.value) + range(fmtBig);
}

function growthText(c) {
  if (c.percent === null) return "";
  const kind = { yoy: "전년 대비", qoq: "전분기 대비" }[c.growthKind] || "기준 불명";
  return `${fmtPct(c.percent)} (${kind})`;
}

function earningsShares() {
  const m = Number(earningsSharesInput.value);
  return earningsSharesInput.value.trim() !== "" && m > 0 ? m * 1e6 : null;
}

// 후보 하나에 대해 입력칸에 적용할 수 있는 동작 목록. { text, apply } 또는 { text, disabled }
function earningsActions(c) {
  const actions = [];
  const shares = earningsShares();
  const factor = isQuarterly(c) ? 4 : 1;
  const x4 = factor === 4 ? ", 분기×4 연환산" : "";
  const detail = `${c.label} ${periodText(c)} — ${c.snippet}`;
  const to = (field, value, text) => actions.push({ text, apply: () => applyEarnings(field, value, detail) });

  if (c.key === "fcf" && c.value !== null) {
    if (shares) {
      const ps = (c.value * factor) / shares;
      to("fcf", ps, `주당 FCF에 적용 (${fmtUSD(ps)}${x4})`);
    } else {
      actions.push({ text: "주당 FCF로 바꾸려면 위에 주식 수를 입력하세요", disabled: true });
    }
  }
  if (c.key === "fcfPerShare" && c.value !== null) to("fcf", c.value * factor, `주당 FCF에 적용 (${fmtUSD(c.value * factor)}${x4})`);
  if (c.key === "eps" && c.value !== null) {
    if (c.period === "guidance") {
      if (c.guidanceSpan === "annual") to("forwardEps", c.value, `내년 예상 EPS에 적용 (${fmtUSD(c.value)})`);
    } else {
      const v = c.value * factor;
      to("eps", v, `EPS(TTM)에 적용 (${fmtUSD(v)}${factor === 4 ? ", 분기×4 대략치" : ""})`);
    }
  }
  if (GROWTH_KEYS.includes(c.key) && c.percent !== null && c.growthKind !== "qoq") {
    to("growth", c.percent, `성장률에 적용 (${fmtPct(c.percent)})`);
  }
  if (c.key === "shares" && c.value > 0) {
    actions.push({ text: `주식 수에 적용 (${fmtNum(c.value / 1e6, 1)}백만 주)`, apply: () => {
      earningsSharesInput.value = Math.round((c.value / 1e6) * 10) / 10;
      setSharesNote(`[${EARNINGS_LABEL}] 자료에 나온 주식 수`);
      renderEarnings();
    } });
  }
  return actions;
}

function applyEarnings(field, value, detail) {
  fillField(field, value, EARNINGS_LABEL, detail);
  updatePerPanel();
  renderEarnings();
  setStatus(earningsStatusEl, `${FIELD_NAMES[field]} 칸에 적용했습니다. 위 입력칸에서 [${EARNINGS_LABEL}] 표시를 확인하세요.`, "ok");
}

// OCF와 CapEx만 있고 FCF가 없으면 FCF = 영업현금흐름 − 설비투자로 계산해 후보에 넣는다.
function withDerivedFcf(cands) {
  const out = [...cands];
  for (const ocf of cands.filter((c) => c.key === "ocf" && c.value !== null)) {
    const capex = cands.find((c) => c.key === "capex" && c.value !== null && c.period === ocf.period);
    const hasFcf = cands.some((c) => c.key === "fcf" && c.value !== null && c.period === ocf.period);
    if (!capex || hasFcf) continue;
    out.push({
      key: "fcf", label: "잉여현금흐름(FCF, 계산)", kind: "money",
      value: ocf.value - Math.abs(capex.value), low: null, high: null, percent: null, growthKind: null,
      period: ocf.period, guidanceSpan: ocf.guidanceSpan,
      snippet: `영업현금흐름 ${fmtBig(ocf.value)} − 설비투자 ${fmtBig(Math.abs(capex.value))}로 계산`,
    });
  }
  return out;
}

// 추가 정보: FCF 마진·FCF 수익률·가이던스 비교·현재 입력값과 비교
function earningsInsights(cands) {
  const lines = [];
  const shares = earningsShares();
  const price = readNumber("price");
  const find = (key, pred = () => true) => cands.find((c) => c.key === key && c.value !== null && pred(c));

  const fcf = find("fcf", isActual);
  const rev = find("revenue", (c) => isActual(c) && (!fcf || c.period === fcf.period));
  if (fcf && rev && rev.value > 0) {
    lines.push(`FCF 마진: ${fmtNum((fcf.value / rev.value) * 100, 1)}% (FCF ${fmtBig(fcf.value)} ÷ 매출 ${fmtBig(rev.value)}, ${periodText(fcf)})`);
  }
  if (fcf && shares) {
    const factor = isQuarterly(fcf) ? 4 : 1;
    const ps = (fcf.value * factor) / shares;
    lines.push(`연간 FCF${factor === 4 ? "(분기×4)" : ""}: ${fmtBig(fcf.value * factor)} → 주당 ${fmtUSD(ps)}`);
    if (price > 0 && ps !== 0) {
      lines.push(`FCF 수익률: ${fmtNum((ps / price) * 100, 1)}% · P/FCF ${ps > 0 ? fmtNum(price / ps, 1) + "배" : "음수(현금 유출)"} (현재 주가 ${fmtUSD(price)} 기준)`);
    }
    const inputFcf = readNumber("fcf");
    if (Number.isFinite(inputFcf) && inputFcf !== 0) {
      lines.push(`입력된 주당 FCF ${fmtUSD(inputFcf)} 대비 자료 기준 ${fmtPct(((ps - inputFcf) / Math.abs(inputFcf)) * 100)}`);
    }
  }

  const revActualQ = find("revenue", (c) => c.period === "quarter");
  const revGuideQ = find("revenue", (c) => c.period === "guidance" && c.guidanceSpan === "quarter");
  if (revActualQ && revGuideQ) {
    lines.push(`다음 분기 매출 가이던스 ${fmtBig(revGuideQ.value)} → 이번 분기 ${fmtBig(revActualQ.value)} 대비 ${fmtPct(gapOf(revGuideQ.value, revActualQ.value))}`);
  }

  const epsGuideY = find("eps", (c) => c.period === "guidance" && c.guidanceSpan === "annual");
  const forwardEps = readNumber("forward-eps");
  if (epsGuideY && Number.isFinite(forwardEps) && forwardEps !== 0) {
    lines.push(`연간 EPS 가이던스 ${fmtUSD(epsGuideY.value)} vs 입력된 내년 예상 EPS ${fmtUSD(forwardEps)} → ${fmtPct(((epsGuideY.value - forwardEps) / Math.abs(forwardEps)) * 100)}`);
  }

  const epsActual = find("eps", isActual);
  const inputEps = readNumber("eps");
  if (epsActual && Number.isFinite(inputEps) && inputEps !== 0) {
    const annual = epsActual.value * (isQuarterly(epsActual) ? 4 : 1);
    lines.push(`입력된 EPS ${fmtUSD(inputEps)} vs 자료 EPS ${isQuarterly(epsActual) ? "×4 " : ""}${fmtUSD(annual)}`);
  }

  const growth = cands.find((c) => GROWTH_KEYS.includes(c.key) && c.percent !== null && c.growthKind !== "qoq");
  const inputGrowth = readNumber("growth");
  if (growth && Number.isFinite(inputGrowth)) {
    lines.push(`입력된 5년 성장률 ${fmtNum(inputGrowth, 1)}% vs 자료의 ${growth.label} 성장률 ${fmtPct(growth.percent)}` +
      " (한 분기 성장률을 5년 성장률로 그대로 쓰면 과대평가될 수 있어요)");
  }
  return lines;
}

function renderEarnings() {
  if (!earningsCandidates) return;
  earningsResultsEl.innerHTML = "";
  const cands = withDerivedFcf(earningsCandidates);
  if (cands.length === 0) {
    earningsResultsEl.innerHTML =
      '<p class="note">인식한 숫자가 없습니다. "잉여현금흐름 21억 달러", "매출 87억 달러(전년 대비 +37%)", "EPS $1.18"처럼 항목 이름과 숫자가 함께 있는 글이어야 합니다.</p>';
    return;
  }

  const list = document.createElement("div");
  list.className = "earn-list";
  for (const c of cands) {
    const item = document.createElement("article");
    item.className = "earn-item";
    item.innerHTML = `
      <div class="earn-head"><strong></strong><span class="earn-period"></span></div>
      <p class="earn-value"></p>
      <p class="earn-growth"></p>
      <blockquote class="earn-snippet"></blockquote>
      <div class="earn-actions"></div>`;
    item.querySelector("strong").textContent = c.label;
    item.querySelector(".earn-period").textContent = periodText(c);
    item.querySelector(".earn-value").textContent = valueText(c);
    item.querySelector(".earn-growth").textContent = growthText(c);
    item.querySelector(".earn-snippet").textContent = c.snippet;
    const actionsEl = item.querySelector(".earn-actions");
    const actions = earningsActions(c);
    if (actions.length === 0) actionsEl.innerHTML = '<span class="hint">참고 정보 (입력칸에 해당 없음)</span>';
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary small";
      btn.textContent = a.text;
      btn.disabled = Boolean(a.disabled);
      if (a.apply) btn.addEventListener("click", a.apply);
      actionsEl.appendChild(btn);
    }
    list.appendChild(item);
  }

  const insights = earningsInsights(cands);
  if (insights.length) {
    const box = document.createElement("div");
    box.className = "earn-insights";
    box.innerHTML = "<h3>추가 정보</h3><ul></ul>";
    const ul = box.querySelector("ul");
    for (const line of insights) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    }
    earningsResultsEl.appendChild(box);
  }
  earningsResultsEl.appendChild(list);
}

function setSharesNote(text) {
  earningsSharesNote.textContent = text;
}

// 불러오기에서 받은 주식 수를 넣는다. 새 종목을 불러오면 이전 종목 값은 지운다.
function setEarningsShares(shares) {
  earningsSharesInput.value = shares ? Math.round((shares.value / 1e6) * 10) / 10 : "";
  setSharesNote(shares ? `[${API_PROVIDERS[shares.provider].label}] 시가총액 ÷ 주가로 계산` : "");
  renderEarnings();
}

document.getElementById("earnings-analyze").addEventListener("click", () => {
  const text = earningsText.value.trim();
  if (!text) {
    setStatus(earningsStatusEl, "분석할 글을 붙여넣어 주세요.", "err");
    return;
  }
  earningsCandidates = parseEarningsText(text);
  const n = withDerivedFcf(earningsCandidates).length;
  setStatus(earningsStatusEl, n
    ? `${n}개 항목을 찾았습니다. 원문과 비교해 확인한 뒤 필요한 값만 적용하세요.`
    : "인식한 숫자가 없습니다.", n ? "ok" : "warn");
  renderEarnings();
});

document.getElementById("earnings-clear").addEventListener("click", () => {
  earningsText.value = "";
  earningsCandidates = null;
  earningsResultsEl.innerHTML = "";
  setStatus(earningsStatusEl, "");
});

earningsSharesInput.addEventListener("input", () => {
  setSharesNote(earningsSharesInput.value.trim() ? "직접 입력한 값" : "");
  renderEarnings();
});
