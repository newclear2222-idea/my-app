// 새로고침 버튼: 페이지(사이트 파일)를 다시 읽은 뒤, 보던 종목과 붙여넣은 실적발표 글을 되살려 최신 데이터로 다시 불러온다.
// 직접 고친 입력값은 새로 불러온 값으로 바뀐다(이전 종목 값이 남지 않게 하는 불러오기 규칙과 같다).
const REFRESH_STATE_KEY = "pendingRefresh";

document.getElementById("page-refresh").addEventListener("click", () => {
  const state = {
    ticker: document.getElementById("ticker").value.trim().toUpperCase(),
    earningsText: document.getElementById("earnings-text").value,
    newsDays: document.getElementById("news-days").value,
    newsEarningsOnly: document.getElementById("news-earnings-only").checked,
  };
  try { sessionStorage.setItem(REFRESH_STATE_KEY, JSON.stringify(state)); } catch { /* 저장소 사용 불가: 그냥 새로고침 */ }
  location.reload();
});

(function restoreAfterRefresh() {
  let state = null;
  try {
    state = JSON.parse(sessionStorage.getItem(REFRESH_STATE_KEY) || "null");
    sessionStorage.removeItem(REFRESH_STATE_KEY);
  } catch { return; }
  if (!state) return;

  if (state.newsDays) document.getElementById("news-days").value = state.newsDays;
  document.getElementById("news-earnings-only").checked = Boolean(state.newsEarningsOnly);
  if (state.earningsText) {
    document.getElementById("earnings-text").value = state.earningsText;
    document.getElementById("earnings-analyze").click();
  }
  if (state.ticker) {
    document.getElementById("ticker").value = state.ticker;
    document.getElementById("load").click();
  }
})();
