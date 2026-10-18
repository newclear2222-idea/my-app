// Financial Modeling Prep(FMP) API 연동
// API 키는 코드에 넣지 않고 사용자가 입력한 값을 브라우저 localStorage에만 저장한다.
const FMP_BASE = "https://financialmodelingprep.com/stable/";
const API_KEY_STORAGE = "fmpApiKey";
const GROWTH_MAX_YEARS = 5;
const PE_SNAPSHOT_LOOKBACK_DAYS = 7;

const ApiKeyStore = {
  get() {
    try { return localStorage.getItem(API_KEY_STORAGE) || ""; } catch { return ""; }
  },
  set(key) {
    try { localStorage.setItem(API_KEY_STORAGE, key); return true; } catch { return false; }
  },
  clear() {
    try { localStorage.removeItem(API_KEY_STORAGE); } catch { /* 저장소 사용 불가 */ }
  },
};

class FmpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const FMP_MESSAGES = {
  key: "API 키가 올바르지 않습니다. 'API 키 설정'에서 키를 다시 확인해 주세요.",
  limit: "무료 플랜의 API 호출 한도를 넘었습니다. 잠시 후(또는 내일) 다시 시도하거나 값을 직접 입력해 주세요.",
  premium: "이 데이터는 FMP 무료 플랜에서 제공되지 않습니다.",
  network: "서버에 연결하지 못했습니다. 인터넷 연결을 확인하거나 광고 차단 확장 프로그램을 잠시 꺼 보세요.",
  unknown: "데이터를 가져오는 중 알 수 없는 오류가 발생했습니다.",
};

async function fmpGet(path, params, apiKey) {
  const url = new URL(path, FMP_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", apiKey);

  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new FmpError("network", FMP_MESSAGES.network);
  }

  let body = null;
  try { body = await res.json(); } catch { /* JSON이 아닌 응답 */ }
  const msg = body && !Array.isArray(body)
    ? String(body["Error Message"] || body.error || body.message || "")
    : "";

  if (res.status === 429 || /limit reach/i.test(msg)) throw new FmpError("limit", FMP_MESSAGES.limit);
  if (res.status === 401 || /invalid api key/i.test(msg)) throw new FmpError("key", FMP_MESSAGES.key);
  if (res.status === 402 || res.status === 403 || /premium|subscription|upgrade|plan/i.test(msg)) {
    throw new FmpError("premium", FMP_MESSAGES.premium);
  }
  if (!res.ok || msg || body === null) throw new FmpError("unknown", FMP_MESSAGES.unknown);
  return body;
}

const firstItem = (data) => (Array.isArray(data) ? data[0] : data) || null;

function pickNumber(obj, names) {
  if (!obj) return null;
  for (const name of names) {
    const v = obj[name];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

// 애널리스트 연간 EPS 추정치로 최대 5년 연평균 성장률(CAGR, %)을 구한다.
function growthFromEstimates(estimates, ttmEps) {
  if (!Array.isArray(estimates) || !(ttmEps > 0)) return null;
  const now = Date.now();
  const yearMs = 365.25 * 24 * 3600 * 1000;
  const future = estimates
    .map((e) => ({ years: (new Date(e.date).getTime() - now) / yearMs, eps: e.epsAvg }))
    .filter((e) => Number.isFinite(e.years) && e.years >= 0.5 && e.years <= GROWTH_MAX_YEARS + 0.5)
    .filter((e) => typeof e.eps === "number" && e.eps > 0)
    .sort((a, b) => a.years - b.years);
  if (future.length === 0) return null;
  const target = future[future.length - 1];
  const cagr = (Math.pow(target.eps / ttmEps, 1 / target.years) - 1) * 100;
  return { growth: Math.round(cagr * 10) / 10, years: target.years };
}

function recentWeekdays(count) {
  const dates = [];
  const d = new Date();
  while (dates.length < count) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${dd}`);
    }
  }
  return dates;
}

function matchPe(rows, field, name, exchange) {
  if (!Array.isArray(rows) || !name) return null;
  const same = rows.filter((r) => r[field] === name && typeof r.pe === "number" && r.pe > 0);
  if (same.length === 0) return null;
  const onExchange = same.find((r) => r.exchange === exchange);
  if (onExchange) return onExchange.pe;
  return same.reduce((a, r) => a + r.pe, 0) / same.length;
}

// 업종(industry) PER을 먼저 찾고, 없으면 섹터(sector) PER을 쓴다. 최근 거래일부터 거꾸로 찾는다.
async function fetchPeerPe(profile, apiKey) {
  const exchange = profile.exchange || profile.exchangeShortName || "";
  const params = exchange ? { exchange } : {};
  for (const date of recentWeekdays(PE_SNAPSHOT_LOOKBACK_DAYS)) {
    const sectorRows = await fmpGet("sector-pe-snapshot", { date, ...params }, apiKey);
    if (!Array.isArray(sectorRows) || sectorRows.length === 0) continue;

    let industryRows = null;
    try {
      industryRows = await fmpGet("industry-pe-snapshot", { date, ...params }, apiKey);
    } catch (e) {
      if (e.code === "limit") throw e;
    }
    const industryPe = matchPe(industryRows, "industry", profile.industry, exchange);
    if (industryPe) return { pe: industryPe, label: `업종(${profile.industry}) 평균 PER, ${date} 기준` };

    const sectorPe = matchPe(sectorRows, "sector", profile.sector, exchange);
    if (sectorPe) return { pe: sectorPe, label: `섹터(${profile.sector}) 평균 PER, ${date} 기준` };
    return null;
  }
  return null;
}

// 티커 하나에 필요한 값을 모두 가져온다. 일부만 실패하면 가져온 값과 경고를 함께 돌려준다.
async function fetchFundamentals(ticker, apiKey) {
  const symbol = { symbol: ticker };
  const [quoteRes, ratiosRes, profileRes, estimatesRes] = await Promise.allSettled([
    fmpGet("quote", symbol, apiKey),
    fmpGet("ratios-ttm", symbol, apiKey),
    fmpGet("profile", symbol, apiKey),
    fmpGet("analyst-estimates", { ...symbol, period: "annual" }, apiKey),
  ]);

  // 키 오류나 한도 초과는 어느 요청에서 나든 전체 실패로 본다.
  for (const r of [quoteRes, ratiosRes, profileRes, estimatesRes]) {
    if (r.status === "rejected" && (r.reason.code === "key" || r.reason.code === "limit")) throw r.reason;
  }
  if (quoteRes.status === "rejected") throw quoteRes.reason;

  const quote = firstItem(quoteRes.value);
  const price = pickNumber(quote, ["price"]);
  if (price === null) {
    throw new FmpError("notfound", `'${ticker}' 티커를 찾을 수 없습니다. 미국 주식 티커가 맞는지 확인해 주세요. (예: AAPL, MSFT)`);
  }

  const values = { price };
  const warnings = [];
  const sources = { price: "현재 주가 (quote)" };

  const ratios = ratiosRes.status === "fulfilled" ? firstItem(ratiosRes.value) : null;
  if (ratiosRes.status === "rejected") warnings.push(`재무 비율(EPS·BPS·FCF): ${ratiosRes.reason.message}`);

  let eps = pickNumber(ratios, ["netIncomePerShareTTM"]) ?? pickNumber(quote, ["eps"]);
  if (eps === null) {
    const pe = pickNumber(ratios, ["priceToEarningsRatioTTM", "peRatioTTM"]) ?? pickNumber(quote, ["pe"]);
    if (pe) eps = price / pe;
  }
  const bps = pickNumber(ratios, ["bookValuePerShareTTM", "shareholdersEquityPerShareTTM"]);
  const fcf = pickNumber(ratios, ["freeCashFlowPerShareTTM"]);
  if (eps !== null) { values.eps = eps; sources.eps = "최근 12개월(TTM) 주당순이익"; }
  if (bps !== null) { values.bps = bps; sources.bps = "최근 12개월(TTM) 주당순자산"; }
  if (fcf !== null) { values.fcf = fcf; sources.fcf = "최근 12개월(TTM) 주당 잉여현금흐름"; }

  if (estimatesRes.status === "fulfilled") {
    const g = growthFromEstimates(estimatesRes.value, eps);
    if (g) {
      values.growth = g.growth;
      sources.growth = `애널리스트 EPS 추정치 기준 약 ${g.years.toFixed(1)}년 연평균 성장률`;
    } else {
      warnings.push("성장률: 쓸 수 있는 애널리스트 추정치가 없습니다.");
    }
  } else {
    warnings.push(`성장률(애널리스트 추정치): ${estimatesRes.reason.message}`);
  }

  if (profileRes.status === "fulfilled" && firstItem(profileRes.value)) {
    try {
      const peer = await fetchPeerPe(firstItem(profileRes.value), apiKey);
      if (peer) {
        values.sectorPer = Math.round(peer.pe * 10) / 10;
        sources.sectorPer = peer.label;
      } else {
        warnings.push("업종 평균 PER: 비교할 업종 데이터를 찾지 못했습니다.");
      }
    } catch (e) {
      if (e.code === "key") throw e;
      warnings.push(`업종 평균 PER: ${e.message}`);
    }
  } else {
    warnings.push(`업종 평균 PER: ${profileRes.reason?.message || "회사 정보를 가져오지 못했습니다."}`);
  }

  return { values, sources, warnings };
}
