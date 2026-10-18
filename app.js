// 괴리율이 ±10% 이내면 "적정"으로 판정
const FAIR_BAND = 10;
const DCF_YEARS = 5;

const form = document.getElementById("valuation-form");
const errorEl = document.getElementById("error");
const resultsEl = document.getElementById("results");

const fmtUSD = (v) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  for (const m of priceMethods) {
    const ok = m.r.value !== null && Number.isFinite(m.r.value);
    methodsEl.appendChild(methodCard({
      title: m.title,
      valueText: ok ? fmtUSD(m.r.value) : "계산 불가",
      gapHtml: ok ? gapBadge(m.r.value, i.price) : `<span class="badge na">N/A</span> ${m.r.reason ?? ""}`,
      formula: m.r.formula,
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

form.addEventListener("reset", () => {
  errorEl.textContent = "";
  resultsEl.classList.add("hidden");
});

document.getElementById("sample").addEventListener("click", () => {
  const sample = {
    ticker: "SAMPLE", price: 180, eps: 6.5, bps: 4.4, fcf: 7.0,
    growth: 8, discount: 10, terminal: 2.5, "sector-per": 25,
  };
  for (const [id, v] of Object.entries(sample)) document.getElementById(id).value = v;
  errorEl.textContent = "";
});
