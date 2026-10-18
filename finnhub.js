// Finnhub API 연동: quote(현재가), stock/metric(EPS·BPS·주당 FCF·PER), stock/peers(경쟁사)
const FINNHUB_BASE = "https://finnhub.io/api/v1/";

// 무료 플랜은 분당 60회. 여유를 두고 55회로 막고, 동시에 보내는 요청 수도 제한한다.
const FINNHUB_MAX_PER_MINUTE = 55;
const FINNHUB_WINDOW_MS = 60 * 1000;
const FINNHUB_CONCURRENCY = 4;
const FINNHUB_CALL_LOG_KEY = "finnhubCallLog";
// 같은 종목 재무 데이터는 10분 동안 다시 부르지 않는다(호출 수 절약).
const FINNHUB_CACHE_MS = 10 * 60 * 1000;

const PEER_MAX = 10;
const PEER_MIN_VALID = 3;
const PEER_MAX_MULTIPLE = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 새로고침해도 최근 1분 호출 기록이 유지되도록 localStorage에 남긴다.
function readCallLog() {
  try {
    const log = JSON.parse(localStorage.getItem(FINNHUB_CALL_LOG_KEY) || "[]");
    return Array.isArray(log) ? log : [];
  } catch { return []; }
}

function writeCallLog(log) {
  try { localStorage.setItem(FINNHUB_CALL_LOG_KEY, JSON.stringify(log)); } catch { /* 저장소 사용 불가 */ }
}

// 호출 한 번 할 자리를 확보한다. 1분에 55회를 다 썼으면 자리가 날 때까지 기다린다.
async function finnhubSlot(onWait) {
  for (;;) {
    const now = Date.now();
    const log = readCallLog().filter((t) => now - t < FINNHUB_WINDOW_MS);
    if (log.length < FINNHUB_MAX_PER_MINUTE) {
      log.push(now);
      writeCallLog(log);
      return;
    }
    const waitMs = FINNHUB_WINDOW_MS - (now - Math.min(...log)) + 100;
    if (onWait) onWait(Math.ceil(waitMs / 1000));
    await sleep(Math.min(waitMs, 1000));
  }
}

const finnhubCache = new Map();

function finnhubClassify(res, msg) {
  if (res.status === 429 || /limit/i.test(msg)) return "limit";
  if (res.status === 401 || /invalid api key/i.test(msg)) return "key";
  if (res.status === 403 || /access/i.test(msg)) return "premium";
  return null;
}

async function finnhubGet(path, params, apiKey, { cache = false, onWait } = {}) {
  const url = new URL(path, FINNHUB_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cacheKey = url.toString();
  const hit = cache && finnhubCache.get(cacheKey);
  if (hit && Date.now() - hit.time < FINNHUB_CACHE_MS) return hit.data;

  await finnhubSlot(onWait);
  // 헤더 대신 쿼리로 보내야 CORS 사전 요청 없이 브라우저에서 바로 호출된다.
  url.searchParams.set("token", apiKey);
  const data = await apiGet("finnhub", url, finnhubClassify);
  if (cache) finnhubCache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function finnhubMetric(symbol, apiKey, onWait) {
  return finnhubGet("stock/metric", { symbol, metric: "all" }, apiKey, { cache: true, onWait })
    .then((res) => (res && res.metric) || {});
}

// 반환: { 필드: { value, detail } }
async function fetchFinnhub(ticker, apiKey, onWait) {
  const [quote, m] = await Promise.all([
    finnhubGet("quote", { symbol: ticker }, apiKey, { onWait }),
    finnhubMetric(ticker, apiKey, onWait),
  ]);

  // 없는 티커면 Finnhub는 오류 대신 0으로 채운 시세를 돌려준다.
  const price = pickNumber(quote, ["c"]);
  if (!(price > 0)) throw new ApiError("finnhub", "notfound", apiMessage("finnhub", "notfound"));

  const eps = pickNumber(m, ["epsTTM", "epsInclExtraItemsTTM", "epsExclExtraItemsTTM", "epsBasicExclExtraItemsTTM"]);
  const bps = pickNumber(m, ["bookValuePerShareQuarterly", "bookValuePerShareAnnual"]);
  let fcf = pickNumber(m, ["freeCashFlowPerShareTTM"]);
  let fcfDetail = "최근 12개월(TTM) 주당 잉여현금흐름";
  if (fcf === null) {
    const pfcf = pickNumber(m, ["pfcfShareTTM", "pfcfShareAnnual"]);
    if (pfcf) {
      fcf = price / pfcf;
      fcfDetail = "주가 ÷ P/FCF로 역산한 주당 잉여현금흐름";
    }
  }

  return {
    price: { value: price, detail: "현재 주가 (quote)" },
    eps: { value: eps, detail: "최근 12개월(TTM) 주당순이익" },
    bps: { value: bps, detail: "최근 분기 주당순자산" },
    fcf: { value: fcf, detail: fcfDetail },
  };
}

// 애널리스트 컨센서스 목표주가. 반환: { value, analysts, updated } 또는 null
async function fetchFinnhubTarget(ticker, apiKey, onWait) {
  const t = await finnhubGet("stock/price-target", { symbol: ticker }, apiKey, { cache: true, onWait });
  const value = pickNumber(t, ["targetMean", "targetMedian"]);
  if (!(value > 0)) return null;
  return {
    value,
    analysts: pickNumber(t, ["numberAnalysts", "numberOfAnalysts"]),
    updated: t && typeof t.lastUpdated === "string" ? t.lastUpdated.slice(0, 10) : null,
  };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 배수 목록에서 적자(0 이하)와 극단값(200배 이상)을 빼고 중간값을 구한다.
function peerMultiple(rows, name) {
  const valid = rows.filter((r) => r[name] !== null && r[name] > 0 && r[name] < PEER_MAX_MULTIPLE);
  if (valid.length < PEER_MIN_VALID) {
    return { value: null, used: valid, excluded: rows.length - valid.length };
  }
  return {
    value: Math.round(median(valid.map((r) => r[name])) * 10) / 10,
    used: valid,
    excluded: rows.length - valid.length,
  };
}

function describePeers(result, unit) {
  const names = result.used.map((r) => r.symbol);
  const shown = names.slice(0, 5).join(", ") + (names.length > 5 ? ` 외 ${names.length - 5}곳` : "");
  const excluded = result.excluded ? `, 적자·${PEER_MAX_MULTIPLE}배 이상 ${result.excluded}곳 제외` : "";
  return `경쟁사 기준: ${shown} (중간값 ${result.value}${unit}${excluded})`;
}

// 경쟁사 PER(TTM)의 중간값. onProgress(완료 수, 전체 수)로 진행 상황을 알린다.
async function fetchPeerMultiples(ticker, apiKey, { onWait, onProgress } = {}) {
  const peers = await finnhubGet("stock/peers", { symbol: ticker }, apiKey, { cache: true, onWait });
  const symbols = (Array.isArray(peers) ? peers : [])
    .filter((s) => typeof s === "string" && s !== ticker && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))
    .slice(0, PEER_MAX);
  if (symbols.length === 0) return { pe: null, reason: "Finnhub에서 경쟁사 목록을 찾지 못했습니다." };

  const rows = [];
  let done = 0;
  let next = 0;
  let limitHit = false;
  const worker = async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      try {
        const m = await finnhubMetric(symbol, apiKey, onWait);
        rows.push({
          symbol,
          pe: pickNumber(m, ["peTTM", "peBasicExclExtraTTM", "peExclExtraTTM", "peInclExtraTTM"]),
        });
      } catch (e) {
        if (e.code === "key") throw e;
        if (e.code === "limit") limitHit = true;
        // 한 회사 실패는 건너뛴다.
      }
      done++;
      if (onProgress) onProgress(done, symbols.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FINNHUB_CONCURRENCY, symbols.length) }, worker));

  // 결과 표시 순서를 Finnhub가 준 경쟁사 순서와 맞춘다.
  rows.sort((a, b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));
  const pe = peerMultiple(rows, "pe");
  if (pe.value !== null) return { pe: { value: pe.value, note: describePeers(pe, "배") } };
  return {
    pe: null,
    reason: limitHit
      ? apiMessage("finnhub", "limit")
      : `흑자이면서 ${PEER_MAX_MULTIPLE}배 미만인 경쟁사가 ${PEER_MIN_VALID}곳 미만입니다.`,
  };
}
