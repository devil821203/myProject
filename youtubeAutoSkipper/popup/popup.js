"use strict";

const DEFAULT_SETTINGS = { enabled: true, checkIntervalMs: 500 };
const LOG_STORAGE_KEY = "youtubeAutoSkipperLogs";

const $ = (id) => document.getElementById(id);
const enabledToggle = $("enabledToggle");
const intervalInput = $("intervalInput");
const saveStatus = $("saveStatus");
const logOutput = $("logOutput");

initialize();

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledToggle.checked = settings.enabled;
  intervalInput.value = settings.checkIntervalMs;
  await refreshAll();
  setInterval(refreshAll, 1000);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshAll() {
  await Promise.allSettled([requestStatus(), loadLogs()]);
}

async function requestStatus() {
  const tab = await getCurrentTab();
  if (!tab?.id || !tab.url?.includes("youtube.com")) {
    renderStatus({ isYouTube: false, lastAction: "目前作用中的分頁不是 YouTube" });
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "GET_TAB_STATUS", tabId: tab.id });
  renderStatus(response || { isYouTube: true, lastError: "無法取得狀態" });
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
  $("lastError").textContent = status.lastError || "";
  $("lastSkipAt").textContent = status.lastSkipAt ? `上次略過：${formatTime(status.lastSkipAt)}` : "";
  $("lastCheckedAt").textContent = status.lastCheckedAt ? `上次檢查：${formatTime(status.lastCheckedAt)}` : "";
}

$("saveButton").addEventListener("click", async () => {
  const checkIntervalMs = Math.min(5000, Math.max(300, Number(intervalInput.value) || 500));
  await chrome.storage.sync.set({ enabled: enabledToggle.checked, checkIntervalMs });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  intervalInput.value = checkIntervalMs;
  saveStatus.textContent = "設定已儲存";
  setTimeout(() => { saveStatus.textContent = ""; }, 1500);
});

$("refreshButton").addEventListener("click", async () => {
  const tab = await getCurrentTab();
  if (!tab?.id || !tab.url?.includes("youtube.com")) return;
  $("lastAction").textContent = "正在執行 CDP 偵測…";
  const response = await chrome.runtime.sendMessage({ type: "FORCE_SCAN", tabId: tab.id });
  if (response?.status) renderStatus(response.status);
});

$("refreshLogsButton").addEventListener("click", loadLogs);
$("clearLogsButton").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
  await loadLogs();
});

async function loadLogs() {
  const stored = await chrome.storage.local.get({ [LOG_STORAGE_KEY]: [] });
  const logs = Array.isArray(stored[LOG_STORAGE_KEY]) ? stored[LOG_STORAGE_KEY] : [];
  logOutput.value = logs.slice().reverse().map((log) => {
    const detail = log.detail === undefined ? "" : `\n${JSON.stringify(log.detail, null, 2)}`;
    return `[${formatTime(log.time)}] [${log.level}] [${log.source}] ${log.message}${detail}`;
  }).join("\n\n");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-TW", { hour12: false });
}
