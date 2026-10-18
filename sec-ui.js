// SEC 공시 화면: 요약(최근 실적발표·분기/연간보고서·내부자 거래 수)과 공시 목록
const secStatusEl = document.getElementById("sec-status");
const secSummaryEl = document.getElementById("sec-summary");
const secListEl = document.getElementById("sec-list");
const secViewSelect = document.getElementById("sec-view");
const secCikInput = document.getElementById("sec-cik");
const SEC_MAX_ROWS = 25;
const SEC_VIEW_KEY = "secView";
const INSIDER_DAYS = 90;

let secTicker = "";
let secData = null;

try {
  const v = localStorage.getItem(SEC_VIEW_KEY);
  if (v && [...secViewSelect.options].some((o) => o.value === v)) secViewSelect.value = v;
} catch { /* 저장소 사용 불가 */ }

function formName(form) {
  return SEC_FORMS[form] || SEC_FORMS[form.replace(/\/A$/, "")] || "기타 공시";
}

function itemsText(items) {
  return items.filter((i) => i !== "9.01").map((i) => SEC_8K_ITEMS[i] || `항목 ${i}`).join(" · ");
}

function secLink(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

function renderSecSummary() {
  secSummaryEl.innerHTML = "";
  if (!secData) return;
  const f = secData.filings;
  const latest = (pred) => f.find(pred);
  const lines = [];
  const earn = latest(isEarnings8k);
  if (earn) lines.push(["최근 실적발표(8-K)", earn.date, earn]);
  const q = latest((x) => x.form === "10-Q");
  if (q) lines.push(["최근 분기보고서(10-Q)", `${q.date} 제출 · ${q.reportDate} 분기`, q]);
  const k = latest((x) => x.form === "10-K" || x.form === "20-F");
  if (k) lines.push([`최근 연간보고서(${k.form})`, `${k.date} 제출 · ${k.reportDate} 회계연도`, k]);
  const since = new Date(Date.now() - INSIDER_DAYS * 864e5).toISOString().slice(0, 10);
  const insider = f.filter((x) => x.form === "4" && x.date >= since).length;
  const sells = f.filter((x) => x.form === "144" && x.date >= since).length;

  const ul = document.createElement("ul");
  for (const [label, text, filing] of lines) {
    const li = document.createElement("li");
    li.append(`${label}: ${text} `);
    if (filing.url) li.appendChild(secLink(filing.url, "원문"));
    ul.appendChild(li);
  }
  const li = document.createElement("li");
  li.textContent = `최근 ${INSIDER_DAYS}일 내부자 거래 신고(Form 4) ${insider}건 · 매도 예정 신고(Form 144) ${sells}건`;
  ul.appendChild(li);
  secSummaryEl.appendChild(ul);
}

function renderSecList() {
  secListEl.innerHTML = "";
  if (!secData) return;
  const view = secViewSelect.value;
  const rows = secData.filings.filter((f) => view === "all" || f.category === view || (view === "major" && f.category === "earnings"));
  if (rows.length === 0) {
    secListEl.innerHTML = '<p class="note">이 분류의 최근 공시가 없습니다.</p>';
    return;
  }
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>제출일</th><th>종류</th><th>내용</th><th>보기</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  for (const f of rows.slice(0, SEC_MAX_ROWS)) {
    const tr = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = f.date;
    const form = document.createElement("td");
    const code = document.createElement("strong");
    code.textContent = f.form;
    form.append(code, document.createElement("br"), formName(f.form));
    const desc = document.createElement("td");
    const parts = [];
    if (f.items.length) parts.push(itemsText(f.items));
    if (f.reportDate && /^10-[KQ]|20-F/.test(f.form)) parts.push(`${f.reportDate} 기준`);
    desc.textContent = parts.join(" · ") || "-";
    if (f.category === "earnings") {
      const badge = document.createElement("span");
      badge.className = "badge fair news-badge";
      badge.textContent = "실적";
      desc.prepend(badge, " ");
    }
    const links = document.createElement("td");
    links.className = "sec-links";
    if (f.url) links.appendChild(secLink(f.url, "원문"));
    links.appendChild(secLink(f.indexUrl, f.category === "earnings" ? "첨부(보도자료)" : "첨부 목록"));
    tr.append(date, form, desc, links);
    tbody.appendChild(tr);
  }
  const wrap = document.createElement("div");
  wrap.className = "table-scroll sec-table";
  wrap.appendChild(table);
  secListEl.appendChild(wrap);
  if (rows.length > SEC_MAX_ROWS) {
    const more = document.createElement("p");
    more.className = "hint";
    more.append(`최근 ${SEC_MAX_ROWS}건만 표시했습니다. 전체는 `);
    more.appendChild(secLink(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${secData.cik}`, "SEC EDGAR"));
    more.append("에서 볼 수 있습니다.");
    secListEl.appendChild(more);
  }
}

async function loadSec(ticker, manualCik) {
  secTicker = ticker || secTicker;
  secData = null;
  renderSecSummary();
  renderSecList();
  if (!secTicker && !manualCik) {
    setStatus(secStatusEl, "위에서 티커를 불러오면 SEC 공시가 나옵니다.", "warn");
    return;
  }
  setStatus(secStatusEl, `${secTicker || "회사"} SEC 공시를 불러오는 중입니다…`);
  let cik = manualCik ? padCik(manualCik) : await resolveCik(secTicker);
  if (!cik) {
    setStatus(secStatusEl, `${secTicker}의 SEC 회사 번호(CIK)를 찾지 못했습니다. 아래 칸에 CIK를 직접 넣어 주세요. (SEC 회사 검색에서 확인 가능)`, "warn");
    secCikInput.value = "";
    return;
  }
  secCikInput.value = cik;
  try {
    secData = await fetchSecFilings(cik);
  } catch (e) {
    setStatus(secStatusEl, e.message, "err");
    return;
  }
  if (manualCik && secTicker) rememberCik(secTicker, cik);
  setStatus(secStatusEl, `${secData.name} (CIK ${secData.cik}) · 최근 공시 ${secData.filings.length}건`, "ok");
  renderSecSummary();
  renderSecList();
}

secViewSelect.addEventListener("change", () => {
  try { localStorage.setItem(SEC_VIEW_KEY, secViewSelect.value); } catch { /* 저장소 사용 불가 */ }
  renderSecList();
});

document.getElementById("sec-cik-apply").addEventListener("click", () => {
  const v = secCikInput.value.replace(/\D/g, "");
  if (!v) {
    setStatus(secStatusEl, "CIK 번호(숫자)를 입력해 주세요.", "err");
    return;
  }
  loadSec(secTicker, v);
});
