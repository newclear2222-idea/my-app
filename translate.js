// 영어 → 한국어 번역 (무료)
// 1) Chrome 내장 번역(Translator API): 기기 안에서 번역, 무료·무제한. 처음 한 번 언어 모델을 내려받는다.
// 2) MyMemory 무료 번역 API: 다른 브라우저용 예비 수단. 하루 약 5,000자 제한이 있어 제목 위주로 쓴다.
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const MYMEMORY_MAX_CHARS = 450; // 한 번에 500바이트까지라 여유를 둔다
const TRANSLATE_CACHE_KEY = "translateCacheKo";
const TRANSLATE_CACHE_MAX = 600;
const TRANSLATE_CONCURRENCY = 3;

// 번역 결과는 브라우저에 저장해 같은 문장을 다시 번역하지 않는다(무료 한도 절약).
const translateCache = (() => {
  try {
    const obj = JSON.parse(localStorage.getItem(TRANSLATE_CACHE_KEY) || "{}");
    return new Map(Object.entries(obj));
  } catch { return new Map(); }
})();

function saveTranslateCache() {
  while (translateCache.size > TRANSLATE_CACHE_MAX) translateCache.delete(translateCache.keys().next().value);
  try { localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(Object.fromEntries(translateCache))); } catch { /* 저장소 사용 불가 */ }
}

const cachedKo = (text) => translateCache.get(text) || null;

class TranslateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ----- Chrome 내장 번역 -----
let chromeTranslator = null;

// "available"(바로 사용) | "downloadable"(버튼을 눌러 한 번 내려받기 필요) | "downloading" | "unavailable"
async function chromeTranslatorStatus() {
  if (chromeTranslator) return "available";
  if (typeof Translator === "undefined") return "unavailable";
  try {
    return await Translator.availability({ sourceLanguage: "en", targetLanguage: "ko" });
  } catch { return "unavailable"; }
}

// 모델을 내려받아야 하는 경우 브라우저가 사용자 클릭 안에서만 허용하므로, 버튼 클릭에서 부른다.
async function createChromeTranslator(onProgress) {
  if (chromeTranslator) return chromeTranslator;
  chromeTranslator = await Translator.create({
    sourceLanguage: "en",
    targetLanguage: "ko",
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onProgress && onProgress(Math.round(e.loaded * 100)));
    },
  });
  return chromeTranslator;
}

// ----- MyMemory -----
function clipForMyMemory(text) {
  if (text.length <= MYMEMORY_MAX_CHARS) return text;
  const cut = text.slice(0, MYMEMORY_MAX_CHARS);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (lastStop > 100 ? cut.slice(0, lastStop + 1) : cut) + " …";
}

async function myMemoryTranslate(text) {
  const url = new URL(MYMEMORY_URL);
  url.searchParams.set("q", clipForMyMemory(text));
  url.searchParams.set("langpair", "en|ko");
  let body;
  try {
    const res = await fetch(url);
    body = await res.json();
  } catch {
    throw new TranslateError("network", "번역 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  const out = body && body.responseData && body.responseData.translatedText;
  if (body.quotaFinished || Number(body.responseStatus) === 429 || /USED ALL AVAILABLE FREE TRANSLATIONS/i.test(out || "")) {
    throw new TranslateError("limit", "무료 번역(MyMemory) 하루 한도를 다 썼습니다. 내일 다시 시도하거나 Chrome 내장 번역을 사용해 주세요.");
  }
  if (Number(body.responseStatus) !== 200 || !out) throw new TranslateError("unknown", "번역 중 오류가 발생했습니다.");
  return out;
}

// 기계 번역이 금융 용어를 엉뚱하게 옮기는 경우를 줄이려고 번역 전에 영어 표현을 살짝 바꾼다.
// (예: guidance → "지침", stocks → "재고", shares → "공유"로 번역되는 문제)
const SHARE_MOVE = "rose|rise|rises|fell|fall|falls|jump|jumps|jumped|drop|drops|dropped|surge|surges|surged|slid|slide|slides|slump|slumped|climb|climbs|climbed|rally|rallies|rallied|gain|gains|gained|tumble|tumbled|soar|soared|sink|sank|plunge|plunged";
function prepForTranslation(text) {
  return text
    .replace(/\bguidance\b/gi, "outlook")
    .replace(/\bstocks\b/gi, "stock prices")
    .replace(new RegExp(`\\bshares\\b(?=\\s+(?:of\\s+[A-Z][\\w.&-]*(?:\\s+[A-Z][\\w.&-]*)*\\s+)?(?:${SHARE_MOVE})\\b)`, "gi"), "stock price");
}

// 여러 문장을 번역한다. 이미 번역한 문장은 저장된 결과를 쓴다. 반환: 엔진 이름("chrome" | "mymemory")
async function translateMany(texts) {
  const todo = [...new Set(texts.filter((t) => t && !translateCache.has(t)))];
  const engine = chromeTranslator ? "chrome" : "mymemory";
  let next = 0;
  let error = null;
  const worker = async () => {
    while (next < todo.length && !error) {
      const text = todo[next++];
      try {
        const src = prepForTranslation(text);
        const ko = engine === "chrome" ? await chromeTranslator.translate(src) : await myMemoryTranslate(src);
        translateCache.set(text, ko);
      } catch (e) {
        error = e instanceof TranslateError ? e : new TranslateError("unknown", "번역 중 오류가 발생했습니다.");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TRANSLATE_CONCURRENCY, todo.length) }, worker));
  if (todo.length) saveTranslateCache();
  if (error) throw error;
  return engine;
}
