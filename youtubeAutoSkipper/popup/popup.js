"use strict";

const DEFAULT_SETTINGS = { enabled: true, checkIntervalMs: 500 };
const LOG_STORAGE_KEY = "youtubeAutoSkipperLogs";
const CONFIG = globalThis.YOUTUBE_AUTO_SKIPPER_CONFIG || { mode: "user" };
const DISPLAY_MODE = CONFIG.mode === "developer" ? "developer" : "user";

const $ = (id) => document.getElementById(id);
const enabledToggle = $("enabledToggle");
const intervalInput = $("intervalInput");
const saveStatus = $("saveStatus");
const logOutput = $("logOutput");

initialize().catch((error) => {
  console.error("Popup 初始化失敗", error);
  renderUserStatus({ lastError: error.message });
});

async function initialize() {
  document.body.classList.add(`${DISPLAY_MODE}-mode`);
  $("modeBadge").textContent = DISPLAY_MODE === "developer" ? "DEVELOPER" : "USER";

  const manifest = chrome.runtime.getManifest();
  $("versionText").textContent = `v${manifest.version}`;

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledToggle.checked = settings.enabled;
  intervalInput.value = settings.checkIntervalMs;
  updateEnabledDescription(settings.enabled);

  await refreshAll();
  setInterval(refreshAll, DISPLAY_MODE === "developer" ? 1000 : 1500);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshAll() {
  const jobs = [requestStatus()];
  if (DISPLAY_MODE === "developer") jobs.push(loadLogs());
  await Promise.allSettled(jobs);
}

async function requestStatus() {
  const tab = await getCurrentTab();

  if (!tab?.id || !isYouTubeUrl(tab.url)) {
    const status = {
      isYouTube: false,
      lastAction: "目前作用中的分頁不是 YouTube"
    };
    renderStatus(status);
    renderUserStatus(status);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_TAB_STATUS",
      tabId: tab.id
    });
    const status = response || {
      isYouTube: true,
      lastError: "無法取得擴充功能狀態"
    };
    renderStatus(status);
    renderUserStatus(status);
  } catch (error) {
    const status = {
      isYouTube: true,
      lastError: error.message || "背景服務尚未就緒"
    };
    renderStatus(status);
    renderUserStatus(status);
  }
}

function isYouTubeUrl(url = "") {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function renderStatus(status = {}) {
  $("youtubeStatus").textContent = status.isYouTube ? "是" : "否";
  $("playerStatus").textContent = status.hasPlayer ? "已找到" : "未找到";
  $("adStatus").textContent = status.isAdPlaying ? "是" : "否";
  $("foundSkipStatus").textContent = status.foundSkipButton ? "是" : "否";
  $("skipStatus").textContent = status.canSkip ? "是" : "否";
  $("skipCount").textContent = String(status.skipCount || 0);
  $("skipButtonText").textContent = status.skipButtonText || "無";
  $("matchedSelector").textContent = status.matchedSelector || "無";
  $("lastAction").textContent = status.lastAction || "無";

  const lastError = $("lastError");
  lastError.textContent = status.lastError || "";
  lastError.classList.toggle("show", Boolean(status.lastError));

  $("lastSkipAt").textContent = status.lastSkipAt
    ? `上次略過：${formatTime(status.lastSkipAt)}`
    : "";
  $("lastCheckedAt").textContent = status.lastCheckedAt
    ? `上次檢查：${formatTime(status.lastCheckedAt)}`
    : "";
}

function renderUserStatus(status = {}) {
  const title = $("userStatusTitle");
  const message = $("userStatusMessage");
  const icon = $("userStatusIcon");

  $("userSkipCount").textContent = String(status.skipCount || 0);
  $("userTabStatus").textContent = status.isYouTube ? "YouTube" : "非 YouTube";
  $("userLastSkipAt").textContent = status.lastSkipAt
    ? `上次略過：${formatTime(status.lastSkipAt)}`
    : "尚未記錄略過時間";

  icon.className = "status-icon";

  if (!enabledToggle.checked) {
    icon.textContent = "Ⅱ";
    icon.classList.add("paused");
    title.textContent = "自動略過已關閉";
    message.textContent = "開啟上方開關即可繼續使用";
    return;
  }

  if (status.lastError) {
    icon.textContent = "!";
    icon.classList.add("error");
    title.textContent = "暫時無法運作";
    message.textContent = status.lastError;
    return;
  }

  if (!status.isYouTube) {
    icon.textContent = "▶";
    icon.classList.add("idle");
    title.textContent = "等待 YouTube 分頁";
    message.textContent = "開啟 YouTube 影片後會自動開始偵測";
    return;
  }

  if (status.isAdPlaying && status.canSkip) {
    icon.textContent = "↠";
    icon.classList.add("working");
    title.textContent = "正在略過廣告";
    message.textContent = "已偵測到可略過的廣告";
    return;
  }

  if (status.isAdPlaying) {
    icon.textContent = "…";
    icon.classList.add("working");
    title.textContent = "廣告播放中";
    message.textContent = "等待「略過廣告」按鈕出現";
    return;
  }

  icon.textContent = "✓";
  icon.classList.add("ready");
  title.textContent = "功能正常運作中";
  message.textContent = status.lastAction || "正在監控目前的 YouTube 分頁";
}

function updateEnabledDescription(enabled) {
  $("enabledDescription").textContent = enabled
    ? "功能啟用後會自動偵測可略過的廣告"
    : "目前不會自動偵測或略過廣告";
}

enabledToggle.addEventListener("change", async () => {
  const enabled = enabledToggle.checked;
  await chrome.storage.sync.set({ enabled });
  updateEnabledDescription(enabled);

  try {
    await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  } catch (error) {
    console.warn("通知背景服務失敗", error);
  }

  await requestStatus();
});

$("saveButton").addEventListener("click", async () => {
  const checkIntervalMs = Math.min(
    5000,
    Math.max(300, Number(intervalInput.value) || 500)
  );

  await chrome.storage.sync.set({
    enabled: enabledToggle.checked,
    checkIntervalMs
  });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });

  intervalInput.value = checkIntervalMs;
  saveStatus.textContent = "設定已儲存";
  setTimeout(() => { saveStatus.textContent = ""; }, 1500);
});

$("refreshButton").addEventListener("click", forceScan);
$("userRefreshButton").addEventListener("click", forceScan);

async function forceScan() {
  const tab = await getCurrentTab();
  if (!tab?.id || !isYouTubeUrl(tab.url)) {
    renderUserStatus({ isYouTube: false });
    return;
  }

  $("userStatusTitle").textContent = "正在重新偵測";
  $("userStatusMessage").textContent = "請稍候";
  $("lastAction").textContent = "正在執行 CDP 偵測…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FORCE_SCAN",
      tabId: tab.id
    });
    if (response?.status) {
      renderStatus(response.status);
      renderUserStatus(response.status);
    }
  } catch (error) {
    renderUserStatus({ isYouTube: true, lastError: error.message });
  }
}

$("refreshLogsButton").addEventListener("click", loadLogs);
$("clearLogsButton").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
  await loadLogs();
});

async function loadLogs() {
  const stored = await chrome.storage.local.get({ [LOG_STORAGE_KEY]: [] });
  const logs = Array.isArray(stored[LOG_STORAGE_KEY])
    ? stored[LOG_STORAGE_KEY]
    : [];

  logOutput.value = logs.slice().reverse().map((log) => {
    const detail = log.detail === undefined
      ? ""
      : `\n${JSON.stringify(log.detail, null, 2)}`;
    return `[${formatTime(log.time)}] [${log.level}] [${log.source}] ${log.message}${detail}`;
  }).join("\n\n");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value || "")
    : date.toLocaleString("zh-TW", { hour12: false });
}
