// SEC 공시(EDGAR): data.sec.gov의 무료 공시 목록 API (키 불필요, 브라우저에서 바로 호출 가능)
// 공시 원문(www.sec.gov/Archives)은 다른 사이트에서 내용을 가져갈 수 없게 막혀 있어 링크로만 연다.
const SEC_SUBMISSIONS = "https://data.sec.gov/submissions/";
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data/";
const SEC_CIK_PREFIX = "secCik:";
const SEC_CACHE_MS = 10 * 60 * 1000;
const secCache = new Map();

const SEC_FORMS = {
  "10-K": "연간보고서",
  "10-K/A": "연간보고서 정정",
  "10-Q": "분기보고서",
  "10-Q/A": "분기보고서 정정",
  "8-K": "수시공시(주요 사건)",
  "8-K/A": "수시공시 정정",
  "20-F": "연간보고서(외국기업)",
  "6-K": "수시공시(외국기업)",
  "40-F": "연간보고서(캐나다 기업)",
  "DEF 14A": "주주총회 위임장 자료",
  "DEFA14A": "위임장 추가 자료",
  "PRE 14A": "위임장 예비 자료",
  "S-1": "상장(증권 신고)서",
  "S-3": "증권 발행 등록",
  "S-3ASR": "증권 발행 자동 등록",
  "S-8": "임직원 주식보상 등록",
  "FWP": "증권 발행 홍보 자료",
  "ARS": "연례 주주 보고서",
  "SD": "분쟁광물 보고서",
  "11-K": "직원 저축플랜 보고서",
  "3": "내부자 최초 보유 신고",
  "4": "내부자 거래 신고",
  "5": "내부자 연간 거래 신고",
  "144": "내부자 매도 예정 신고",
  "SC 13G": "대주주(5%) 지분 보고",
  "SC 13G/A": "대주주(5%) 지분 보고 정정",
  "SC 13D": "대주주(5%) 경영참여 목적 보고",
  "SC 13D/A": "대주주 경영참여 보고 정정",
  "SCHEDULE 13G": "대주주(5%) 지분 보고",
  "SCHEDULE 13G/A": "대주주(5%) 지분 보고 정정",
  "SCHEDULE 13D": "대주주(5%) 경영참여 목적 보고",
  "SCHEDULE 13D/A": "대주주 경영참여 보고 정정",
};

const SEC_8K_ITEMS = {
  "1.01": "중요 계약 체결",
  "1.02": "중요 계약 종료",
  "1.05": "사이버보안 사고",
  "2.01": "자산 인수·처분 완료",
  "2.02": "실적 발표",
  "2.03": "채무 발생",
  "2.05": "구조조정 비용",
  "2.06": "자산 손상",
  "3.01": "상장 유지 기준 관련",
  "3.02": "비등록 증권 매각",
  "3.03": "주주 권리 변경",
  "4.01": "회계법인 변경",
  "4.02": "과거 재무제표 신뢰 불가",
  "5.01": "경영권 변동",
  "5.02": "임원·이사 변동",
  "5.03": "정관·회계연도 변경",
  "5.07": "주주총회 결과",
  "7.01": "공정공시(Reg FD)",
  "8.01": "기타 주요 사건",
  "9.01": "재무제표·첨부 서류",
};

// 공시 분류: 화면의 "보기" 선택과 맞춘다.
const SEC_MAJOR = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "6-K", "40-F", "DEF 14A", "S-1", "S-3", "S-3ASR"]);
const SEC_INSIDER = new Set(["3", "4", "5", "144", "4/A", "144/A"]);
const SEC_OWNERSHIP = /^(SC|SCHEDULE) 13[DG]/;

const isEarnings8k = (f) => f.form.startsWith("8-K") && f.items.includes("2.02");

function secCategory(f) {
  if (isEarnings8k(f)) return "earnings";
  if (SEC_INSIDER.has(f.form)) return "insider";
  if (SEC_OWNERSHIP.test(f.form)) return "ownership";
  if (SEC_MAJOR.has(f.form)) return "major";
  return "other";
}

const padCik = (cik) => String(cik).replace(/\D/g, "").padStart(10, "0");

function cachedCik(ticker) {
  try { return localStorage.getItem(SEC_CIK_PREFIX + ticker) || ""; } catch { return ""; }
}

function rememberCik(ticker, cik) {
  try { localStorage.setItem(SEC_CIK_PREFIX + ticker, padCik(cik)); } catch { /* 저장소 사용 불가 */ }
}

// 티커 → CIK(SEC 회사 번호). 저장된 값 → FMP 회사 정보 → Finnhub 공시 목록 순서로 찾는다.
async function resolveCik(ticker) {
  const saved = cachedCik(ticker);
  if (saved) return saved;
  const fmpKey = ApiKeyStore.get("fmp");
  if (fmpKey) {
    try {
      const p = firstItem(await fmpGet("profile", { symbol: ticker }, fmpKey));
      if (p && p.cik) { rememberCik(ticker, p.cik); return padCik(p.cik); }
    } catch { /* 다음 방법으로 */ }
  }
  const fhKey = ApiKeyStore.get("finnhub");
  if (fhKey) {
    try {
      const rows = await finnhubGet("stock/filings", { symbol: ticker }, fhKey, { cache: true });
      const withCik = Array.isArray(rows) ? rows.find((r) => r && r.cik) : null;
      if (withCik) { rememberCik(ticker, withCik.cik); return padCik(withCik.cik); }
    } catch { /* 찾지 못함 */ }
  }
  return "";
}

// 반환: { name, cik, filings: [{ form, date, reportDate, items[], url, indexUrl, category }] } (최신순)
async function fetchSecFilings(cik) {
  const key = padCik(cik);
  const hit = secCache.get(key);
  if (hit && Date.now() - hit.time < SEC_CACHE_MS) return hit.data;

  let res;
  try {
    res = await fetch(`${SEC_SUBMISSIONS}CIK${key}.json`);
  } catch {
    throw new Error("SEC 서버에 연결하지 못했습니다. 인터넷 연결을 확인하거나 광고 차단 확장 프로그램을 잠시 꺼 보세요.");
  }
  if (res.status === 404) throw new Error(`SEC에서 CIK ${key} 회사를 찾지 못했습니다. CIK 번호를 확인해 주세요.`);
  if (res.status === 429 || res.status === 403) throw new Error("SEC 서버가 잠시 요청을 막았습니다. 1분쯤 뒤에 다시 시도해 주세요.");
  if (!res.ok) throw new Error("SEC 공시 목록을 가져오는 중 오류가 발생했습니다.");
  const body = await res.json();
  const r = (body.filings && body.filings.recent) || {};
  const cikNum = String(Number(key));
  const filings = (r.form || []).map((form, i) => {
    const acc = r.accessionNumber[i];
    const accPath = acc.replace(/-/g, "");
    const f = {
      form,
      date: r.filingDate[i],
      reportDate: r.reportDate ? r.reportDate[i] : "",
      items: r.items && r.items[i] ? r.items[i].split(",").map((s) => s.trim()).filter(Boolean) : [],
      url: r.primaryDocument && r.primaryDocument[i] ? `${SEC_ARCHIVES}${cikNum}/${accPath}/${r.primaryDocument[i]}` : "",
      indexUrl: `${SEC_ARCHIVES}${cikNum}/${accPath}/${acc}-index.htm`,
    };
    f.category = secCategory(f);
    return f;
  });
  const data = { name: body.name || "", cik: key, filings };
  secCache.set(key, { time: Date.now(), data });
  return data;
}
