const DEFAULT_SETTINGS = {
  enabled: true
};

const enabledToggle = document.getElementById("enabledToggle");

const youtubeStatus = document.getElementById("youtubeStatus");
const playerStatus = document.getElementById("playerStatus");
const adStatus = document.getElementById("adStatus");
const foundSkipStatus = document.getElementById("foundSkipStatus");
const skipStatus = document.getElementById("skipStatus");
const skipCount = document.getElementById("skipCount");
const lastAction = document.getElementById("lastAction");
const lastSkipAt = document.getElementById("lastSkipAt");
const lastCheckedAt = document.getElementById("lastCheckedAt");
const skipButtonText = document.getElementById("skipButtonText");
const refreshButton = document.getElementById("refreshButton");
const statusText = document.getElementById("statusText");
const lastError = document.getElementById("lastError");

let refreshTimer = null;

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    enabledToggle.checked = settings.enabled;
  });
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function requestStatus() {
  const tab = await getCurrentTab();

  if (!tab || !tab.url || !tab.url.includes("youtube.com")) {
    renderStatus({
      enabled: enabledToggle.checked,
      isYouTube: false,
      hasPlayer: false,
      isAdPlaying: false,
      foundSkipButton: false,
      canSkip: false,
      skipCount: 0,
      lastAction: "目前分頁不是 YouTube",
      lastSkipAt: "",
      lastCheckedAt: new Date().toLocaleTimeString()
    });
    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    { type: "GET_STATUS" },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        renderStatus({
          enabled: enabledToggle.checked,
          isYouTube: true,
          hasPlayer: false,
          isAdPlaying: false,
          foundSkipButton: false,
          canSkip: false,
          skipCount: 0,
          lastAction: "尚未注入腳本，請重新整理 YouTube 頁面",
          lastSkipAt: "",
          lastCheckedAt: new Date().toLocaleTimeString()
        });
        return;
      }

      renderStatus(response);
    }
  );
}

function renderStatus(status) {
  youtubeStatus.textContent = status.isYouTube ? "是" : "否";
  playerStatus.textContent = status.hasPlayer ? "已找到" : "未找到";
  adStatus.textContent = status.isAdPlaying ? "是" : "否";
  foundSkipStatus.textContent = status.foundSkipButton ? "是" : "否";
  skipStatus.textContent = status.canSkip ? "是" : "否";
  skipCount.textContent = String(status.skipCount || 0);
  skipButtonText.textContent = status.skipButtonText || "無";
  lastAction.textContent = status.lastAction || "無狀態";
  lastError.textContent = status.lastError || "無";
  lastSkipAt.textContent = status.lastSkipAt
    ? `最近略過：${status.lastSkipAt}`
    : "最近略過：無";

  lastCheckedAt.textContent = status.lastCheckedAt
    ? `最後檢查：${status.lastCheckedAt}`
    : "";
}

async function toggleEnabled() {
  const enabled = enabledToggle.checked;

  chrome.storage.sync.set({ enabled });

  const tab = await getCurrentTab();

  if (!tab || !tab.url || !tab.url.includes("youtube.com")) {
    requestStatus();
    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "SET_ENABLED",
      enabled
    },
    () => {
      requestStatus();
    }
  );
}

enabledToggle.addEventListener("change", toggleEnabled);

refreshButton.addEventListener("click", () => {
  requestStatus();
  statusText.textContent = "已重新偵測";

  setTimeout(() => {
    statusText.textContent = "";
  }, 1000);
});

loadSettings();
requestStatus();

refreshTimer = setInterval(requestStatus, 1000);

window.addEventListener("unload", () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});