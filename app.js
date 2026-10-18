// 괴리율이 ±10% 이내면 "적정"으로 판정
const FAIR_BAND = 10;
const DCF_YEARS = 5;

const form = document.getElementById("valuation-form");
const errorEl = document.getElementById("error");
const resultsEl = document.getElementById("results");

const fmtUSD = (v) =>
  (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%";
const fmtNum = (v, d = 2) => v.toLocaleString("en-US", { maximumFractionDigits: d });

function readNumber(id) {
  const raw = document.getElementById(id).value.trim();
  return raw === "" ? NaN : Number(raw);
}

function readInputs() {
  return {
    ticker: document.getElementById("ticker").value.trim().toUpperCase(),
    price: readNumber("price"),
    eps: readNumber("eps"),
    bps: readNumber("bps"),
    fcf: readNumber("fcf"),
    growth: readNumber("growth"),
    discount: readNumber("discount"),
    terminal: readNumber("terminal"),
    sectorPer: readNumber("sector-per"),
  };
}

function validate(i) {
  const required = [
    ["price", "현재 주가"], ["eps", "EPS"], ["fcf", "주당 FCF"], ["growth", "예상 성장률"],
    ["discount", "할인율"], ["terminal", "영구성장률"], ["sectorPer", "업종 평균 PER"],
  ];
  for (const [key, name] of required) {
    if (!Number.isFinite(i[key])) return `${name}을(를) 숫자로 입력해 주세요.`;
  }
  if (i.price <= 0) return "현재 주가는 0보다 커야 합니다.";
  if (i.sectorPer <= 0) return "업종 평균 PER은 0보다 커야 합니다.";
  if (i.discount <= i.terminal) return "할인율은 영구성장률보다 커야 DCF 계산이 가능합니다.";
  return "";
}

function verdictOf(gap) {
  if (gap >= FAIR_BAND) return { text: "저평가", cls: "under" };
  if (gap <= -FAIR_BAND) return { text: "고평가", cls: "over" };
  return { text: "적정", cls: "fair" };
}

// 괴리율: 적정가가 현재가보다 몇 % 높은지(+) 또는 낮은지(-)
const gapOf = (fair, price) => ((fair - price) / price) * 100;

function calcPer(i) {
  const formula = `${fmtUSD(i.eps)} × ${fmtNum(i.sectorPer)}배`;
  if (i.eps <= 0) return { value: null, formula, reason: "EPS가 0 이하(적자)라 PER 방식은 쓸 수 없습니다." };
  return { value: i.eps * i.sectorPer, formula };
}

function calcDcf(i) {
  const g = i.growth / 100;
  const r = i.discount / 100;
  const tg = i.terminal / 100;
  let pv = 0;
  let fcf = i.fcf;
  for (let t = 1; t <= DCF_YEARS; t++) {
    fcf *= 1 + g;
    pv += fcf / Math.pow(1 + r, t);
  }
  const terminalValue = (fcf * (1 + tg)) / (r - tg);
  const pvTerminal = terminalValue / Math.pow(1 + r, DCF_YEARS);
  const formula =
    `5년 FCF 현재가치 ${fmtUSD(pv)} + 터미널 가치 현재가치 ${fmtUSD(pvTerminal)}`;
  if (i.fcf <= 0) return { value: null, formula, reason: "주당 FCF가 0 이하라 DCF 결과를 신뢰하기 어렵습니다." };
  return { value: pv + pvTerminal, formula };
}

function calcGraham(i) {
  const multiple = 8.5 + 2 * i.growth;
  const formula = `${fmtUSD(i.eps)} × (8.5 + 2 × ${fmtNum(i.growth)}) = ${fmtUSD(i.eps)} × ${fmtNum(multiple)}`;
  if (i.eps <= 0) return { value: null, formula, reason: "EPS가 0 이하(적자)라 그레이엄 공식은 쓸 수 없습니다." };
  if (multiple <= 0) return { value: null, formula, reason: "성장률이 너무 낮아 배수가 0 이하가 됩니다." };
  return { value: i.eps * multiple, formula };
}

function calcPeg(i) {
  if (i.eps <= 0) return { peg: null, per: null, reason: "EPS가 0 이하(적자)라 PER·PEG를 구할 수 없습니다." };
  const per = i.price / i.eps;
  if (i.growth <= 0) return { peg: null, per, reason: "성장률이 0 이하라 PEG를 구할 수 없습니다." };
  return { peg: per / i.growth, per };
}

const EXPLAIN = {
  per: "이 회사가 같은 업종 회사들과 비슷한 수준으로 평가받는다면 주가가 얼마일지 계산합니다. PER은 '이익 1달러에 몇 달러를 지불하는가'를 뜻합니다.",
  dcf: "회사가 앞으로 벌어들일 현금을 지금 가치로 바꿔 모두 더한 값입니다. 미래의 1달러는 오늘의 1달러보다 가치가 낮기 때문에 할인율로 깎아서 계산합니다. 5년 이후는 영구성장률로 계속 성장한다고 가정합니다(터미널 가치).",
  graham: "'가치투자의 아버지' 벤저민 그레이엄이 제안한 간단한 공식입니다. 성장이 없는 회사의 기본 PER을 8.5로 보고, 성장률 1%마다 PER을 2씩 더 쳐줍니다.",
  peg: "PER을 성장률로 나눈 값입니다. PER이 높아도 그만큼 빨리 성장하면 비싸지 않다고 보는 지표로, 1 미만이면 성장에 비해 주가가 싸다는(저평가) 신호로 봅니다. 가격이 아닌 비율이라 평균 적정가에는 포함하지 않습니다.",
};

function methodCard({ title, valueText, gapHtml, formula, explain }) {
  const el = document.createElement("article");
  el.className = "method";
  el.innerHTML = `
    <h3></h3>
    <p class="result"></p>
    <p class="gap"></p>
    <p class="formula"></p>
    <p class="explain"></p>`;
  el.querySelector("h3").textContent = title;
  el.querySelector(".result").textContent = valueText;
  el.querySelector(".gap").innerHTML = gapHtml;
  el.querySelector(".formula").textContent = formula;
  el.querySelector(".explain").textContent = explain;
  return el;
}

function gapBadge(fair, price) {
  const gap = gapOf(fair, price);
  const v = verdictOf(gap);
  return `괴리율 ${fmtPct(gap)} <span class="badge ${v.cls}">${v.text}</span>`;
}

function render(i) {
  const per = calcPer(i);
  const dcf = calcDcf(i);
  const graham = calcGraham(i);
  const peg = calcPeg(i);

  const priceMethods = [
    { key: "per", title: "1) PER 기준", r: per },
    { key: "dcf", title: "2) DCF (현금흐름 할인)", r: dcf },
    { key: "graham", title: "3) 그레이엄 공식", r: graham },
  ];

  const methodsEl = document.getElementById("methods");
  methodsEl.innerHTML = "";

  const peerNote = fieldNote("sectorPer");

  for (const m of priceMethods) {
    const ok = m.r.value !== null && Number.isFinite(m.r.value);
    methodsEl.appendChild(methodCard({
      title: m.title,
      valueText: ok ? fmtUSD(m.r.value) : "계산 불가",
      gapHtml: ok ? gapBadge(m.r.value, i.price) : `<span class="badge na">N/A</span> ${m.r.reason ?? ""}`,
      formula: m.key === "per" && peerNote ? `${m.r.formula}\n${peerNote}` : m.r.formula,
      explain: EXPLAIN[m.key],
    }));
  }

  let pegGap;
  if (peg.peg === null) {
    pegGap = `<span class="badge na">N/A</span> ${peg.reason}`;
  } else if (peg.peg < 1) {
    pegGap = `<span class="badge under">저평가 신호</span>`;
  } else {
    pegGap = `<span class="badge over">저평가 신호 아님</span>`;
  }
  methodsEl.appendChild(methodCard({
    title: "4) PEG",
    valueText: peg.peg === null ? "계산 불가" : `PEG ${peg.peg.toFixed(2)}`,
    gapHtml: pegGap,
    formula: peg.per === null
      ? "PER ÷ 성장률"
      : `PER ${fmtNum(peg.per)}배 (= ${fmtUSD(i.price)} ÷ ${fmtUSD(i.eps)}) ÷ 성장률 ${fmtNum(i.growth)}`,
    explain: EXPLAIN.peg,
  }));

  const valid = priceMethods.map((m) => m.r.value).filter((v) => v !== null && Number.isFinite(v));
  document.getElementById("sum-price").textContent = fmtUSD(i.price);
  const verdictEl = document.getElementById("sum-verdict");
  const noteEl = document.getElementById("sum-note");

  if (valid.length === 0) {
    document.getElementById("sum-fair").textContent = "계산 불가";
    document.getElementById("sum-gap").textContent = "-";
    verdictEl.textContent = "N/A";
    verdictEl.className = "value badge na";
    noteEl.textContent = "유효한 적정가가 없어 평균을 낼 수 없습니다.";
  } else {
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    const gap = gapOf(avg, i.price);
    const v = verdictOf(gap);
    document.getElementById("sum-fair").textContent = fmtUSD(avg);
    document.getElementById("sum-gap").textContent = fmtPct(gap);
    verdictEl.textContent = v.text;
    verdictEl.className = `value badge ${v.cls}`;
    let note = `평균 적정가는 계산 가능한 ${valid.length}가지 방법(PER·DCF·그레이엄 중)의 단순 평균입니다. ` +
      `괴리율 = (적정가 − 현재가) ÷ 현재가. +${FAIR_BAND}% 이상이면 저평가, −${FAIR_BAND}% 이하면 고평가, 그 사이는 적정으로 판정합니다.`;
    if (Number.isFinite(i.bps) && i.bps > 0) {
      note += ` 참고: PBR(주가 ÷ BPS)은 ${fmtNum(i.price / i.bps)}배입니다.`;
    }
    noteEl.textContent = note;
  }

  document.getElementById("results-title").textContent = i.ticker ? `${i.ticker} 분석 결과` : "분석 결과";
  resultsEl.classList.remove("hidden");
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const inputs = readInputs();
  const err = validate(inputs);
  errorEl.textContent = err;
  if (err) {
    resultsEl.classList.add("hidden");
    return;
  }
  render(inputs);
});

const loadStatusEl = document.getElementById("load-status");

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

const FIELD_IDS = {
  price: "price", eps: "eps", bps: "bps", fcf: "fcf", growth: "growth", sectorPer: "sector-per",
  forwardEps: "forward-eps", targetPrice: "target-price",
};
// 칸 아래에 출처 설명이나 "직접 입력 필요"를 보여주는 칸
const NOTE_FIELDS = ["sectorPer", "forwardEps", "targetPrice"];

// 자동 입력 칸마다 출처 표시([FMP] / [Finnhub])를 입력칸 옆에 붙인다.
for (const id of Object.values(FIELD_IDS)) {
  const input = document.getElementById(id);
  const wrap = document.createElement("span");
  wrap.className = "input-wrap";
  input.replaceWith(wrap);
  const tag = document.createElement("span");
  tag.className = "src-tag";
  tag.id = `src-${id}`;
  wrap.append(input, tag);
}

function setFieldNote(field, text, missing = false) {
  const el = document.getElementById(`${FIELD_IDS[field]}-note`);
  el.textContent = text;
  el.classList.toggle("missing", missing);
}

// 자동 입력된 칸의 출처 설명. 직접 고치면 사라진다.
function fieldNote(field) {
  const el = document.getElementById(`${FIELD_IDS[field]}-note`);
  return el.classList.contains("missing") ? "" : el.textContent;
}

function clearFieldNotes() {
  for (const f of NOTE_FIELDS) setFieldNote(f, "");
}

function unmarkAutofill(el) {
  el.classList.remove("autofilled");
  el.removeAttribute("title");
  const tag = document.getElementById(`src-${el.id}`);
  if (tag) tag.textContent = "";
  const field = NOTE_FIELDS.find((f) => FIELD_IDS[f] === el.id);
  if (field) setFieldNote(field, "");
}

function clearAutofill() {
  for (const el of form.querySelectorAll("input.autofilled")) unmarkAutofill(el);
}

// 칸에 값을 넣고 파란 테두리와 [출처] 표시를 붙인다. (불러오기와 실적발표 자료 적용에서 함께 쓴다)
function fillField(field, value, label, detail) {
  const el = document.getElementById(FIELD_IDS[field]);
  el.value = Math.round(value * 100) / 100;
  el.classList.add("autofilled");
  el.title = `자동 입력 (${label}): ${detail}`;
  document.getElementById(`src-${el.id}`).textContent = `[${label}]`;
  if (NOTE_FIELDS.includes(field)) setFieldNote(field, `[${label}] ${detail}`);
}

// ----- PER 비교 (현재 PER · 업종 PER) / 선행 PER 비교 (목표주가 기준 · 현재 주가 기준) -----
function setPerStat(id, text, sub = "", na = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle("na", na);
  document.getElementById(`${id}-sub`).textContent = sub;
}

function compareText(name, per, sectorPer) {
  const diff = ((per - sectorPer) / sectorPer) * 100;
  const rounded = Math.round(Math.abs(diff));
  const verdict = rounded === 0 ? "업종과 비슷" : `업종보다 ${rounded}% ${diff < 0 ? "낮음" : "높음"}`;
  return `${name} ${per.toFixed(1)}배 vs 업종 ${sectorPer.toFixed(1)}배 → ${verdict}`;
}

function updatePerPanel() {
  const price = readNumber("price");
  const eps = readNumber("eps");
  const sectorPer = readNumber("sector-per");
  const hasPrice = Number.isFinite(price) && price > 0;
  const lines = [];

  let current = null;
  if (!hasPrice || !Number.isFinite(eps)) {
    setPerStat("per-current", "-", "주가와 EPS를 입력하면 계산됩니다.");
  } else if (eps <= 0) {
    setPerStat("per-current", "적자로 PER 계산 불가", `EPS ${fmtUSD(eps)}`, true);
  } else {
    current = price / eps;
    setPerStat("per-current", `${current.toFixed(1)}배`, `${fmtUSD(price)} ÷ ${fmtUSD(eps)}`);
  }

  const hasSector = Number.isFinite(sectorPer) && sectorPer > 0;
  if (hasSector) {
    const peerNote = fieldNote("sectorPer");
    setPerStat("per-sector", `${sectorPer.toFixed(1)}배`, peerNote ? peerNote.replace(/^경쟁사 기준: /, "") : "직접 입력한 값");
  } else {
    setPerStat("per-sector", "-", "업종 PER을 입력하거나 불러오면 비교합니다.");
  }

  // 선행 PER: 같은 내년 예상 EPS로 목표주가와 현재 주가를 각각 나눈다.
  const forwardEps = readNumber("forward-eps");
  const target = readNumber("target-price");
  const hasForward = Number.isFinite(forwardEps);
  const hasTarget = Number.isFinite(target) && target > 0;
  let fwdTarget = null;
  let fwdPrice = null;

  if (!hasForward) {
    setPerStat("per-fwd-target", "내년 예상 EPS 직접 입력 필요", "", true);
    setPerStat("per-fwd-price", "내년 예상 EPS 직접 입력 필요", "", true);
  } else if (forwardEps <= 0) {
    setPerStat("per-fwd-target", "예상 적자로 계산 불가", `예상 EPS ${fmtUSD(forwardEps)}`, true);
    setPerStat("per-fwd-price", "예상 적자로 계산 불가", `예상 EPS ${fmtUSD(forwardEps)}`, true);
  } else {
    if (hasTarget) {
      fwdTarget = target / forwardEps;
      setPerStat("per-fwd-target", `${fwdTarget.toFixed(1)}배`, `목표주가 ${fmtUSD(target)} ÷ ${fmtUSD(forwardEps)}`);
    } else {
      setPerStat("per-fwd-target", "목표주가 직접 입력 필요", "", true);
    }
    if (hasPrice) {
      fwdPrice = price / forwardEps;
      setPerStat("per-fwd-price", `${fwdPrice.toFixed(1)}배`, `현재 주가 ${fmtUSD(price)} ÷ ${fmtUSD(forwardEps)}`);
    } else {
      setPerStat("per-fwd-price", "-", "주가를 입력하면 계산됩니다.");
    }
  }

  if (hasSector && current !== null) lines.push(compareText("현재 PER", current, sectorPer));
  if (hasSector && fwdPrice !== null) lines.push(compareText("선행 PER", fwdPrice, sectorPer));
  document.getElementById("per-compare").textContent = lines.join("\n");

  let fwdLine = "";
  if (hasTarget && hasPrice) {
    const upside = `목표가까지 ${fmtPct(gapOf(target, price))}`;
    fwdLine = fwdTarget !== null && fwdPrice !== null
      ? `애널리스트는 선행 PER ${fwdTarget.toFixed(1)}배를 적정하다고 봄 / 현재 ${fwdPrice.toFixed(1)}배에 거래 중 → ${upside}`
      : `목표주가 ${fmtUSD(target)} / 현재 주가 ${fmtUSD(price)} → ${upside}`;
  }
  document.getElementById("fwd-compare").textContent = fwdLine;

  const meta = [];
  if (hasTarget) meta.push(`목표주가 ${fmtUSD(target)}: ${fieldNote("targetPrice") || "직접 입력한 값"}`);
  if (hasForward) meta.push(`내년 예상 EPS ${fmtUSD(forwardEps)}: ${fieldNote("forwardEps") || "직접 입력한 값"}`);
  document.getElementById("fwd-meta").textContent = meta.join("\n");
}

// 새 티커를 불러오기 전에 이전 종목 값이 남지 않도록 자동 입력 대상 칸을 모두 비운다.
function clearFetchedFields() {
  for (const id of Object.values(FIELD_IDS)) {
    const el = document.getElementById(id);
    el.value = "";
    unmarkAutofill(el);
  }
  clearFieldNotes();
  updatePerPanel();
}

form.addEventListener("reset", () => {
  errorEl.textContent = "";
  resultsEl.classList.add("hidden");
  setStatus(loadStatusEl, "");
  clearAutofill();
  clearFieldNotes();
  // reset 이벤트는 칸이 비워지기 전에 발생하므로 다음 틱에 다시 계산한다.
  setTimeout(updatePerPanel, 0);
});

// 자동으로 채운 칸을 직접 고치면 표시를 없애고, PER 비교를 바로 다시 계산한다.
form.addEventListener("input", (e) => {
  if (e.target.classList.contains("autofilled")) unmarkAutofill(e.target);
  updatePerPanel();
  renderEarnings();
});

document.getElementById("sample").addEventListener("click", () => {
  const sample = {
    ticker: "SAMPLE", price: 180, eps: 6.5, bps: 4.4, fcf: 7.0,
    growth: 8, discount: 10, terminal: 2.5, "sector-per": 25,
  };
  for (const [id, v] of Object.entries(sample)) document.getElementById(id).value = v;
  clearAutofill();
  clearFieldNotes();
  updatePerPanel();
  errorEl.textContent = "";
});

// ----- API 키 설정 (FMP, Finnhub 각각) -----
for (const block of document.querySelectorAll(".key-block")) {
  const provider = block.dataset.provider;
  const keyInput = block.querySelector(".key-input");
  const keyStatusEl = block.querySelector(".key-status");

  const showKeyStatus = () => {
    const key = ApiKeyStore.get(provider);
    if (key) {
      setStatus(keyStatusEl, `저장된 키: ••••${key.slice(-4)} (이 브라우저에만 저장됨)`, "ok");
    } else {
      setStatus(keyStatusEl, "저장된 키가 없습니다.", "warn");
    }
  };

  block.querySelector(".key-save").addEventListener("click", () => {
    const key = keyInput.value.trim();
    if (!key) {
      setStatus(keyStatusEl, "API 키를 입력해 주세요.", "err");
      return;
    }
    if (!ApiKeyStore.set(provider, key)) {
      setStatus(keyStatusEl, "브라우저 저장소를 쓸 수 없습니다. 시크릿 창이거나 사이트 데이터 저장이 차단되어 있는지 확인해 주세요.", "err");
      return;
    }
    keyInput.value = "";
    showKeyStatus();
  });

  block.querySelector(".key-clear").addEventListener("click", () => {
    ApiKeyStore.clear(provider);
    keyInput.value = "";
    showKeyStatus();
  });

  block.querySelector(".key-toggle").addEventListener("click", (e) => {
    const hidden = keyInput.type === "password";
    keyInput.type = hidden ? "text" : "password";
    e.target.textContent = hidden ? "숨기기" : "보기";
  });

  showKeyStatus();
}

// ----- 불러오기 -----
const loadBtn = document.getElementById("load");
const tickerInput = document.getElementById("ticker");

async function loadTicker() {
  const ticker = tickerInput.value.trim().toUpperCase();
  tickerInput.value = ticker;
  if (!ticker) {
    setStatus(loadStatusEl, "티커를 입력해 주세요. (예: AAPL)", "err");
    return;
  }
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    setStatus(loadStatusEl, "티커 형식이 올바르지 않습니다. 영문 티커를 입력해 주세요. (예: AAPL, BRK.B)", "err");
    return;
  }
  if (!ApiKeyStore.get("fmp") && !ApiKeyStore.get("finnhub")) {
    setStatus(loadStatusEl, "먼저 위의 'API 키 설정'에서 FMP 또는 Finnhub API 키를 저장해 주세요.", "err");
    return;
  }

  loadBtn.disabled = true;
  loadBtn.textContent = "불러오는 중…";
  clearFetchedFields();
  errorEl.textContent = "";
  resultsEl.classList.add("hidden");
  const loadingText = `${ticker} 데이터를 불러오는 중입니다…`;
  setStatus(loadStatusEl, loadingText);
  const onWait = (sec) =>
    setStatus(loadStatusEl, `Finnhub 분당 호출 한도(60회)를 넘지 않도록 ${sec}초 기다리는 중입니다…`, "warn");
  const onProgress = (done, total) =>
    setStatus(loadStatusEl, `${ticker} 경쟁사 PER 불러오는 중… (${done}/${total})`);
  try {
    const { values, sources, warnings, shares } = await fetchFundamentals(ticker, { onWait, onProgress });
    for (const [key, v] of Object.entries(values)) {
      fillField(key, v, API_PROVIDERS[sources[key].provider].label, sources[key].detail);
    }
    setEarningsShares(shares);
    loadNews(ticker); // 기다리지 않고 따로 불러온다
    for (const f of NOTE_FIELDS) {
      if (values[f] === undefined) {
        setFieldNote(f, "직접 입력 필요", true);
      } else {
        const src = sources[f];
        setFieldNote(f, src.note || `[${API_PROVIDERS[src.provider].label}] ${src.detail}`);
      }
    }
    updatePerPanel();
    const filled = Object.keys(values).length;
    let text = `${ticker}: ${filled}개 항목을 채웠습니다. 칸에 마우스를 올리면 자세한 출처가 보입니다.`;
    if (warnings.length) text += "\n직접 입력이 필요한 항목:\n· " + warnings.join("\n· ");
    setStatus(loadStatusEl, text, warnings.length ? "warn" : "ok");

    const inputs = readInputs();
    if (!validate(inputs)) {
      errorEl.textContent = "";
      render(inputs);
    }
  } catch (e) {
    const message = e instanceof ApiError ? e.message : "데이터를 가져오는 중 알 수 없는 오류가 발생했습니다.";
    setStatus(loadStatusEl, message, "err");
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = "불러오기";
  }
}

loadBtn.addEventListener("click", loadTicker);
tickerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    loadTicker();
  }
});

updatePerPanel();
