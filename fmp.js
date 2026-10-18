// Financial Modeling Prep(FMP) API 연동
const FMP_BASE = "https://financialmodelingprep.com/stable/";
const GROWTH_MAX_YEARS = 5;

function fmpClassify(res, msg) {
  if (res.status === 429 || /limit reach/i.test(msg)) return "limit";
  if (res.status === 401 || /invalid api key/i.test(msg)) return "key";
  if (res.status === 402 || res.status === 403 || /premium|subscription|upgrade|plan/i.test(msg)) return "premium";
  return null;
}

function fmpGet(path, params, apiKey) {
  const url = new URL(path, FMP_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", apiKey);
  return apiGet("fmp", url, fmpClassify);
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

// 반환: { fields: { 필드: { value, detail } }, estimates, warnings }
// 키 오류·한도 초과·시세 조회 실패는 ApiError로 던진다(그러면 Finnhub로 넘어간다).
// 업종 PER은 FMP 섹터 평균 대신 Finnhub 경쟁사 중간값을 쓴다(finnhub.js).
async function fetchFmp(ticker, apiKey) {
  const symbol = { symbol: ticker };
  const [quoteRes, ratiosRes, estimatesRes] = await Promise.allSettled([
    fmpGet("quote", symbol, apiKey),
    fmpGet("ratios-ttm", symbol, apiKey),
    fmpGet("analyst-estimates", { ...symbol, period: "annual" }, apiKey),
  ]);

  for (const r of [quoteRes, ratiosRes, estimatesRes]) {
    if (r.status === "rejected" && (r.reason.code === "key" || r.reason.code === "limit")) throw r.reason;
  }
  if (quoteRes.status === "rejected") throw quoteRes.reason;

  const quote = firstItem(quoteRes.value);
  const price = pickNumber(quote, ["price"]);
  if (price === null) throw new ApiError("fmp", "notfound", apiMessage("fmp", "notfound"));

  const warnings = [];
  const ratios = ratiosRes.status === "fulfilled" ? firstItem(ratiosRes.value) : null;

  let eps = pickNumber(ratios, ["netIncomePerShareTTM"]) ?? pickNumber(quote, ["eps"]);
  if (eps === null) {
    const pe = pickNumber(ratios, ["priceToEarningsRatioTTM", "peRatioTTM"]) ?? pickNumber(quote, ["pe"]);
    if (pe) eps = price / pe;
  }

  const fields = {
    price: { value: price, detail: "현재 주가 (quote)" },
    eps: { value: eps, detail: "최근 12개월(TTM) 주당순이익" },
    bps: { value: pickNumber(ratios, ["bookValuePerShareTTM", "shareholdersEquityPerShareTTM"]), detail: "최근 12개월(TTM) 주당순자산" },
    fcf: { value: pickNumber(ratios, ["freeCashFlowPerShareTTM"]), detail: "최근 12개월(TTM) 주당 잉여현금흐름" },
  };

  let estimates = null;
  if (estimatesRes.status === "fulfilled") {
    estimates = estimatesRes.value;
  } else {
    warnings.push(`성장률(FMP 애널리스트 추정치): ${estimatesRes.reason.message}`);
  }

  return { fields, estimates, warnings };
}
