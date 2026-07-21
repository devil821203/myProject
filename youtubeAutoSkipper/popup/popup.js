const DEFAULT_SETTINGS = {
  enabled: true,
  checkIntervalMs: 500
};

const LOG_STORAGE_KEY =
  "youtubeAutoSkipperLogs";

const enabledToggle =
  document.getElementById(
    "enabledToggle"
  );

const intervalInput =
  document.getElementById(
    "intervalInput"
  );

const youtubeStatus =
  document.getElementById(
    "youtubeStatus"
  );

const playerStatus =
  document.getElementById(
    "playerStatus"
  );

const adStatus =
  document.getElementById(
    "adStatus"
  );

const foundSkipStatus =
  document.getElementById(
    "foundSkipStatus"
  );

const skipStatus =
  document.getElementById(
    "skipStatus"
  );

const skipCount =
  document.getElementById(
    "skipCount"
  );

const skipButtonText =
  document.getElementById(
    "skipButtonText"
  );

const matchedSelector =
  document.getElementById(
    "matchedSelector"
  );

const lastAction =
  document.getElementById(
    "lastAction"
  );

const lastError =
  document.getElementById(
    "lastError"
  );

const lastSkipAt =
  document.getElementById(
    "lastSkipAt"
  );

const lastCheckedAt =
  document.getElementById(
    "lastCheckedAt"
  );

const saveButton =
  document.getElementById(
    "saveButton"
  );

const refreshButton =
  document.getElementById(
    "refreshButton"
  );

const saveStatus =
  document.getElementById(
    "saveStatus"
  );

const refreshLogsButton =
  document.getElementById(
    "refreshLogsButton"
  );

const clearLogsButton =
  document.getElementById(
    "clearLogsButton"
  );

const logOutput =
  document.getElementById(
    "logOutput"
  );

let refreshTimer = null;

initialize();

function initialize() {
  loadSettings();
  requestStatus();
  loadLogs();

  refreshTimer = setInterval(
    () => {
      requestStatus();
      loadLogs();
    },
    1000
  );
}

function loadSettings() {
  chrome.storage.sync.get(
    DEFAULT_SETTINGS,
    (settings) => {
      enabledToggle.checked =
        settings.enabled;

      intervalInput.value =
        settings.checkIntervalMs;
    }
  );
}

async function getCurrentTab() {
  const tabs =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  return tabs[0];
}

async function requestStatus() {
  const tab =
    await getCurrentTab();

  if (
    !tab ||
    !tab.id ||
    !tab.url ||
    !tab.url.includes(
      "youtube.com"
    )
  ) {
    renderStatus({
      enabled:
        enabledToggle.checked,
      isYouTube: false,
      hasPlayer: false,
      isAdPlaying: false,
      foundSkipButton: false,
      canSkip: false,
      skipButtonText: "",
      matchedSelector: "",
      skipCount: 0,
      lastAction:
        "目前作用中的分頁不是 YouTube",
      lastSkipAt: "",
      lastCheckedAt:
        new Date()
          .toLocaleTimeString(),
      lastError: ""
    });

    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "GET_STATUS"
    },
    (response) => {
      if (
        chrome.runtime
          .lastError ||
        !response
      ) {
        renderStatus({
          enabled:
            enabledToggle
              .checked,
          isYouTube: true,
          hasPlayer: false,
          isAdPlaying: false,
          foundSkipButton: false,
          canSkip: false,
          skipButtonText: "",
          matchedSelector: "",
          skipCount: 0,
          lastAction:
            "尚未注入腳本，請重新整理 YouTube 頁面",
          lastSkipAt: "",
          lastCheckedAt:
            new Date()
              .toLocaleTimeString(),
          lastError:
            chrome.runtime
              .lastError
              ?.message || ""
        });

        return;
      }

      renderStatus(response);
    }
  );
}

function renderStatus(status) {
  youtubeStatus.textContent =
    status.isYouTube
      ? "是"
      : "否";

  playerStatus.textContent =
    status.hasPlayer
      ? "已找到"
      : "未找到";

  adStatus.textContent =
    status.isAdPlaying
      ? "是"
      : "否";

  foundSkipStatus.textContent =
    status.foundSkipButton
      ? "是"
      : "否";

  skipStatus.textContent =
    status.canSkip
      ? "是"
      : "否";

  skipCount.textContent =
    String(
      status.skipCount || 0
    );

  skipButtonText.textContent =
    status.skipButtonText ||
    "無";

  matchedSelector.textContent =
    status.matchedSelector ||
    "無";

  lastAction.textContent =
    status.lastAction ||
    "無狀態";

  lastSkipAt.textContent =
    status.lastSkipAt
      ? `最近略過：${status.lastSkipAt}`
      : "最近略過：無";

  lastCheckedAt.textContent =
    status.lastCheckedAt
      ? `最後檢查：${status.lastCheckedAt}`
      : "";

  const errorText =
    status.lastError || "";

  lastError.textContent =
    errorText;

  lastError.classList.toggle(
    "show",
    Boolean(errorText)
  );
}

async function setEnabled() {
  const enabled =
    enabledToggle.checked;

  chrome.storage.sync.set({
    enabled
  });

  const tab =
    await getCurrentTab();

  if (
    !tab ||
    !tab.id ||
    !tab.url ||
    !tab.url.includes(
      "youtube.com"
    )
  ) {
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

async function saveSettings() {
  const checkIntervalMs =
    Number(
      intervalInput.value
    );

  if (
    !Number.isInteger(
      checkIntervalMs
    ) ||
    checkIntervalMs < 300
  ) {
    showSaveMessage(
      "檢查間隔至少需要 300ms",
      true
    );

    return;
  }

  chrome.storage.sync.set(
    {
      enabled:
        enabledToggle.checked,
      checkIntervalMs
    },
    async () => {
      const tab =
        await getCurrentTab();

      if (
        tab?.id &&
        tab.url?.includes(
          "youtube.com"
        )
      ) {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type:
              "SET_INTERVAL",
            checkIntervalMs
          },
          () => {
            requestStatus();
          }
        );
      }

      showSaveMessage(
        "設定已儲存"
      );
    }
  );
}

async function loadLogs() {
  const result =
    await chrome.storage.local.get(
      LOG_STORAGE_KEY
    );

  const logs =
    Array.isArray(
      result[
        LOG_STORAGE_KEY
      ]
    )
      ? result[
          LOG_STORAGE_KEY
        ]
      : [];

  logOutput.value =
    logs
      .slice()
      .reverse()
      .map(formatLog)
      .join("\n\n");
}

function formatLog(log) {
  const time =
    log.time
      ? new Date(
          log.time
        ).toLocaleString()
      : "未知時間";

  let dataText = "";

  if (
    log.data !== null &&
    log.data !== undefined
  ) {
    try {
      dataText =
        "\n" +
        JSON.stringify(
          log.data,
          null,
          2
        );
    } catch (error) {
      dataText =
        `\n${String(
          log.data
        )}`;
    }
  }

  return (
    [
      `[${time}]`,
      `[${log.level || "INFO"}]`,
      `[${log.source || "unknown"}]`,
      log.message || ""
    ].join(" ") +
    dataText
  );
}

async function clearLogs() {
  await chrome.storage.local.set({
    [LOG_STORAGE_KEY]: []
  });

  await loadLogs();

  showSaveMessage(
    "Log 已清除"
  );
}

function showSaveMessage(
  message,
  isError = false
) {
  saveStatus.textContent =
    message;

  saveStatus.style.color =
    isError
      ? "#b00020"
      : "#008000";

  setTimeout(() => {
    saveStatus.textContent =
      "";
  }, 1500);
}

enabledToggle.addEventListener(
  "change",
  setEnabled
);

saveButton.addEventListener(
  "click",
  saveSettings
);

refreshButton.addEventListener(
  "click",
  () => {
    requestStatus();

    showSaveMessage(
      "已重新偵測"
    );
  }
);

refreshLogsButton.addEventListener(
  "click",
  loadLogs
);

clearLogsButton.addEventListener(
  "click",
  clearLogs
);

window.addEventListener(
  "unload",
  () => {
    if (refreshTimer) {
      clearInterval(
        refreshTimer
      );

      refreshTimer = null;
    }
  }
);