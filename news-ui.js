// 관련 기사: Finnhub company-news(무료)로 최근 기사를 보여주고, 기사 요약을 실적발표 분석 칸으로 보낼 수 있다.
// "한글로 보기"를 켜면 translate.js로 제목·요약을 한국어로 바꿔 보여준다(원문은 아래에 작게).
const newsListEl = document.getElementById("news-list");
const newsStatusEl = document.getElementById("news-status");
const newsTranslateStatusEl = document.getElementById("news-translate-status");
const newsDaysSelect = document.getElementById("news-days");
const newsEarningsOnly = document.getElementById("news-earnings-only");
const newsKorean = document.getElementById("news-korean");
const newsChromeSetup = document.getElementById("news-chrome-setup");
const NEWS_MAX = 30;
const NEWS_KOREAN_KEY = "newsKorean";
const EARNINGS_NEWS_RE = /earnings|results|quarter|guidance|outlook|revenue|\beps\b|beats?\b|miss(es|ed)?\b|forecast|fiscal|실적|가이던스|분기/i;

let newsTicker = "";
let newsItems = [];
let translateRun = 0;

try { newsKorean.checked = localStorage.getItem(NEWS_KOREAN_KEY) !== "off"; } catch { /* 저장소 사용 불가 */ }

const isEarningsNews = (n) => EARNINGS_NEWS_RE.test(`${n.headline} ${n.summary}`);
const shownNews = () => (newsEarningsOnly.checked ? newsItems.filter(isEarningsNews) : newsItems).slice(0, NEWS_MAX);

function fmtNewsTime(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 기사 제목과 요약(영어 원문)을 실적발표 분석 칸에 붙이고 바로 분석한다. 원문이 숫자 인식에 더 정확하다.
function sendNewsToEarnings(n) {
  const text = [n.headline, n.summary].filter(Boolean).join("\n");
  earningsText.value = earningsText.value.trim() ? `${earningsText.value.trim()}\n\n${text}` : text;
  document.getElementById("earnings-analyze").click();
  document.getElementById("earnings-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function smallButton(text, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "secondary small";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderNews(doTranslate = true) {
  newsListEl.innerHTML = "";
  const shown = shownNews();
  if (newsItems.length && shown.length === 0) {
    newsListEl.innerHTML = '<p class="note">이 기간에 실적 관련 기사가 없습니다. "실적 관련만" 선택을 풀어 보세요.</p>';
    return;
  }
  const korean = newsKorean.checked;
  for (const n of shown) {
    const item = document.createElement("article");
    item.className = "news-item";
    item.innerHTML = `
      <div class="news-meta"><span class="news-time"></span><span class="news-source"></span></div>
      <h3 class="news-title"></h3>
      <p class="news-original"></p>
      <p class="news-summary"></p>
      <div class="news-actions"></div>`;
    item.querySelector(".news-time").textContent = fmtNewsTime(n.time);
    item.querySelector(".news-source").textContent = n.source;
    if (isEarningsNews(n)) {
      const badge = document.createElement("span");
      badge.className = "badge fair news-badge";
      badge.textContent = "실적";
      item.querySelector(".news-meta").appendChild(badge);
    }

    const koTitle = korean ? cachedKo(n.headline) : null;
    const title = item.querySelector(".news-title");
    const titleText = koTitle || n.headline;
    if (n.url) {
      const a = document.createElement("a");
      a.href = n.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = titleText;
      title.appendChild(a);
    } else {
      title.textContent = titleText;
    }
    if (koTitle) item.querySelector(".news-original").textContent = `원문: ${n.headline}`;

    const actions = item.querySelector(".news-actions");
    const koSummary = korean && n.summary ? cachedKo(n.summary) : null;
    item.querySelector(".news-summary").textContent = koSummary || n.summary;
    if (korean && n.summary && !koSummary) {
      actions.appendChild(smallButton("요약 번역", async (e) => {
        e.target.disabled = true;
        e.target.textContent = "번역 중…";
        try {
          await translateMany([n.summary]);
        } catch (err) {
          setStatus(newsTranslateStatusEl, err.message, "err");
        }
        renderNews(false);
      }));
    }
    if (n.summary) actions.appendChild(smallButton("요약을 실적발표 분석에 넣기", () => sendNewsToEarnings(n)));
    newsListEl.appendChild(item);
  }
  if (doTranslate) translateVisibleNews();
}

// Chrome 내장 번역이 준비돼 있으면 켜고, 모델을 내려받아야 하면 버튼을 보여준다.
async function prepareChromeTranslator() {
  const status = await chromeTranslatorStatus();
  if (status === "available" && !chromeTranslator) {
    try { await createChromeTranslator(); } catch { /* 예비 번역(MyMemory)을 쓴다 */ }
  }
  newsChromeSetup.hidden = Boolean(chromeTranslator) || !(status === "downloadable" || status === "downloading");
  return status;
}

function engineNote(engine) {
  if (engine === "chrome") return "Chrome 내장 번역으로 번역했습니다 (기기 안에서 처리, 무료·무제한). 기계 번역이라 어색할 수 있어요.";
  const chromeHint = newsChromeSetup.hidden ? "" : " Chrome을 쓰시면 'Chrome 번역 켜기'를 눌러 요약까지 무제한으로 번역할 수 있습니다.";
  return "MyMemory 무료 번역으로 제목을 번역했습니다 (하루 약 5,000자 제한). 요약은 기사마다 '요약 번역'을 눌러 주세요." + chromeHint;
}

async function translateVisibleNews() {
  if (!newsKorean.checked || newsItems.length === 0) {
    setStatus(newsTranslateStatusEl, "");
    return;
  }
  const run = ++translateRun;
  await prepareChromeTranslator();
  const shown = shownNews();
  const texts = shown.map((n) => n.headline);
  // 요약은 길어서 무제한인 Chrome 번역일 때만 자동으로 번역한다.
  if (chromeTranslator) texts.push(...shown.map((n) => n.summary).filter(Boolean));
  const engine = chromeTranslator ? "chrome" : "mymemory";
  if (texts.every((t) => cachedKo(t))) {
    setStatus(newsTranslateStatusEl, engineNote(engine));
    return;
  }
  setStatus(newsTranslateStatusEl, `기사 ${shown.length}개를 한국어로 번역하는 중입니다…`);
  try {
    await translateMany(texts);
    if (run !== translateRun) return;
    setStatus(newsTranslateStatusEl, engineNote(engine));
  } catch (e) {
    if (run !== translateRun) return;
    setStatus(newsTranslateStatusEl, `${e.message} 번역되지 않은 기사는 원문으로 보여줍니다.`, "err");
  }
  renderNews(false);
}

async function loadNews(ticker) {
  newsTicker = ticker || newsTicker;
  newsItems = [];
  newsListEl.innerHTML = "";
  setStatus(newsTranslateStatusEl, "");
  if (!newsTicker) {
    setStatus(newsStatusEl, "위에서 티커를 불러오면 관련 기사가 나옵니다.", "warn");
    return;
  }
  const key = ApiKeyStore.get("finnhub");
  if (!key) {
    setStatus(newsStatusEl, "관련 기사는 Finnhub API 키가 있어야 가져올 수 있습니다. 'API 키 설정'에서 저장해 주세요.", "warn");
    return;
  }
  const days = Number(newsDaysSelect.value);
  setStatus(newsStatusEl, `${newsTicker} 최근 ${days}일 기사를 불러오는 중입니다…`);
  try {
    newsItems = await fetchCompanyNews(newsTicker, key, days, (sec) =>
      setStatus(newsStatusEl, `Finnhub 분당 호출 한도(60회)를 넘지 않도록 ${sec}초 기다리는 중입니다…`, "warn"));
  } catch (e) {
    setStatus(newsStatusEl, e instanceof ApiError ? e.message : "기사를 가져오는 중 알 수 없는 오류가 발생했습니다.", "err");
    return;
  }
  if (newsItems.length === 0) {
    setStatus(newsStatusEl, `${newsTicker}: 최근 ${days}일 동안 기사가 없습니다. 기간을 늘려 보세요.`, "warn");
    return;
  }
  const earningsCount = newsItems.filter(isEarningsNews).length;
  const more = newsItems.length > NEWS_MAX ? ` (최신 ${NEWS_MAX}개만 표시)` : "";
  setStatus(newsStatusEl, `${newsTicker}: 최근 ${days}일 기사 ${newsItems.length}개, 그중 실적 관련 ${earningsCount}개${more}`, "ok");
  renderNews();
}

document.getElementById("news-load").addEventListener("click", () => loadNews());
newsDaysSelect.addEventListener("change", () => { if (newsTicker) loadNews(); });
newsEarningsOnly.addEventListener("change", () => renderNews());
newsKorean.addEventListener("change", () => {
  try { localStorage.setItem(NEWS_KOREAN_KEY, newsKorean.checked ? "on" : "off"); } catch { /* 저장소 사용 불가 */ }
  renderNews();
});

// 언어 모델 내려받기는 브라우저가 클릭 안에서만 허용한다.
newsChromeSetup.addEventListener("click", async () => {
  newsChromeSetup.disabled = true;
  try {
    await createChromeTranslator((pct) => setStatus(newsTranslateStatusEl, `Chrome 번역 모델 내려받는 중… ${pct}%`));
    newsChromeSetup.hidden = true;
    setStatus(newsTranslateStatusEl, "Chrome 내장 번역을 켰습니다. 다음부터는 바로 번역됩니다.", "ok");
    renderNews();
  } catch {
    setStatus(newsTranslateStatusEl, "Chrome 내장 번역을 켜지 못했습니다. MyMemory 무료 번역을 계속 사용합니다.", "warn");
  } finally {
    newsChromeSetup.disabled = false;
  }
});
