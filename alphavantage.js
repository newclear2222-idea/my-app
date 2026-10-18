// Alpha Vantage API 연동: EARNINGS_ESTIMATES(애널리스트 EPS 컨센서스)로 내년 예상 EPS를 가져온다.
// 무료 플랜은 하루 25회라 FMP에서 추정치를 못 받은 경우에만 부르고, 같은 종목은 1시간 동안 다시 부르지 않는다.
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

// 반환: 회계연도 추정치 [{ date, eps, analysts }]
async function fetchAlphaVantageEstimates(ticker, apiKey) {
  const hit = alphaVantageCache.get(ticker);
  if (hit && Date.now() - hit.time < ALPHAVANTAGE_CACHE_MS) return hit.rows;

  const url = new URL(ALPHAVANTAGE_BASE);
  url.searchParams.set("function", "EARNINGS_ESTIMATES");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("apikey", apiKey);
  const body = await apiGet("alphavantage", url, alphaVantageClassify);

  const rows = (Array.isArray(body.estimates) ? body.estimates : [])
    .filter((e) => /fiscal year/i.test(e.horizon || ""))
    .map((e) => ({
      date: e.date,
      eps: e.eps_estimate_average === null ? NaN : Number(e.eps_estimate_average),
      analysts: Number(e.eps_estimate_analyst_count),
    }));
  alphaVantageCache.set(ticker, { time: Date.now(), rows });
  return rows;
}
