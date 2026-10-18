// 관련 기사: Finnhub company-news(무료)로 최근 기사를 보여주고, 기사 요약을 실적발표 분석 칸으로 보낼 수 있다.
const newsListEl = document.getElementById("news-list");
const newsStatusEl = document.getElementById("news-status");
const newsDaysSelect = document.getElementById("news-days");
const newsEarningsOnly = document.getElementById("news-earnings-only");
const NEWS_MAX = 30;
const EARNINGS_NEWS_RE = /earnings|results|quarter|guidance|outlook|revenue|\beps\b|beats?\b|miss(es|ed)?\b|forecast|fiscal|실적|가이던스|분기/i;

let newsTicker = "";
let newsItems = [];

const isEarningsNews = (n) => EARNINGS_NEWS_RE.test(`${n.headline} ${n.summary}`);

function fmtNewsTime(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 기사 제목과 요약을 실적발표 분석 칸에 붙이고 바로 분석한다.
function sendNewsToEarnings(n) {
  const text = [n.headline, n.summary].filter(Boolean).join("\n");
  earningsText.value = earningsText.value.trim() ? `${earningsText.value.trim()}\n\n${text}` : text;
  document.getElementById("earnings-analyze").click();
  document.getElementById("earnings-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderNews() {
  newsListEl.innerHTML = "";
  const shown = (newsEarningsOnly.checked ? newsItems.filter(isEarningsNews) : newsItems).slice(0, NEWS_MAX);
  if (newsItems.length && shown.length === 0) {
    newsListEl.innerHTML = '<p class="note">이 기간에 실적 관련 기사가 없습니다. "실적 관련만" 선택을 풀어 보세요.</p>';
    return;
  }
  for (const n of shown) {
    const item = document.createElement("article");
    item.className = "news-item";
    item.innerHTML = `
      <div class="news-meta"><span class="news-time"></span><span class="news-source"></span></div>
      <h3 class="news-title"></h3>
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
    const title = item.querySelector(".news-title");
    if (n.url) {
      const a = document.createElement("a");
      a.href = n.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = n.headline;
      title.appendChild(a);
    } else {
      title.textContent = n.headline;
    }
    item.querySelector(".news-summary").textContent = n.summary;
    if (n.summary) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary small";
      btn.textContent = "요약을 실적발표 분석에 넣기";
      btn.addEventListener("click", () => sendNewsToEarnings(n));
      item.querySelector(".news-actions").appendChild(btn);
    }
    newsListEl.appendChild(item);
  }
}

async function loadNews(ticker) {
  newsTicker = ticker || newsTicker;
  newsItems = [];
  newsListEl.innerHTML = "";
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
newsEarningsOnly.addEventListener("change", renderNews);
