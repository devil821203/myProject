(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    checkIntervalMs: 300
  };

  let settings = { ...DEFAULT_SETTINGS };
  let timerId = null;

  let status = {
    enabled: true,
    isYouTube: true,
    isAdPlaying: false,
    canSkip: false,
    lastAction: "尚未偵測",
    lastCheckedAt: null
  };

  const SKIP_BUTTON_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button",
    "button[class*='ytp-ad-skip']"
  ];

  const AD_INDICATOR_SELECTORS = [
    ".ad-showing",
    ".ytp-ad-player-overlay",
    ".ytp-ad-text",
    ".ytp-ad-preview-container",
    ".ytp-ad-simple-ad-badge",
    ".ytp-ad-module"
  ];

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      settings = result;
      status.enabled = settings.enabled;
      restartChecker();
    });
  }

  function restartChecker() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }

    timerId = setInterval(checkAndSkipAd, settings.checkIntervalMs);
    checkAndSkipAd();
  }

  function checkAndSkipAd() {
    const isAdPlaying = detectAdPlaying();
    const skipButton = findSkipButton();
    const canSkip = Boolean(skipButton);

    status = {
      enabled: settings.enabled,
      isYouTube: location.hostname.includes("youtube.com"),
      isAdPlaying,
      canSkip,
      lastAction: getStatusText(isAdPlaying, canSkip),
      lastCheckedAt: new Date().toLocaleTimeString()
    };

    if (!settings.enabled) {
      status.lastAction = "功能已停用";
      return;
    }

    if (isAdPlaying && canSkip && skipButton) {
      skipButton.click();

      status.lastAction = "已自動略過廣告";
      status.canSkip = false;

      showNotice("已自動略過廣告");
    }
  }

  function detectAdPlaying() {
    const moviePlayer = document.querySelector("#movie_player");

    if (moviePlayer && moviePlayer.classList.contains("ad-showing")) {
      return true;
    }

    return AD_INDICATOR_SELECTORS.some((selector) => {
      const element = document.querySelector(selector);
      return element && isVisible(element);
    });
  }

  function findSkipButton() {
    for (const selector of SKIP_BUTTON_SELECTORS) {
      const buttons = document.querySelectorAll(selector);

      for (const button of buttons) {
        if (isVisible(button) && isClickable(button)) {
          const text = button.innerText || button.textContent || "";
          const aria = button.getAttribute("aria-label") || "";

          if (
            text.includes("略過") ||
            text.toLowerCase().includes("skip") ||
            aria.includes("略過") ||
            aria.toLowerCase().includes("skip")
          ) {
            return button;
          }
        }
      }
    }

    return null;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function isClickable(element) {
    return !element.disabled && element.getAttribute("aria-disabled") !== "true";
  }

  function getStatusText(isAdPlaying, canSkip) {
    if (!settings.enabled) return "功能已停用";
    if (isAdPlaying && canSkip) return "廣告可略過";
    if (isAdPlaying && !canSkip) return "廣告播放中，尚不可略過";
    return "目前沒有偵測到廣告";
  }

  function showNotice(message) {
    let notice = document.getElementById("yt-auto-skipper-notice");

    if (!notice) {
      notice = document.createElement("div");
      notice.id = "yt-auto-skipper-notice";
      document.body.appendChild(notice);
    }

    notice.textContent = message;
    notice.classList.add("show");

    setTimeout(() => {
      notice.classList.remove("show");
    }, 1200);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
      checkAndSkipAd();
      sendResponse(status);
      return true;
    }

    if (message.type === "SET_ENABLED") {
      settings.enabled = message.enabled;
      status.enabled = message.enabled;

      chrome.storage.sync.set({ enabled: message.enabled }, () => {
        checkAndSkipAd();
        sendResponse(status);
      });

      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    if (changes.enabled) {
      settings.enabled = changes.enabled.newValue;
      status.enabled = settings.enabled;
    }

    if (changes.checkIntervalMs) {
      settings.checkIntervalMs = changes.checkIntervalMs.newValue;
    }

    restartChecker();
  });

  const observer = new MutationObserver(() => {
    checkAndSkipAd();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-label", "disabled"]
  });

  loadSettings();
})();