// Finnhub API 연동: quote(현재가)와 stock/metric(EPS·BPS·주당 FCF)
const FINNHUB_BASE = "https://finnhub.io/api/v1/";

function finnhubClassify(res, msg) {
  if (res.status === 429 || /limit/i.test(msg)) return "limit";
  if (res.status === 401 || /invalid api key/i.test(msg)) return "key";
  if (res.status === 403 || /access/i.test(msg)) return "premium";
  return null;
}

function finnhubGet(path, params, apiKey) {
  const url = new URL(path, FINNHUB_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 헤더 대신 쿼리로 보내야 CORS 사전 요청 없이 브라우저에서 바로 호출된다.
  url.searchParams.set("token", apiKey);
  return apiGet("finnhub", url, finnhubClassify);
}

// 반환: { 필드: { value, detail } }
async function fetchFinnhub(ticker, apiKey) {
  const [quote, metricRes] = await Promise.all([
    finnhubGet("quote", { symbol: ticker }, apiKey),
    finnhubGet("stock/metric", { symbol: ticker, metric: "all" }, apiKey),
  ]);

  // 없는 티커면 Finnhub는 오류 대신 0으로 채운 시세를 돌려준다.
  const price = pickNumber(quote, ["c"]);
  if (!(price > 0)) throw new ApiError("finnhub", "notfound", apiMessage("finnhub", "notfound"));

  const m = metricRes && metricRes.metric ? metricRes.metric : {};
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
