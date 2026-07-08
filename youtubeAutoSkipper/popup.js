const DEFAULT_SETTINGS = {
  enabled: true,
  checkIntervalMs: 300
};

const enabledToggle = document.getElementById("enabledToggle");
const intervalInput = document.getElementById("intervalInput");

const youtubeStatus = document.getElementById("youtubeStatus");
const adStatus = document.getElementById("adStatus");
const skipStatus = document.getElementById("skipStatus");
const lastAction = document.getElementById("lastAction");
const lastCheckedAt = document.getElementById("lastCheckedAt");

const saveButton = document.getElementById("saveButton");
const refreshButton = document.getElementById("refreshButton");
const statusText = document.getElementById("statusText");

let statusTimer = null;

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    enabledToggle.checked = settings.enabled;
    intervalInput.value = settings.checkIntervalMs;
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
  try {
    const tab = await getCurrentTab();

    if (!tab || !tab.url || !tab.url.includes("youtube.com")) {
      renderStatus({
        enabled: enabledToggle.checked,
        isYouTube: false,
        isAdPlaying: false,
        canSkip: false,
        lastAction: "目前分頁不是 YouTube",
        lastCheckedAt: new Date().toLocaleTimeString()
      });
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_STATUS" },
      (response) => {
        if (chrome.runtime.lastError) {
          renderStatus({
            enabled: enabledToggle.checked,
            isYouTube: true,
            isAdPlaying: false,
            canSkip: false,
            lastAction: "尚未注入腳本，請重新整理 YouTube 頁面",
            lastCheckedAt: new Date().toLocaleTimeString()
          });
          return;
        }

        renderStatus(response);
      }
    );
  } catch (error) {
    renderStatus({
      enabled: enabledToggle.checked,
      isYouTube: false,
      isAdPlaying: false,
      canSkip: false,
      lastAction: "狀態讀取失敗",
      lastCheckedAt: new Date().toLocaleTimeString()
    });
  }
}

function renderStatus(status) {
  youtubeStatus.textContent = status.isYouTube ? "是" : "否";
  adStatus.textContent = status.isAdPlaying ? "是" : "否";
  skipStatus.textContent = status.canSkip ? "是" : "否";

  lastAction.textContent = status.lastAction || "無狀態";
  lastCheckedAt.textContent = status.lastCheckedAt
    ? `最後檢查：${status.lastCheckedAt}`
    : "";
}

function saveSettings() {
  const checkIntervalMs = Number(intervalInput.value);

  if (!Number.isInteger(checkIntervalMs) || checkIntervalMs < 200) {
    statusText.textContent = "檢查間隔至少需要 200ms";
    return;
  }

  chrome.storage.sync.set(
    {
      enabled: enabledToggle.checked,
      checkIntervalMs
    },
    () => {
      statusText.textContent = "設定已儲存";
      requestStatus();

      setTimeout(() => {
        statusText.textContent = "";
      }, 1500);
    }
  );
}

async function toggleEnabled() {
  const tab = await getCurrentTab();

  chrome.storage.sync.set({ enabled: enabledToggle.checked });

  if (tab && tab.url && tab.url.includes("youtube.com")) {
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: "SET_ENABLED",
        enabled: enabledToggle.checked
      },
      () => {
        requestStatus();
      }
    );
  }
}

saveButton.addEventListener("click", saveSettings);
refreshButton.addEventListener("click", requestStatus);
enabledToggle.addEventListener("change", toggleEnabled);

loadSettings();
requestStatus();

statusTimer = setInterval(requestStatus, 1000);

window.addEventListener("unload", () => {
  if (statusTimer) {
    clearInterval(statusTimer);
  }
});