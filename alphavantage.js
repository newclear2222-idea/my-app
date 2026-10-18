// Alpha Vantage API 연동
// - OVERVIEW: 애널리스트 컨센서스 목표주가
// - EARNINGS_ESTIMATES: 애널리스트 EPS 컨센서스(내년 예상 EPS). FMP에서 못 받은 경우에만 부른다.
// 무료 플랜은 하루 25회라 같은 종목·같은 요청은 1시간 동안 다시 부르지 않는다.
const ALPHAVANTAGE_BASE = "https://www.alphavantage.co/query";
const ALPHAVANTAGE_CACHE_MS = 60 * 60 * 1000;
const alphaVantageCache = new Map();

// Alpha Vantage는 오류도 HTTP 200으로 주고 Information/Note/Error Message에 설명을 담는다.
function alphaVantageClassify(res, msg) {
  if (res.status === 429 || /rate limit|requests per (day|minute)|spreading out/i.test(msg)) return "limit";
  if (/premium/i.test(msg)) return "premium";
  if (/api ?key is invalid|invalid api ?key|apikey.*(invalid|missing)|claim your free api key/i.test(msg)) return "key";
  if (/invalid api call/i.test(msg)) return "notfound";
  return null;
}

async function alphaVantageQuery(fn, ticker, apiKey) {
  const cacheKey = `${fn}:${ticker}`;
  const hit = alphaVantageCache.get(cacheKey);
  if (hit && Date.now() - hit.time < ALPHAVANTAGE_CACHE_MS) return hit.body;

  const url = new URL(ALPHAVANTAGE_BASE);
  url.searchParams.set("function", fn);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("apikey", apiKey);
  const body = await apiGet("alphavantage", url, alphaVantageClassify);
  alphaVantageCache.set(cacheKey, { time: Date.now(), body });
  return body;
}

// Alpha Vantage는 숫자를 문자열로 주고, 값이 없으면 "None"이나 "-"를 준다.
const avNumber = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

// 반환: 회계연도 추정치 [{ date, eps, analysts }]
async function fetchAlphaVantageEstimates(ticker, apiKey) {
  const body = await alphaVantageQuery("EARNINGS_ESTIMATES", ticker, apiKey);
  return (Array.isArray(body.estimates) ? body.estimates : [])
    .filter((e) => /fiscal year/i.test(e.horizon || ""))
    .map((e) => ({
      date: e.date,
      eps: avNumber(e.eps_estimate_average),
      analysts: avNumber(e.eps_estimate_analyst_count),
    }));
}

// 예전 버전이 저장해 둔 일봉 캐시(avDaily:종목)는 더 쓰지 않으므로 지워서 저장 공간을 비운다.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("avDaily:")) localStorage.removeItem(k);
  }
} catch { /* 저장소 사용 불가 */ }

// OVERVIEW의 AnalystTargetPrice. 애널리스트 수는 투자의견(강력매수~강력매도) 수의 합으로 본다.
// 반환: { value, analysts } 또는 null
async function fetchAlphaVantageTarget(ticker, apiKey) {
  const o = await alphaVantageQuery("OVERVIEW", ticker, apiKey);
  const value = avNumber(o.AnalystTargetPrice);
  if (!(value > 0)) return null;
  const counts = ["AnalystRatingStrongBuy", "AnalystRatingBuy", "AnalystRatingHold", "AnalystRatingSell", "AnalystRatingStrongSell"]
    .map((k) => avNumber(o[k]))
    .filter(Number.isFinite);
  return { value, analysts: counts.length ? counts.reduce((a, b) => a + b, 0) : null };
}
