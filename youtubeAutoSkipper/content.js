(() => {
  const DEFAULT_SETTINGS = {
    enabled: true
  };

  let settings = { ...DEFAULT_SETTINGS };
  let observer = null;
  let rafId = null;
  let lastClickAt = 0;
  let skipCount = 0;

  let status = {
    enabled: true,
    isYouTube: true,
    hasPlayer: false,
    isAdPlaying: false,
    foundSkipButton: false,
    canSkip: false,
    skipButtonText: "",
    skipCount: 0,
    lastAction: "尚未偵測",
    lastSkipAt: "",
    lastCheckedAt: "",
    lastError: ""
  };

  function init() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      settings = result;
      status.enabled = settings.enabled;
      attachObserver();
      scheduleCheck();
    });
  }

  function attachObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const player = document.querySelector("#movie_player");

    if (!player) {
      updateStatus({
        hasPlayer: false,
        lastAction: "尚未找到播放器"
      });

      setTimeout(attachObserver, 1000);
      return;
    }

    observer = new MutationObserver(() => {
      scheduleCheck();
    });

    observer.observe(player, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-label", "title", "disabled", "id"]
    });

    updateStatus({
      hasPlayer: true,
      lastAction: "已找到播放器"
    });
  }

  function scheduleCheck() {
    if (rafId) return;

    rafId = requestAnimationFrame(() => {
      rafId = null;
      checkAd();
    });
  }

  function checkAd() {
    const player = document.querySelector("#movie_player");
    const skipButton = findSkipButton();
    const isAdPlaying = detectAdPlaying(player, skipButton);
    const foundSkipButton = Boolean(skipButton);
    const canSkip = foundSkipButton && isClickable(skipButton);
    const skipButtonText = skipButton ? getText(skipButton) : "";

    updateStatus({
      enabled: settings.enabled,
      isYouTube: location.hostname.includes("youtube.com"),
      hasPlayer: Boolean(player),
      isAdPlaying,
      foundSkipButton,
      canSkip,
      skipButtonText,
      skipCount,
      lastCheckedAt: new Date().toLocaleTimeString(),
      lastAction: getActionText(isAdPlaying, foundSkipButton, canSkip)
    });

    if (!settings.enabled) return;
    if (!isAdPlaying) return;
    if (!canSkip || !skipButton) return;

    const now = Date.now();

    if (now - lastClickAt < 2000) return;

    lastClickAt = now;

    skipByDebugger(skipButton);
  }

  function detectAdPlaying(player, skipButton) {
    if (skipButton) return true;

    if (!player) return false;

    return (
      player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting")
    );
  }

  function findSkipButton() {
    const candidates = [
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll("tp-yt-paper-button"),
      ...document.querySelectorAll("[id*='skip-button']"),
      ...document.querySelectorAll("[class*='ytp-ad-skip']")
    ];

    for (const element of candidates) {
      if (!isVisible(element)) continue;
      if (!isClickable(element)) continue;

      const id = element.id || "";
      const className = String(element.className || "");
      const text = getText(element).toLowerCase();

      const matchedById = id.includes("skip-button");
      const matchedByClass = className.includes("ytp-ad-skip");
      const matchedByText =
        text.includes("skip ad") ||
        text.includes("skip ads") ||
        text.includes("略過廣告") ||
        text.includes("略過這則廣告") ||
        text.includes("跳過廣告");

      if (matchedById || matchedByClass || matchedByText) {
        return element;
      }
    }

    return null;
  }

  function skipByDebugger(button) {
    const rect = button.getBoundingClientRect();

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    chrome.runtime.sendMessage(
      {
        type: "SKIP_AD_BY_DEBUGGER",
        x,
        y
      },
      (response) => {
        if (chrome.runtime.lastError) {
          updateStatus({
            lastAction: "Debugger 點擊失敗",
            lastError: chrome.runtime.lastError.message
          });
          return;
        }

        if (!response || !response.success) {
          updateStatus({
            lastAction: "Debugger 點擊失敗",
            lastError: response ? response.message : "無回應"
          });
          return;
        }

        skipCount++;

        updateStatus({
          skipCount,
          lastAction: "已使用 Debugger 自動略過廣告",
          lastSkipAt: new Date().toLocaleTimeString(),
          lastError: ""
        });

        showNotice("已自動略過廣告");
      }
    );
  }

  function getText(element) {
    return [
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  }

  function isClickable(element) {
    const style = window.getComputedStyle(element);

    return (
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true" &&
      style.pointerEvents !== "none"
    );
  }

  function getActionText(isAdPlaying, foundSkipButton, canSkip) {
    if (!settings.enabled) return "功能已停用";
    if (!isAdPlaying) return "目前沒有偵測到廣告";
    if (isAdPlaying && !foundSkipButton) return "廣告播放中，但尚未出現略過按鈕";
    if (foundSkipButton && !canSkip) return "找到略過按鈕，但不可點擊";
    if (foundSkipButton && canSkip) return "找到可略過按鈕，準備使用 Debugger 點擊";
    return "偵測中";
  }

  function updateStatus(partial) {
    status = {
      ...status,
      ...partial
    };
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
      scheduleCheck();

      setTimeout(() => {
        sendResponse(status);
      }, 80);

      return true;
    }

    if (message.type === "SET_ENABLED") {
      settings.enabled = Boolean(message.enabled);
      status.enabled = settings.enabled;

      chrome.storage.sync.set({ enabled: settings.enabled }, () => {
        scheduleCheck();

        setTimeout(() => {
          sendResponse(status);
        }, 80);
      });

      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    if (changes.enabled) {
      settings.enabled = changes.enabled.newValue;
      status.enabled = settings.enabled;
      scheduleCheck();
    }
  });

  window.addEventListener("yt-navigate-finish", () => {
    attachObserver();
    scheduleCheck();
  });

  init();
})();