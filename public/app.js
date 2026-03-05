const ALLERGY_NAMES = {
  1: "난류",
  2: "우유",
  3: "메밀",
  4: "땅콩",
  5: "대두",
  6: "밀",
  7: "고등어",
  8: "게",
  9: "새우",
  10: "돼지고기",
  11: "복숭아",
  12: "토마토",
  13: "아황산류",
  14: "호두",
  15: "닭고기",
  16: "쇠고기",
  17: "오징어",
  18: "조개류",
  19: "잣",
};

const STORAGE_KEYS = {
  theme: "gbsw_theme",
  userId: "gbsw_user_id",
  mobileView: "gbsw_mobile_view",
};

const MOBILE_VIEWS = ["dashboard", "meals", "engage", "settings"];
let deferredInstallPrompt = null;

const CONGESTION_STALE_MS = 2 * 60 * 1000;
const THEME_TRANSITION_MS = 700;
const MODAL_TRANSITION_MS = 260;
const ALLERGY_MODAL_TRANSITION_MS = 520;
const NUTRITION_MODAL_TRANSITION_MS = 800;

const MEAL_SOURCE_LABELS = {
  neis: "NEIS 실데이터",
  "neis-nearest": "NEIS 실데이터(가까운 제공일 자동보정)",
  "neis-no-data": "NEIS 데이터 없음",
  "neis-error": "NEIS 호출 오류",
  "config-missing": "NEIS 설정 누락",
};

const state = {
  userId: getOrCreateUserId(),
  googleAuthEnabled: false,
  googleAuthMissing: [],
  googleCallbackUrl: "",
  authenticated: false,
  authUser: null,
  meals: null,
  currentMealType: "lunch",
  selectedAllergies: [],
  currentMealDate: getTodayDateKey(),
  engagementDate: getTodayDateKey(),
  followToday: true,
  currentVoteChoice: null,
  currentMyScore: null,
  mealSource: null,
  mealSourceLabel: "급식 데이터 확인 중",
  mealResolvedDate: null,
  socketConnected: false,
  realtimeCongestionAvailable: false,
  lastCongestionUpdatedAtMs: null,
  dateSyncInProgress: false,
  pendingDateResync: false,
  mobileView: "dashboard",
};

function getOrCreateUserId() {
  let userId = localStorage.getItem(STORAGE_KEYS.userId);
  if (!userId) {
    const randomPart = window.crypto?.randomUUID ? window.crypto.randomUUID().slice(0, 12) : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    userId = `web-${randomPart}`;
    localStorage.setItem(STORAGE_KEYS.userId, userId);
  }
  return userId;
}

function getTodayDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateKey(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function toDateKeyFromDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDateKey(dateKey, offsetDays) {
  const base = parseDateKey(dateKey) || new Date();
  base.setDate(base.getDate() + offsetDays);
  return toDateKeyFromDate(base);
}

function formatKoreanDate(dateKey) {
  const date = parseDateKey(dateKey) || new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatFullDate(dateKey) {
  const date = parseDateKey(dateKey) || parseDateKey(getTodayDateKey()) || new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

function isTodayDateKey(dateKey) {
  return dateKey === getTodayDateKey();
}

function formatTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": state.userId,
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || "요청 처리 중 오류가 발생했습니다.");
  }

  return json;
}

function showToast(message, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.remove("success", "error", "show");
  if (type === "success") {
    el.classList.add("success");
  }
  if (type === "error") {
    el.classList.add("error");
  }

  window.clearTimeout(showToast.timerId);
  el.classList.add("show");
  showToast.timerId = window.setTimeout(() => {
    el.classList.remove("show");
  }, 2400);
}

function showLoginRequiredBanner(message) {
  const banner = document.getElementById("login-required-banner");
  if (!banner) {
    showToast(message, "error");
    return;
  }

  banner.textContent = message;
  window.clearTimeout(showLoginRequiredBanner.timerId);
  banner.classList.remove("hidden", "show");
  // Restart animation when triggered repeatedly.
  void banner.offsetWidth;
  requestAnimationFrame(() => {
    banner.classList.add("show");
  });

  showLoginRequiredBanner.timerId = window.setTimeout(() => {
    banner.classList.remove("show");
    banner.classList.add("hidden");
  }, 2300);
}

function consumeAuthFeedbackFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const login = params.get("login");
  const reason = params.get("reason");

  if (!login) {
    return;
  }

  if (login === "success") {
    showToast("Google 로그인에 성공했습니다.", "success");
  } else if (login === "failed") {
    if (reason === "oauth_not_configured") {
      showToast("Google OAuth 설정이 누락되었습니다. 관리자 설정을 확인하세요.", "error");
    } else if (reason) {
      showToast(`Google 로그인 실패: ${reason}`, "error");
    } else {
      showToast("Google 로그인에 실패했습니다.", "error");
    }
  }

  params.delete("login");
  params.delete("reason");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function canParticipate() {
  return state.googleAuthEnabled && state.authenticated;
}

function setParticipationEnabled(enabled) {
  const starContainer = document.getElementById("star-buttons");
  if (starContainer) {
    starContainer.classList.toggle("disabled", !enabled);
  }

  document.querySelectorAll("#star-buttons button").forEach((button) => {
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  });
}

function updateAuthUi() {
  const chip = document.getElementById("auth-user");
  const action = document.getElementById("auth-action");

  if (!state.googleAuthEnabled) {
    chip.textContent = "Google 로그인 미설정";
    action.textContent = "로그인 비활성";
    action.disabled = true;
    setParticipationEnabled(false);
    return;
  }

  action.disabled = false;
  if (state.authenticated) {
    const label = state.authUser?.displayName || state.authUser?.email || "로그인됨";
    chip.textContent = label;
    action.textContent = "로그아웃";
  } else {
    chip.textContent = "로그인 필요";
    action.textContent = "Google 로그인";
  }

  setParticipationEnabled(canParticipate());
}

function notifyLoginRequired(featureName) {
  if (featureName === "특식 투표" || featureName === "식단 만족도") {
    showLoginRequiredBanner("Google 로그인 후 투표가 가능합니다.");
    return;
  }

  showToast(`${featureName} 기능은 Google 로그인 후 이용할 수 있습니다.`, "error");
}

async function loadAuthStatus() {
  const json = await requestJson("/api/auth/me");
  state.googleAuthEnabled = Boolean(json.googleAuthEnabled);
  state.googleAuthMissing = Array.isArray(json.googleAuthMissing) ? json.googleAuthMissing : [];
  state.googleCallbackUrl = String(json.googleCallbackUrl || "").trim();
  state.authenticated = Boolean(json.authenticated);
  state.authUser = json.user || null;
  updateAuthUi();
}

async function handleAuthAction() {
  if (!state.googleAuthEnabled) {
    const missingText = state.googleAuthMissing.length > 0
      ? `누락: ${state.googleAuthMissing.join(", ")}`
      : "Google OAuth 설정을 확인하세요.";
    showToast(missingText, "error");
    if (state.googleCallbackUrl) {
      showLoginRequiredBanner(`승인된 리디렉션 URI에 ${state.googleCallbackUrl} 를 추가하세요.`);
    }
    return;
  }

  if (state.authenticated) {
    await requestJson("/api/auth/logout", { method: "POST" });
    state.authenticated = false;
    state.authUser = null;
    try {
      await loadAllergiesFromServer();
    } catch {
      state.selectedAllergies = [];
    }
    renderMeals();
    await syncSelectedDateData({ includeMeals: false, includeEngagement: true });
    updateAuthUi();
    showToast("로그아웃되었습니다.", "success");
    return;
  }

  window.location.href = "/auth/google";
}

function initAuthActions() {
  const action = document.getElementById("auth-action");
  action.addEventListener("click", () => {
    handleAuthAction().catch((error) => {
      showToast(error.message, "error");
    });
  });
}

function setSocketStatus(connected) {
  state.socketConnected = connected;
  refreshRealtimeState();
}

function syncDatePickerValue() {
  const picker = document.getElementById("meal-date-picker");
  if (!picker) {
    return;
  }
  if (picker.value !== state.currentMealDate) {
    picker.value = state.currentMealDate;
  }
}

function setDateLabel() {
  const el = document.getElementById("current-date");
  const today = getTodayDateKey();
  const isToday = state.currentMealDate === today;
  el.textContent = isToday
    ? `${formatKoreanDate(state.currentMealDate)} 기준`
    : `${formatKoreanDate(state.currentMealDate)} 선택`;

  const mealTitle = document.getElementById("meal-title");
  if (mealTitle) {
    mealTitle.textContent = isToday ? "오늘의 식단" : `${formatKoreanDate(state.currentMealDate)} 식단`;
  }

  syncDatePickerValue();
}

function updateThemeToggleLabel(theme) {
  const button = document.getElementById("theme-toggle");
  if (!button) {
    return;
  }
  button.textContent = theme === "dark" ? "라이트 테마" : "다크 테마";
}

function applyTheme(theme, options = {}) {
  const { animate = false } = options;
  const body = document.body;

  if (animate) {
    body.classList.add("theme-transitioning");
    window.clearTimeout(applyTheme.timerId);
    applyTheme.timerId = window.setTimeout(() => {
      body.classList.remove("theme-transitioning");
    }, THEME_TRANSITION_MS);
  }

  if (theme === "dark") {
    body.classList.add("dark");
  } else {
    body.classList.remove("dark");
  }

  updateThemeToggleLabel(theme);
}

function initThemeToggle() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const defaultTheme = saved || (prefersDark ? "dark" : "light");
  applyTheme(defaultTheme);

  const button = document.getElementById("theme-toggle");
  button.addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    localStorage.setItem(STORAGE_KEYS.theme, next);
    applyTheme(next, { animate: true });
  });
}

function applyMobileView(view, options = {}) {
  const { save = true } = options;
  const normalized = MOBILE_VIEWS.includes(view) ? view : "dashboard";
  state.mobileView = normalized;

  document.body.classList.remove("mobile-view-dashboard", "mobile-view-meals", "mobile-view-engage", "mobile-view-settings");
  document.body.classList.add(`mobile-view-${normalized}`);

  document.querySelectorAll(".app-bottom-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === normalized);
  });

  if (save) {
    localStorage.setItem(STORAGE_KEYS.mobileView, normalized);
  }
}

function scrollToMobileSection(view) {
  if (window.innerWidth > 1080) {
    return;
  }

  const targetSelectorMap = {
    dashboard: ".panel-dashboard",
    meals: ".panel-meals",
    engage: ".panel-engage",
    settings: ".panel-settings",
  };

  const selector = targetSelectorMap[view];
  const target = selector ? document.querySelector(selector) : null;
  if (!target) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar?.getBoundingClientRect().height || 0;
  const targetTop = target.getBoundingClientRect().top + window.scrollY - (topbarHeight + 18);

  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

function initMobileTabs() {
  const tabs = document.querySelectorAll(".app-bottom-tab");
  if (tabs.length === 0) {
    return;
  }

  const savedView = localStorage.getItem(STORAGE_KEYS.mobileView);
  applyMobileView(savedView || "dashboard", { save: false });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      applyMobileView(tab.dataset.view);
      scrollToMobileSection(tab.dataset.view);
    });
  });
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/service-worker.js");
  } catch (error) {
    console.error("service worker registration failed", error);
  }
}

function initPwaInstallButton() {
  const installButton = document.getElementById("app-install");
  if (!installButton) {
    return;
  }

  if (isStandaloneMode()) {
    installButton.hidden = true;
    return;
  }

  installButton.hidden = false;
  installButton.disabled = false;
  installButton.textContent = "앱으로 추가";

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
    installButton.disabled = false;
    installButton.textContent = "앱 설치";
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
    showToast("앱 설치가 완료되었습니다.", "success");
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showToast("브라우저 메뉴에서 홈 화면에 추가 또는 Dock에 추가를 선택하세요.");
      return;
    }

    installButton.disabled = true;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    installButton.disabled = false;
    installButton.hidden = true;

    if (choice?.outcome === "accepted") {
      showToast("앱 설치를 시작합니다.", "success");
      return;
    }

    showToast("앱 설치가 취소되었습니다.");
  });
}

function initTopScrollButton() {
  const button = document.getElementById("top-scroll-button");
  if (!button) {
    return;
  }

  const threshold = 240;
  const updateVisibility = () => {
    button.classList.toggle("visible", window.scrollY > threshold);
  };

  updateVisibility();
  window.addEventListener("scroll", updateVisibility, { passive: true });

  button.addEventListener("click", () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  });
}

function updateCongestionUI(payload) {
  const data = payload?.data || payload;
  if (!data) {
    return;
  }

  const updatedAtMs = data.updatedAt ? new Date(data.updatedAt).getTime() : null;
  if (Number.isFinite(updatedAtMs)) {
    state.lastCongestionUpdatedAtMs = updatedAtMs;
  }

  const badge = document.getElementById("congestion-badge");
  const progress = document.getElementById("progress-bar");

  document.getElementById("current-count").textContent = String(Number(data.currentCount || 0));
  document.getElementById("max-capacity").textContent = `${Number(data.maxCapacity || 0)}석`;
  document.getElementById("wait-minutes").textContent = `${Number(data.waitMinutes || 0)}분`;
  document.getElementById("updated-at").textContent = `업데이트: ${formatTime(data.updatedAt)}`;

  if (data.lastSensorEvent) {
    const eventType = data.lastSensorEvent.eventType;
    const eventLabel = eventType === "entry" ? "입장" : eventType === "exit" ? "퇴장" : "수동설정";
    document.getElementById("sensor-info").textContent = `최근 센서 이벤트: ${eventLabel} (${data.lastSensorEvent.sensorId})`;
  } else {
    document.getElementById("sensor-info").textContent = "최근 센서 이벤트: 없음";
  }

  badge.classList.remove("comfortable", "normal", "crowded");
  progress.classList.remove("normal", "crowded");

  const levelCode = data.level?.code || "comfortable";
  const levelLabel = data.level?.label || "쾌적";
  badge.textContent = levelLabel;
  badge.classList.add(levelCode);

  if (levelCode === "normal") {
    progress.classList.add("normal");
  }
  if (levelCode === "crowded") {
    progress.classList.add("crowded");
  }

  progress.style.width = `${Math.max(0, Math.min(100, Number(data.percent || 0)))}%`;
  refreshRealtimeState();
}

function refreshRealtimeState() {
  const now = Date.now();
  const hasFreshCongestion = Number.isFinite(state.lastCongestionUpdatedAtMs)
    && (now - state.lastCongestionUpdatedAtMs) <= CONGESTION_STALE_MS;

  state.realtimeCongestionAvailable = Boolean(hasFreshCongestion);

  const chip = document.getElementById("socket-status");
  const connected = state.realtimeCongestionAvailable;

  chip.textContent = connected ? "연결됨" : "미연결됨";
  chip.classList.toggle("connected", connected);
  chip.classList.toggle("disconnected", !connected);

  const card = document.querySelector(".congestion-card");
  card.classList.toggle("offline", !state.realtimeCongestionAvailable);
}

function hasAllergyConflict(allergies) {
  if (!Array.isArray(allergies) || allergies.length === 0) {
    return [];
  }

  return allergies.filter((code) => state.selectedAllergies.includes(code));
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    return;
  }

  window.clearTimeout(modal.hideTimerId);
  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    modal.classList.add("open");
  });
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal || modal.classList.contains("hidden")) {
    return;
  }

  const transitionMs = modalId === "allergy-modal"
    ? ALLERGY_MODAL_TRANSITION_MS
    : modalId === "nutrition-modal"
      ? NUTRITION_MODAL_TRANSITION_MS
      : MODAL_TRANSITION_MS;

  modal.classList.remove("open");
  window.clearTimeout(modal.hideTimerId);
  modal.hideTimerId = window.setTimeout(() => {
    if (!modal.classList.contains("open")) {
      modal.classList.add("hidden");
    }
  }, transitionMs);
}

function openNutritionModal(item) {
  const mealLabel = item.mealLabel || "선택한 끼니";
  const requestedDate = item.requestDate || state.currentMealDate;
  const resolvedDate = item.resolvedDate || requestedDate;

  document.getElementById("nutrition-title").textContent = item.name;
  document.getElementById("nutrition-scope").textContent = `${mealLabel} 메뉴 상세 정보`;
  document.getElementById("detail-meal-label").textContent = mealLabel;
  document.getElementById("detail-request-date").textContent = formatFullDate(requestedDate);
  document.getElementById("detail-resolved-date").textContent = formatFullDate(resolvedDate);
  document.getElementById("detail-source").textContent = item.sourceLabel || state.mealSourceLabel;

  const tags = document.getElementById("nutrition-allergies");
  tags.innerHTML = "";

  if (item.allergyNames?.length) {
    item.allergyNames.forEach((name) => {
      const tag = document.createElement("span");
      tag.className = "allergy-tag";
      tag.textContent = name;
      tags.appendChild(tag);
    });
  } else {
    const tag = document.createElement("span");
    tag.className = "pill";
    tag.textContent = "알레르기 표시 성분 없음";
    tags.appendChild(tag);
  }

  openModal("nutrition-modal");
}

function closeNutritionModal() {
  closeModal("nutrition-modal");
}

function renderMeals() {
  const mealList = document.getElementById("meal-list");
  mealList.innerHTML = "";

  const mealBlock = state.meals?.[state.currentMealType];
  if (!mealBlock) {
    const li = document.createElement("li");
    li.className = "meal-item";
    li.textContent = "식단 데이터를 불러오지 못했습니다.";
    mealList.appendChild(li);
    document.getElementById("meal-summary").textContent = "메뉴 요약: 데이터 없음";
    return;
  }

  const conflictCount = mealBlock.items.reduce((count, item) => {
    return count + (hasAllergyConflict(item.allergies).length > 0 ? 1 : 0);
  }, 0);
  document.getElementById("meal-summary").textContent = `메뉴 ${mealBlock.items.length}개 · 설정된 알레르기 주의 ${conflictCount}개`;

  if (mealBlock.items.length === 0) {
    const li = document.createElement("li");
    li.className = "meal-item";
    li.textContent = "해당 끼니의 식단이 없습니다.";
    mealList.appendChild(li);
    return;
  }

  mealBlock.items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "meal-item";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `${item.name} 메뉴 상세 정보 열기`);

    const conflicts = hasAllergyConflict(item.allergies);
    if (conflicts.length > 0) {
      li.classList.add("conflict");
    }

    const itemMain = document.createElement("div");
    itemMain.className = "meal-main";

    const nameWrap = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    nameWrap.appendChild(name);

    const badges = document.createElement("div");
    badges.className = "badges";

    if (item.allergies?.length) {
      const info = document.createElement("span");
      info.className = "pill";
      info.textContent = `알레르기 ${item.allergies.join(".")}`;
      badges.appendChild(info);
    }

    if (conflicts.length > 0) {
      const alert = document.createElement("span");
      alert.className = "pill alert";
      alert.textContent = `주의: ${conflicts.map((code) => ALLERGY_NAMES[code]).join(", ")}`;
      badges.appendChild(alert);
    }

    itemMain.appendChild(nameWrap);
    itemMain.appendChild(badges);

    const detailHint = document.createElement("span");
    detailHint.className = "meal-detail-hint";
    detailHint.textContent = "상세";

    const modalPayload = {
      ...item,
      mealLabel: mealBlock.label,
      requestDate: state.currentMealDate,
      resolvedDate: state.mealResolvedDate,
      sourceLabel: state.mealSourceLabel,
    };

    li.appendChild(itemMain);
    li.appendChild(detailHint);

    li.addEventListener("click", () => openNutritionModal(modalPayload));
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openNutritionModal(modalPayload);
      }
    });

    mealList.appendChild(li);
  });
}

function setActiveMealTab(mealType) {
  state.currentMealType = mealType;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mealType === mealType);
  });
  renderMeals();
}

async function loadMeals(dateKey = state.currentMealDate) {
  const json = await requestJson(`/api/meals?date=${dateKey}`);
  if (dateKey !== state.currentMealDate) {
    return;
  }

  state.meals = json.meals;
  state.mealSource = json.source || "neis-no-data";
  state.mealSourceLabel = MEAL_SOURCE_LABELS[state.mealSource] || "급식 데이터";
  state.mealResolvedDate = json.resolvedDate || dateKey;

  const sourceLabel = state.mealSourceLabel;
  const resolvedDateText = json.source === "neis-nearest" && json.resolvedDate
    ? ` · 제공일 ${json.resolvedDate}`
    : "";
  document.getElementById("meal-source").textContent = `급식 데이터: ${sourceLabel}${resolvedDateText}`;
  renderMeals();
}

function renderVote(data) {
  const voteList = document.getElementById("vote-list");
  voteList.innerHTML = "";

  state.currentVoteChoice = data.myChoice || state.currentVoteChoice;

  document.getElementById("vote-title").textContent = data.title;
  document.getElementById("vote-total").textContent = `총 ${data.totalVotes}표 · 참여 ${data.participantCount}명 · 기준 ${state.engagementDate}`;

  data.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vote-option";
    const allowed = canParticipate();
    button.setAttribute("aria-disabled", allowed ? "false" : "true");
    if (!allowed) {
      button.classList.add("disabled");
    }

    if (state.currentVoteChoice === option.id) {
      button.classList.add("selected");
    }

    const row = document.createElement("div");
    row.className = "vote-row";
    row.innerHTML = `<span class="vote-label">${option.label}</span><span class="vote-percent">${option.percent}%</span>`;

    if (state.currentVoteChoice === option.id) {
      const pickedTag = document.createElement("span");
      pickedTag.className = "vote-picked";
      pickedTag.textContent = "내 선택";
      row.querySelector(".vote-label").appendChild(pickedTag);
    }

    const track = document.createElement("div");
    track.className = "vote-track";
    const fill = document.createElement("div");
    fill.className = "vote-fill";
    fill.style.width = `${option.percent}%`;

    track.appendChild(fill);
    button.appendChild(row);
    button.appendChild(track);

    button.addEventListener("click", async () => {
      if (!canParticipate()) {
        notifyLoginRequired("특식 투표");
        return;
      }

      try {
        const json = await requestJson("/api/votes/special", {
          method: "POST",
          body: JSON.stringify({
            date: state.engagementDate,
            optionId: option.id,
          }),
        });

        state.currentVoteChoice = json.data.myChoice;
        renderVote(json.data);
        showToast("특식 투표가 저장되었습니다.", "success");
      } catch (error) {
        showToast(error.message, "error");
      }
    });

    voteList.appendChild(button);
  });
}

async function loadVote(dateKey = state.engagementDate) {
  const json = await requestJson(`/api/votes/special?date=${dateKey}`);
  if (dateKey !== state.engagementDate) {
    return;
  }
  renderVote(json.data);
}

function getRoundedAverageScore(average) {
  const numeric = Number(average);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return Math.min(5, Math.max(1, Math.round(numeric)));
}

function highlightStars(score, options = {}) {
  const averageMode = Boolean(options.averageMode);
  const container = document.getElementById("star-buttons");
  container.classList.remove("score-1", "score-2", "score-3", "score-4", "score-5", "average-mode");

  if (averageMode) {
    container.classList.add("average-mode");
  } else if (score >= 1 && score <= 5) {
    container.classList.add(`score-${score}`);
  }

  document.querySelectorAll("#star-buttons button").forEach((button) => {
    button.classList.toggle("on", Number(button.dataset.score) <= score);
  });
}

function renderRatingFeedback(score, options = {}) {
  const averageMode = Boolean(options.averageMode);
  const feedback = document.getElementById("rating-feedback");
  feedback.classList.remove("tone-low", "tone-mid", "tone-high");

  if (averageMode) {
    feedback.textContent = "로그아웃 상태에서는 평균 별점이 표시됩니다.";
    return;
  }

  const messages = {
    1: "아쉬워요. 다음 식단에 반영되도록 의견이 저장됐어요.",
    2: "조금 아쉬웠어요. 개선 의견으로 집계됩니다.",
    3: "보통이었어요. 솔직한 평가 감사합니다.",
    4: "좋았어요. 다음 메뉴 기획에 긍정적으로 반영됩니다.",
    5: "아주 만족스러워요. 최고 평점으로 저장됐습니다.",
  };

  if (!score || !messages[score]) {
    feedback.textContent = "별점을 선택해주세요.";
    return;
  }

  feedback.textContent = messages[score];
  if (score <= 2) {
    feedback.classList.add("tone-low");
  } else if (score === 3) {
    feedback.classList.add("tone-mid");
  } else {
    feedback.classList.add("tone-high");
  }
}

function renderRating(summary) {
  const myScore = Number.isInteger(Number(summary.myScore)) ? Number(summary.myScore) : null;
  const averageStars = getRoundedAverageScore(summary.average);
  const showAveragePreview = !canParticipate() && !myScore;
  const displayScore = myScore || (showAveragePreview ? averageStars : 0);

  state.currentMyScore = myScore;
  highlightStars(displayScore, { averageMode: showAveragePreview });
  renderRatingFeedback(displayScore, { averageMode: showAveragePreview });

  const text = document.getElementById("rating-summary");
  const myText = myScore
    ? `내 평점 ${myScore}점`
    : showAveragePreview
      ? `로그아웃 상태 · 평균 별점 ${averageStars}개 표시`
      : "아직 내 평가 없음";
  text.textContent = `평균 ${summary.average}점 · 참여 ${summary.participantCount}명 · ${myText} · 기준 ${state.engagementDate}`;
}

async function loadRating(dateKey = state.engagementDate) {
  const json = await requestJson(`/api/ratings?date=${dateKey}`);
  if (dateKey !== state.engagementDate) {
    return;
  }
  renderRating(json.data);
}

function initStarRating() {
  document.querySelectorAll("#star-buttons button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!canParticipate()) {
        notifyLoginRequired("식단 만족도");
        return;
      }

      const score = Number(button.dataset.score);

      try {
        const json = await requestJson("/api/ratings", {
          method: "POST",
          body: JSON.stringify({
            date: state.engagementDate,
            score,
          }),
        });

        renderRating(json.data);
        showToast("식단 만족도가 저장되었습니다.", "success");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function renderAllergySettings() {
  const container = document.getElementById("allergy-grid");
  container.innerHTML = "";

  Object.entries(ALLERGY_NAMES).forEach(([code, name]) => {
    const label = document.createElement("label");
    label.className = "allergy-check";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = code;
    const selected = state.selectedAllergies.includes(Number(code));
    input.checked = selected;
    label.classList.toggle("selected", selected);
    input.addEventListener("change", () => {
      label.classList.toggle("selected", input.checked);
    });

    const span = document.createElement("span");
    span.textContent = `${code}. ${name}`;

    label.appendChild(input);
    label.appendChild(span);
    container.appendChild(label);
  });
}

async function loadAllergiesFromServer() {
  const json = await requestJson("/api/profile/allergies");
  state.selectedAllergies = json.data.allergies || [];
}

async function saveAllergiesToServer(allergies) {
  const json = await requestJson("/api/profile/allergies", {
    method: "PUT",
    body: JSON.stringify({ allergies }),
  });

  state.selectedAllergies = json.data.allergies || [];
}

function openAllergyModal() {
  renderAllergySettings();
  openModal("allergy-modal");
}

function closeAllergyModal() {
  closeModal("allergy-modal");
}

function initAllergyModal() {
  document.getElementById("allergy-settings-open").addEventListener("click", openAllergyModal);
  document.getElementById("allergy-close").addEventListener("click", closeAllergyModal);

  document.getElementById("allergy-save").addEventListener("click", async () => {
    try {
      const selected = Array.from(document.querySelectorAll("#allergy-grid input:checked")).map((el) => Number(el.value));
      await saveAllergiesToServer(selected);
      closeAllergyModal();
      renderMeals();
      showToast("알레르기 설정을 저장했습니다.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  document.getElementById("allergy-modal").addEventListener("click", (event) => {
    if (event.target.id === "allergy-modal") {
      closeAllergyModal();
    }
  });
}

function initNutritionModal() {
  document.getElementById("nutrition-close").addEventListener("click", closeNutritionModal);
  document.getElementById("nutrition-modal").addEventListener("click", (event) => {
    if (event.target.id === "nutrition-modal") {
      closeNutritionModal();
    }
  });
}

function initGlobalShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    closeNutritionModal();
    closeAllergyModal();
  });
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setActiveMealTab(button.dataset.mealType));
  });
}

function initSocket() {
  const socket = io();

  socket.on("connect", () => {
    setSocketStatus(true);
    loadCongestion().catch(() => undefined);
  });
  socket.on("disconnect", () => {
    setSocketStatus(false);
  });

  socket.on("congestion:update", (data) => {
    updateCongestionUI(data);
  });

  socket.on("vote:update", (payload) => {
    if (payload?.date && payload.date !== state.engagementDate) {
      return;
    }
    loadVote().catch(() => undefined);
  });

  socket.on("rating:update", (payload) => {
    if (payload?.date && payload.date !== state.engagementDate) {
      return;
    }
    loadRating().catch(() => undefined);
  });

  socket.on("connect_error", () => {
    setSocketStatus(false);
  });
}

async function loadCongestion() {
  const json = await requestJson("/api/congestion");
  updateCongestionUI(json);
}

function prepareDateChange(nextDateKey) {
  const parsed = parseDateKey(nextDateKey);
  if (!parsed) {
    showToast("날짜 형식이 올바르지 않습니다.", "error");
    return false;
  }

  const normalized = toDateKeyFromDate(parsed);
  if (normalized === state.currentMealDate) {
    return false;
  }

  state.currentMealDate = normalized;
  state.followToday = isTodayDateKey(normalized);
  setDateLabel();
  closeNutritionModal();

  return true;
}

async function syncSelectedDateData({
  showDateChangedToast = false,
  includeMeals = true,
  includeEngagement = true,
} = {}) {
  if (state.dateSyncInProgress) {
    state.pendingDateResync = true;
    return;
  }

  state.dateSyncInProgress = true;
  state.pendingDateResync = false;
  const mealDateKey = state.currentMealDate;
  const engagementDateKey = state.engagementDate;
  try {
    const tasks = [];
    if (includeMeals) {
      tasks.push(loadMeals(mealDateKey));
    }
    if (includeEngagement) {
      tasks.push(loadVote(engagementDateKey), loadRating(engagementDateKey));
    }
    await Promise.all(tasks);

    if (showDateChangedToast) {
      showToast("자정이 지나 오늘 데이터로 자동 전환되었습니다.", "success");
    }
  } finally {
    state.dateSyncInProgress = false;
    if (
      state.pendingDateResync
      && (mealDateKey !== state.currentMealDate || engagementDateKey !== state.engagementDate)
    ) {
      syncSelectedDateData().catch((error) => {
        showToast(error.message, "error");
      });
    }
  }
}

function initDateControls() {
  const picker = document.getElementById("meal-date-picker");
  const prevButton = document.getElementById("date-prev");
  const nextButton = document.getElementById("date-next");
  const todayButton = document.getElementById("date-today");

  syncDatePickerValue();

  picker.addEventListener("change", async () => {
    if (!prepareDateChange(picker.value)) {
      syncDatePickerValue();
      return;
    }

    try {
      await syncSelectedDateData({ includeEngagement: false });
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  prevButton.addEventListener("click", async () => {
    const nextDate = shiftDateKey(state.currentMealDate, -1);
    if (!prepareDateChange(nextDate)) {
      return;
    }
    try {
      await syncSelectedDateData({ includeEngagement: false });
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  nextButton.addEventListener("click", async () => {
    const nextDate = shiftDateKey(state.currentMealDate, 1);
    if (!prepareDateChange(nextDate)) {
      return;
    }
    try {
      await syncSelectedDateData({ includeEngagement: false });
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  todayButton.addEventListener("click", async () => {
    const today = getTodayDateKey();
    if (!prepareDateChange(today)) {
      showToast("이미 오늘 날짜를 보고 있습니다.", "success");
      return;
    }
    try {
      await syncSelectedDateData({ includeEngagement: false });
      showToast("오늘 날짜로 이동했습니다.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function initDateBoundaryWatcher() {
  setInterval(() => {
    const todayDateKey = getTodayDateKey();
    let needsMealRefresh = false;
    let needsEngagementRefresh = false;

    if (todayDateKey !== state.engagementDate) {
      state.engagementDate = todayDateKey;
      state.currentVoteChoice = null;
      state.currentMyScore = null;
      highlightStars(0);
      renderRatingFeedback(0);
      needsEngagementRefresh = true;
    }

    if (state.followToday && todayDateKey !== state.currentMealDate) {
      if (prepareDateChange(todayDateKey)) {
        needsMealRefresh = true;
      }
    }

    if (!needsMealRefresh && !needsEngagementRefresh) {
      return;
    }

    syncSelectedDateData({
      showDateChangedToast: needsEngagementRefresh,
      includeMeals: needsMealRefresh,
      includeEngagement: needsEngagementRefresh,
    }).catch((error) => {
      showToast(error.message, "error");
    });
  }, 60 * 1000);
}

async function bootstrap() {
  consumeAuthFeedbackFromUrl();
  initPwaInstallButton();
  registerServiceWorker().catch(() => undefined);
  setDateLabel();
  initThemeToggle();
  initMobileTabs();
  initTopScrollButton();
  initAuthActions();
  initTabs();
  initDateControls();
  initAllergyModal();
  initNutritionModal();
  initGlobalShortcuts();
  initStarRating();

  try {
    await loadCongestion();
  } catch (error) {
    setSocketStatus(false);
    console.error(error);
  }

  try {
    await loadAuthStatus();
  } catch (error) {
    showToast(error.message, "error");
  }

  try {
    await loadAllergiesFromServer();
  } catch (error) {
    state.selectedAllergies = [];
  }

  try {
    await syncSelectedDateData();
  } catch (error) {
    showToast(error.message, "error");
  }

  initSocket();
  initDateBoundaryWatcher();

  setInterval(() => {
    loadMeals().catch(() => undefined);
  }, 1000 * 60 * 5);

  setInterval(() => {
    loadCongestion().catch(() => {
      setSocketStatus(false);
    });
  }, 20 * 1000);

  setInterval(() => {
    refreshRealtimeState();
  }, 5 * 1000);
}

document.addEventListener("DOMContentLoaded", bootstrap);
