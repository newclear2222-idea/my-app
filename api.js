// API 공통 도구와 불러오기 순서(FMP 먼저 → 비어 있는 항목은 Finnhub)
// API 키는 코드에 넣지 않고 사용자가 입력한 값을 브라우저 localStorage에만 저장한다.

const API_PROVIDERS = {
  fmp: { label: "FMP", storageKey: "fmpApiKey" },
  finnhub: { label: "Finnhub", storageKey: "finnhubApiKey" },
  alphavantage: { label: "Alpha Vantage", storageKey: "alphaVantageApiKey" },
};

const ApiKeyStore = {
  get(provider) {
    try { return localStorage.getItem(API_PROVIDERS[provider].storageKey) || ""; } catch { return ""; }
  },
  set(provider, key) {
    try { localStorage.setItem(API_PROVIDERS[provider].storageKey, key); return true; } catch { return false; }
  },
  clear(provider) {
    try { localStorage.removeItem(API_PROVIDERS[provider].storageKey); } catch { /* 저장소 사용 불가 */ }
  },
};

class ApiError extends Error {
  constructor(provider, code, message) {
    super(message);
    this.provider = provider;
    this.code = code;
  }
}

function apiMessage(provider, code) {
  const name = API_PROVIDERS[provider].label;
  const messages = {
    key: `${name} API 키가 올바르지 않습니다. 'API 키 설정'에서 키를 다시 확인해 주세요.`,
    limit: {
      finnhub: "Finnhub 무료 플랜의 호출 한도(분당 60회)를 넘었습니다. 1분쯤 뒤에 다시 시도해 주세요.",
      alphavantage: "Alpha Vantage 무료 플랜의 호출 한도(하루 25회)를 넘었습니다. 내일 다시 시도해 주세요.",
    }[provider] || "FMP 무료 플랜의 API 호출 한도를 넘었습니다. 잠시 후(또는 내일) 다시 시도하거나 값을 직접 입력해 주세요.",
    premium: `이 데이터(또는 종목)는 ${name} 무료 플랜에서 제공되지 않습니다.`,
    network: `${name} 서버에 연결하지 못했습니다. 인터넷 연결을 확인하거나 광고 차단 확장 프로그램을 잠시 꺼 보세요.`,
    notfound: `${name}에서 이 티커를 찾을 수 없습니다.`,
    unknown: `${name}에서 데이터를 가져오는 중 알 수 없는 오류가 발생했습니다.`,
  };
  return messages[code] || messages.unknown;
}

// 공통 GET 요청. 공급자별 오류 판별은 classify(res, body, msg)가 맡는다.
async function apiGet(provider, url, classify) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError(provider, "network", apiMessage(provider, "network"));
  }
  let body = null;
  try { body = await res.json(); } catch { /* JSON이 아닌 응답 */ }
  const msg = body && !Array.isArray(body)
    ? String(body["Error Message"] || body.error || body.message || body.Information || body.Note || "")
    : "";
  const code = classify(res, msg) || ((!res.ok || msg || body === null) ? "unknown" : null);
  if (code) throw new ApiError(provider, code, apiMessage(provider, code));
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

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// 선행 PER용 "내년 예상 EPS": 회계연도 추정치 중 결산일이 지금부터 12개월 뒤에 가장 가까운 것.
// (예: 10월 기준 12월 결산 회사는 두 달 남은 올해가 아니라 내년 회계연도를 고른다.)
// rows: [{ date, eps, analysts? }]
function pickForwardEstimate(rows) {
  if (!Array.isArray(rows)) return null;
  const target = Date.now() + YEAR_MS;
  const best = rows
    .map((r) => ({ ...r, time: new Date(r.date).getTime() }))
    .filter((r) => Number.isFinite(r.time) && r.time > Date.now() && Number.isFinite(r.eps))
    .sort((a, b) => Math.abs(a.time - target) - Math.abs(b.time - target))[0];
  if (!best) return null;
  return {
    eps: best.eps,
    date: String(best.date).slice(0, 10),
    analysts: Number.isFinite(best.analysts) && best.analysts > 0 ? best.analysts : null,
  };
}

const FETCHED_FIELDS =["price", "eps", "bps", "fcf", "growth", "sectorPer"];
const FINNHUB_FIELDS = ["price", "eps", "bps", "fcf"];

// 결과: values[필드] = 숫자, sources[필드] = { provider, detail, note? }, warnings = 안내 문구 목록,
//       forward = 내년 예상 EPS { eps, date, analysts, provider } 또는 null
// onWait(초): Finnhub 분당 한도 때문에 기다리는 중, onProgress(완료, 전체): 경쟁사 PER 진행 상황
async function fetchFundamentals(ticker, { onWait, onProgress } = {}) {
  const keys = { fmp: ApiKeyStore.get("fmp"), finnhub: ApiKeyStore.get("finnhub") };
  const values = {};
  const sources = {};
  const warnings = [];
  const errors = [];
  let estimates = null;

  const take = (provider, partial) => {
    for (const [field, { value, detail }] of Object.entries(partial)) {
      if (values[field] === undefined && value !== null && Number.isFinite(value)) {
        values[field] = value;
        sources[field] = { provider, detail };
      }
    }
  };

  if (keys.fmp) {
    try {
      const fmp = await fetchFmp(ticker, keys.fmp);
      take("fmp", fmp.fields);
      estimates = fmp.estimates;
      warnings.push(...fmp.warnings);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      errors.push(e);
    }
  }

  const missingForFinnhub = FINNHUB_FIELDS.filter((f) => values[f] === undefined);
  if (missingForFinnhub.length && keys.finnhub) {
    try {
      take("finnhub", await fetchFinnhub(ticker, keys.finnhub, onWait));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      errors.push(e);
    }
  }

  // 업종 PER: Finnhub 경쟁사들의 PER(TTM) 중간값. 티커가 확인된 경우에만 부른다.
  if (values.price !== undefined) {
    if (!keys.finnhub) {
      warnings.push("업종 평균 PER: 경쟁사 PER로 계산하려면 Finnhub API 키가 필요합니다. 직접 입력 필요");
    } else {
      try {
        const peers = await fetchPeerMultiples(ticker, keys.finnhub, { onWait, onProgress });
        if (peers.pe) {
          values.sectorPer = peers.pe.value;
          sources.sectorPer = { provider: "finnhub", detail: peers.pe.note, note: peers.pe.note };
        } else {
          warnings.push(`업종 평균 PER: ${peers.reason} 직접 입력 필요`);
        }
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        warnings.push(`업종 평균 PER: ${e.message} 직접 입력 필요`);
      }
    }
  }

  // 성장률은 최종 EPS(어느 쪽에서 왔든)를 기준으로 계산한다.
  if (estimates) {
    const g = growthFromEstimates(estimates, values.eps);
    if (g) {
      values.growth = g.growth;
      sources.growth = { provider: "fmp", detail: `애널리스트 EPS 추정치 기준 약 ${g.years.toFixed(1)}년 연평균 성장률` };
    } else {
      warnings.push(values.eps > 0
        ? "성장률: 쓸 수 있는 애널리스트 추정치가 없습니다."
        : "성장률: EPS가 0 이하(적자)라 추정치로 성장률을 계산할 수 없습니다.");
    }
  }

  if (values.price === undefined) {
    // 가격조차 못 가져왔으면 실패로 본다. 키 오류·한도 초과를 우선 알려준다.
    const priority = ["key", "limit", "network", "premium", "notfound", "unknown"];
    errors.sort((a, b) => priority.indexOf(a.code) - priority.indexOf(b.code));
    if (errors.length === 0 || errors.every((e) => e.code === "notfound")) {
      throw new ApiError("fmp", "notfound",
        `'${ticker}' 티커를 찾을 수 없습니다. 미국 주식 티커가 맞는지 확인해 주세요. (예: AAPL, MSFT)`);
    }
    const hint = keys.finnhub ? "" : "\nFinnhub API 키를 저장하면 Finnhub에서 다시 시도합니다.";
    throw new ApiError(errors[0].provider, errors[0].code, errors.map((e) => e.message).join("\n") + hint);
  }

  for (const e of errors) {
    const filledBy = e.provider === "fmp" && keys.finnhub ? " 가능한 항목은 Finnhub로 채웠습니다." : "";
    warnings.unshift(`${e.message}${filledBy}`);
  }
  for (const f of FETCHED_FIELDS) {
    if (values[f] === undefined && !warnings.some((w) => w.startsWith(FIELD_NAMES[f]))) {
      warnings.push(`${FIELD_NAMES[f]}: 가져오지 못했습니다. 직접 입력해 주세요.`);
    }
  }
  // 내년 예상 EPS(선행 PER용): FMP 애널리스트 추정치 → 없으면 Alpha Vantage 컨센서스
  let forward = null;
  const fmpForward = pickForwardEstimate(fmpEstimateRows(estimates));
  if (fmpForward) forward = { ...fmpForward, provider: "fmp" };
  if (!forward && values.price !== undefined) {
    const avKey = ApiKeyStore.get("alphavantage");
    if (!avKey) {
      warnings.push("내년 예상 EPS: Alpha Vantage API 키를 저장하면 애널리스트 컨센서스로 선행 PER을 보여줍니다.");
    } else {
      try {
        const avForward = pickForwardEstimate(await fetchAlphaVantageEstimates(ticker, avKey));
        if (avForward) {
          forward = { ...avForward, provider: "alphavantage" };
        } else {
          warnings.push("내년 예상 EPS: Alpha Vantage에 이 종목의 애널리스트 추정치가 없습니다.");
        }
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        warnings.push(`내년 예상 EPS: ${e.message}`);
      }
    }
  }
  return { values, sources, warnings, forward };
}

const FIELD_NAMES = {
  price: "현재 주가", eps: "EPS", bps: "BPS", fcf: "주당 FCF", growth: "성장률", sectorPer: "업종 평균 PER",
};
