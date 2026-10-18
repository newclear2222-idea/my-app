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

// ----- 일별 주가 (이동평균선·볼린저밴드 차트용) -----
// 하루 25회 한도를 아끼려고 종목별로 하루 한 번만 받아 브라우저에 저장한다(최근 DAILY_KEEP 거래일만).
const DAILY_CACHE_PREFIX = "avDaily:";
const DAILY_KEEP = 800;
// 무료 일봉은 액면분할이 반영되지 않은 가격이라, 하룻밤 사이 정수배(2·3·4·5·10배 등)로 뛴 날을 분할로 보고 이전 가격을 맞춘다.
const SPLIT_RATIOS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50];
const SPLIT_TOLERANCE = 0.04;

function splitFactor(prevClose, open) {
  if (!(prevClose > 0 && open > 0)) return 1;
  const r = prevClose / open;
  for (const n of SPLIT_RATIOS) {
    if (Math.abs(r - n) / n < SPLIT_TOLERANCE) return n; // 분할: 이전 가격 ÷ n
    if (Math.abs(1 / r - n) / n < SPLIT_TOLERANCE) return 1 / n; // 병합(역분할): 이전 가격 × n
  }
  return 1;
}

// 오래된 날부터 [{ date, open, high, low, close, volume }]. splits = 찾아서 맞춘 분할 목록
function adjustSplits(rows) {
  const out = rows.map((r) => ({ ...r }));
  const splits = [];
  for (let i = out.length - 1; i > 0; i--) {
    const f = splitFactor(out[i - 1].close, out[i].open);
    if (f === 1) continue;
    splits.push({ date: out[i].date, factor: f });
    for (let j = 0; j < i; j++) {
      out[j].open /= f; out[j].high /= f; out[j].low /= f; out[j].close /= f; out[j].volume *= f;
    }
  }
  return { rows: out, splits };
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 반환: { rows, splits, full } — full이 false면 최근 100거래일만 받은 것(200일선 등 긴 선은 못 그림)
async function fetchDailySeries(ticker, apiKey) {
  const cacheKey = DAILY_CACHE_PREFIX + ticker;
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (hit && hit.day === todayKey()) return hit.data;
  } catch { /* 저장소 사용 불가 */ }

  const query = async (outputsize) => {
    const url = new URL(ALPHAVANTAGE_BASE);
    url.searchParams.set("function", "TIME_SERIES_DAILY");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("outputsize", outputsize);
    url.searchParams.set("apikey", apiKey);
    return apiGet("alphavantage", url, alphaVantageClassify);
  };
  let full = true;
  let body;
  try {
    body = await query("full");
  } catch (e) {
    if (e.code !== "premium") throw e;
    full = false;
    body = await query("compact");
  }
  const series = body["Time Series (Daily)"];
  if (!series || typeof series !== "object") throw new ApiError("alphavantage", "notfound", apiMessage("alphavantage", "notfound"));

  const raw = Object.entries(series)
    .map(([date, v]) => ({
      date,
      open: avNumber(v["1. open"]),
      high: avNumber(v["2. high"]),
      low: avNumber(v["3. low"]),
      close: avNumber(v["4. close"]),
      volume: avNumber(v["5. volume"]),
    }))
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAILY_KEEP);
  const { rows, splits } = adjustSplits(raw);
  const data = { rows, splits, full };
  try {
    // 다른 종목의 지난 캐시는 지워서 저장 공간을 아낀다.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DAILY_CACHE_PREFIX) && k !== cacheKey) {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        if (!v || v.day !== todayKey()) localStorage.removeItem(k);
      }
    }
    localStorage.setItem(cacheKey, JSON.stringify({ day: todayKey(), data }));
  } catch { /* 저장 공간 부족 등: 이번에만 쓰고 저장하지 않는다 */ }
  return data;
}

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
