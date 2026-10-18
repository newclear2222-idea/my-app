// 실적발표 자료 분석 (규칙 기반, 무료)
// 붙여넣은 글에서 FCF·매출·EPS·성장률·가이던스 같은 숫자를 정해진 표현으로 찾는다.
// 한국어("잉여현금흐름 21억 달러", "전년 대비 +37%")와 영어("free cash flow of $2.1 billion")를 지원한다.

// 긴 표현이 짧은 표현보다 우선한다(예: "주당순이익"이 "순이익"보다, "매출총이익률"이 "매출"보다).
const EARNINGS_METRICS = [
  { key: "fcfPerShare", label: "주당 FCF", kind: "perShare", words: ["주당 fcf", "주당fcf", "주당 잉여현금흐름", "fcf per share", "free cash flow per share"] },
  { key: "fcfMargin", label: "FCF 마진", kind: "ratio", words: ["fcf 마진", "fcf마진", "잉여현금흐름 마진", "fcf margin", "free cash flow margin"] },
  { key: "fcf", label: "잉여현금흐름(FCF)", kind: "money", words: ["잉여현금흐름", "잉여 현금 흐름", "잉여현금", "free cash flow", "fcf"] },
  { key: "ocf", label: "영업현금흐름", kind: "money", words: ["영업활동현금흐름", "영업현금흐름", "영업 현금 흐름", "operating cash flow", "cash flow from operations", "cash from operations"] },
  { key: "capex", label: "설비투자(CapEx)", kind: "money", words: ["설비투자", "자본적 지출", "자본지출", "capex", "capital expenditures", "capital expenditure"] },
  { key: "grossMargin", label: "매출총이익률", kind: "ratio", words: ["매출총이익률", "총이익률", "gross margin"] },
  { key: "grossProfit", label: "매출총이익", kind: "money", words: ["매출총이익", "gross profit"] },
  { key: "operatingMargin", label: "영업이익률", kind: "ratio", words: ["영업이익률", "operating margin"] },
  { key: "eps", label: "EPS", kind: "perShare", words: ["주당순이익", "주당 순이익", "earnings per share", "eps"] },
  { key: "netIncome", label: "순이익", kind: "money", words: ["순이익", "net income"] },
  { key: "revenue", label: "매출", kind: "money", words: ["매출액", "매출", "revenue", "revenues", "net sales", "sales"] },
  { key: "shares", label: "주식 수", kind: "count", words: ["발행주식수", "발행 주식 수", "희석주식수", "희석 주식 수", "주식 수", "주식수", "diluted shares", "shares outstanding", "weighted average shares"] },
];

const PERIOD_WORDS = {
  ttm: ["ttm", "최근 12개월", "trailing twelve", "trailing 12"],
  quarter: ["분기", "quarter", "quarterly", "q1", "q2", "q3", "q4", "1q", "2q", "3q", "4q"],
  annual: ["연간", "annual", "full year", "full-year", "fy", "회계연도", "올해", "내년", "yearly"],
};
// "시장 예상치", "컨센서스"는 회사 가이던스가 아니므로 "예상"은 따로 판별한다.
const GUIDANCE_WORDS = ["가이던스", "guidance", "전망", "outlook", "예측", "expects", "expect", "forecast", "다음 분기", "next quarter", "향후"];
const GUIDANCE_RE = /(?<!시장\s?)예상(?!치)/;
const YOY_WORDS = ["전년 대비", "전년대비", "전년 동기", "전년동기", "작년 대비", "yoy", "y/y", "year over year", "year-over-year", "from a year"];
const QOQ_WORDS = ["전분기", "전 분기", "qoq", "q/q", "sequential", "sequentially"];
const DOWN_WORDS = ["감소", "하락", "줄", "축소", "decline", "declined", "decrease", "decreased", "down", "fell", "drop", "lower"];

const KOREAN_SCALE = { 조: 1e12, 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4 };
const ENGLISH_SCALE = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

const isAsciiWord = (w) => /^[a-z0-9 /\-]+$/.test(w);

// 영어 단어는 앞뒤가 다른 영문자가 아닐 때만 맞는 것으로 본다(예: "eps"가 "steps" 안에서 맞지 않게).
function findWord(text, word, from = 0) {
  let i = text.indexOf(word, from);
  while (i !== -1) {
    if (!isAsciiWord(word)) return i;
    const before = text[i - 1] || " ";
    const after = text[i + word.length] || " ";
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return i;
    i = text.indexOf(word, i + 1);
  }
  return -1;
}

const hasAny = (text, words) => words.some((w) => findWord(text, w) !== -1);

const toNum = (s) => Number(String(s).replace(/,/g, ""));

// 문장 단위로 나눈다. 소수점(2.1)은 자르지 않는다.
function splitSegments(text) {
  return text
    .split(/\n+|(?<=[.!?。])\s+(?=\D)|(?<=다\.)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

// "104~110억 달러", "$10.4 to $11.0 billion"처럼 앞 숫자에 단위가 빠진 범위를 "104억 달러 ~ 110억 달러"로 바꾼다.
function normalizeRanges(s) {
  return s.replace(
    /(\$)?(\d[\d,]*(?:\.\d+)?)\s?([~∼–]|to|-)\s?(\$)?(\d[\d,]*(?:\.\d+)?)\s?(조|억|billion|million|bn|mn|b|m)(?![a-z])/gi,
    (m, c1, a, sep, c2, b, scale) => {
      const cur = c1 || c2 || "";
      const sp = /[a-z]/i.test(scale) && scale.length > 1 ? " " : "";
      return `${cur}${a}${sp}${scale} ~ ${cur}${b}${sp}${scale}`;
    },
  );
}

const MONEY_RE = /(US\$|\$|USD\s?)?\s?(\d[\d,]*(?:\.\d+)?)\s?(?:(조|억|천만|백만|만)(?:\s?(\d[\d,]*(?:\.\d+)?)\s?(천만|백만|만))?)?\s?(billion|million|thousand|bn|mn|b|m|k)?(?![a-z])\s?(달러|불|USD|원|주|shares)?/gi;

// 금액(또는 주식 수) 토큰: { value, start, end, hasCurrency }
function moneyTokens(s) {
  const out = [];
  for (const m of s.matchAll(MONEY_RE)) {
    const [, pre, num, ks, num2, ks2, es, suf] = m;
    if (suf === "원") continue; // 원화 금액은 무시
    const hasCurrency = Boolean(pre || (suf && /달러|불|usd/i.test(suf)));
    const hasScale = Boolean(ks || es);
    if (!hasCurrency && !hasScale) continue; // 단위 없는 숫자(연도, 개수 등)는 금액이 아니다
    let value = toNum(num) * (ks ? KOREAN_SCALE[ks] : 1);
    if (num2 && ks2) value += toNum(num2) * KOREAN_SCALE[ks2];
    if (es) value *= ENGLISH_SCALE[es.toLowerCase()];
    const start = m.index + m[0].indexOf(num) - (pre ? pre.length : 0);
    const before = s.slice(0, Math.max(0, start)).trimEnd();
    if (/[-−]$/.test(before) && !/\d\s*[-−]$/.test(before)) value = -value;
    out.push({ value, start: m.index, end: m.index + m[0].length, hasCurrency });
  }
  return out;
}

function percentTokens(s) {
  const out = [];
  for (const m of s.matchAll(/([+\-−]?\d+(?:\.\d+)?)\s?(%p|%|퍼센트|percent|pct)/gi)) {
    if (m[2].toLowerCase() === "%p") continue; // %포인트(마진 변화폭)는 성장률이 아니다
    out.push({ value: toNum(m[1].replace("−", "-")), explicitSign: /^[+\-−]/.test(m[1]), start: m.index });
  }
  return out;
}

function detectPeriod(text) {
  if (hasAny(text, GUIDANCE_WORDS) || GUIDANCE_RE.test(text)) return "guidance";
  if (hasAny(text, PERIOD_WORDS.ttm)) return "ttm";
  if (hasAny(text, PERIOD_WORDS.quarter)) return "quarter";
  if (hasAny(text, PERIOD_WORDS.annual)) return "annual";
  return null;
}

// 가이던스가 분기인지 연간인지
function guidanceSpan(text) {
  if (hasAny(text, PERIOD_WORDS.quarter) || text.includes("다음 분기")) return "quarter";
  if (hasAny(text, PERIOD_WORDS.annual)) return "annual";
  return null;
}

// 한 문장에서 지표 키워드 위치를 모두 찾는다. 다른 키워드 안에 포함된 짧은 키워드는 버린다.
function keywordHits(lower) {
  const hits = [];
  for (const metric of EARNINGS_METRICS) {
    for (const word of metric.words) {
      let i = findWord(lower, word);
      while (i !== -1) {
        hits.push({ metric, start: i, end: i + word.length });
        i = findWord(lower, word, i + 1);
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const h of hits) {
    if (kept.some((k) => h.start < k.end && h.end > k.start)) continue;
    kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// 반환: 후보 목록 [{ key, label, kind, value, low, high, percent, growthKind, period, guidanceSpan, snippet }]
function parseEarningsText(text) {
  const results = [];
  const segments = splitSegments(text);
  // 기간이 안 적힌 문장은 앞 문장(가이던스 제외)의 보고 기간을 이어받는다. 앞에 없으면 글 전체에서 처음 나온 기간.
  const segPeriods = segments.map((s) => detectPeriod(s.toLowerCase()));
  const docPeriod = segPeriods.find((p) => p && p !== "guidance") || null;
  let reportPeriod = docPeriod;

  segments.forEach((rawSeg, segIdx) => {
    if (segPeriods[segIdx] && segPeriods[segIdx] !== "guidance") reportPeriod = segPeriods[segIdx];
    const seg = normalizeRanges(rawSeg);
    const lower = seg.toLowerCase();
    const hits = keywordHits(lower);
    hits.forEach((hit, idx) => {
      const winEnd = idx + 1 < hits.length ? hits[idx + 1].start : seg.length;
      const win = seg.slice(hit.end, winEnd);
      const winLower = win.toLowerCase();
      const ctx = lower.slice(0, winEnd); // 기간·가이던스 단어는 문장 앞부분에 나오는 경우가 많다
      const { metric } = hit;
      const item = { key: metric.key, label: metric.label, kind: metric.kind, value: null, low: null, high: null, percent: null, growthKind: null };

      const tokens = moneyTokens(win);
      if (metric.kind === "money" || metric.kind === "count" || metric.kind === "perShare") {
        let money = metric.kind === "perShare" ? tokens.filter((t) => t.hasCurrency) : tokens;
        if (metric.kind === "perShare" && money.length === 0) {
          // "EPS 1.18"처럼 통화 표시 없이 바로 오는 소수
          const bare = win.match(/^[^\d%]{0,12}?([-−]?\d+\.\d+)(?!\s?%)/);
          if (bare) money = [{ value: toNum(bare[1].replace("−", "-")), start: 0, end: 0 }];
        }
        if (money.length) {
          item.value = money[0].value;
          const between = money[1] ? win.slice(money[0].end, money[1].start) : "";
          if (money[1] && /^\s*(~|∼|–|-|to|에서|부터|and)\s*$/i.test(between)) {
            item.low = Math.min(money[0].value, money[1].value);
            item.high = Math.max(money[0].value, money[1].value);
            item.value = (item.low + item.high) / 2;
          } else if (money[1] && /^\s*(±|\+\/-|\+-|plus or minus)\s*$/i.test(between)) {
            item.low = money[0].value - money[1].value;
            item.high = money[0].value + money[1].value;
          }
        }
      }

      const pcts = percentTokens(win);
      if (metric.kind === "ratio") {
        if (pcts.length) item.value = pcts[0].value;
      } else if (pcts.length && metric.kind !== "count") {
        const p = pcts[0];
        let pct = p.value;
        if (!p.explicitSign && hasAny(winLower, DOWN_WORDS)) pct = -Math.abs(pct);
        item.percent = pct;
        item.growthKind = hasAny(winLower, QOQ_WORDS) ? "qoq" : hasAny(winLower, YOY_WORDS) ? "yoy" : null;
      }

      if (item.value === null && item.percent === null) return;
      item.period = detectPeriod(winLower) || detectPeriod(ctx) || reportPeriod;
      item.guidanceSpan = item.period === "guidance" ? guidanceSpan(winLower) || guidanceSpan(ctx) : null;
      item.snippet = rawSeg.length > 180 ? rawSeg.slice(0, 177) + "…" : rawSeg;
      results.push(item);
    });
  });

  // 같은 지표·같은 값·같은 기간이 여러 번 나오면 하나만 남긴다.
  const seen = new Set();
  return results.filter((r) => {
    const id = `${r.key}|${r.value}|${r.percent}|${r.period}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
