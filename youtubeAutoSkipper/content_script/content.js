(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    checkIntervalMs: 500
  };

  const MIN_REQUEST_INTERVAL_MS = 1800;

  let settings = { ...DEFAULT_SETTINGS };
  let timerId = null;
  let requestInProgress = false;
  let lastRequestAt = 0;

  let status = {
    enabled: true,
    isYouTube: true,
    hasPlayer: false,
    isAdPlaying: false,
    foundSkipButton: false,
    canSkip: false,
    skipButtonText: "",
    matchedSelector: "",
    skipCount: 0,
    lastAction: "初始化中",
    lastSkipAt: "",
    lastCheckedAt: "",
    lastError: "",
    lastMethod: ""
  };

  initialize();

  function initialize() {
    chrome.storage.sync.get(
      DEFAULT_SETTINGS,
      (storedSettings) => {
        settings = {
          ...DEFAULT_SETTINGS,
          ...storedSettings
        };

        status.enabled = settings.enabled;

        restartChecker();
        checkAd();
      }
    );
  }

  function restartChecker() {
    if (timerId) {
      clearInterval(timerId);
    }

    timerId = setInterval(
      checkAd,
      Math.max(
        300,
        Number(settings.checkIntervalMs) || 500
      )
    );
  }

  function checkAd() {
    const player =
      document.querySelector("#movie_player");

    const isAdPlaying =
      Boolean(player) &&
      (
        player.classList.contains("ad-showing") ||
        player.classList.contains("ad-interrupting")
      );

    const buttonResult = findSkipButton();
    const foundSkipButton =
      Boolean(buttonResult.element);

    const canSkip =
      foundSkipButton &&
      isClickable(buttonResult.element);

    updateStatus({
      enabled: settings.enabled,
      isYouTube:
        location.hostname.includes("youtube.com"),
      hasPlayer: Boolean(player),
      isAdPlaying,
      foundSkipButton,
      canSkip,
      skipButtonText: buttonResult.text,
      matchedSelector: buttonResult.selector,
      lastCheckedAt:
        new Date().toLocaleTimeString(),
      lastAction: getStatusText(
        Boolean(player),
        isAdPlaying,
        foundSkipButton,
        canSkip
      )
    });

    if (!settings.enabled) {
      return;
    }

    if (!isAdPlaying) {
      return;
    }

    if (!foundSkipButton || !canSkip) {
      return;
    }

    if (requestInProgress) {
      return;
    }

    const now = Date.now();

    if (
      now - lastRequestAt <
      MIN_REQUEST_INTERVAL_MS
    ) {
      return;
    }

    lastRequestAt = now;
    requestSkip(buttonResult);
  }

  function findSkipButton() {
    const selectors = [
      "button[id*='skip-button']",
      "[id*='skip-button']",
      "button.ytp-ad-skip-button",
      "button.ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button",
      ".ytp-ad-skip-button-modern",
      ".ytp-skip-ad-button",
      ".ytp-ad-skip-button-container button",
      "button[aria-label*='Skip']",
      "button[aria-label*='skip']",
      "button[aria-label*='略過']",
      "button[aria-label*='跳過']"
    ];

    for (const selector of selectors) {
      const elements =
        document.querySelectorAll(selector);

      for (const element of elements) {
        if (!isSkipButton(element)) {
          continue;
        }

        if (!hasLayout(element)) {
          continue;
        }

        return {
          element,
          selector,
          text: getElementText(element)
        };
      }
    }

    const candidates =
      document.querySelectorAll(
        "button, tp-yt-paper-button, [role='button']"
      );

    for (const element of candidates) {
      if (
        isSkipButton(element) &&
        hasLayout(element)
      ) {
        return {
          element,
          selector: buildSelector(element),
          text: getElementText(element)
        };
      }
    }

    return {
      element: null,
      selector: "",
      text: ""
    };
  }

  function isSkipButton(element) {
    const id =
      String(element.id || "").toLowerCase();

    const className =
      String(element.className || "").toLowerCase();

    const text =
      getElementText(element).toLowerCase();

    return (
      id.includes("skip-button") ||
      className.includes("ytp-ad-skip") ||
      className.includes("ytp-skip-ad") ||
      text.includes("skip ad") ||
      text.includes("skip ads") ||
      text.includes("略過廣告") ||
      text.includes("略過這則廣告") ||
      text.includes("跳過廣告")
    );
  }

  /*
   * 只檢查元素是否有尺寸。
   * 不要求元素位於目前 viewport 內。
   */
  function hasLayout(element) {
    if (!element) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    const style =
      getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  }

  function isClickable(element) {
    return (
      element &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true"
    );
  }

  function getElementText(element) {
    return [
      element?.innerText,
      element?.textContent,
      element?.getAttribute("aria-label"),
      element?.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildSelector(element) {
    if (!element) {
      return "";
    }

    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const tag =
      element.tagName.toLowerCase();

    const classes =
      Array.from(element.classList)
        .filter(Boolean)
        .slice(0, 5)
        .map((name) => CSS.escape(name));

    if (classes.length > 0) {
      return `${tag}.${classes.join(".")}`;
    }

    return tag;
  }

  function requestSkip(buttonResult) {
    requestInProgress = true;

    updateStatus({
      lastAction: "正在執行略過操作",
      lastError: ""
    });

    chrome.runtime.sendMessage(
      {
        type: "SKIP_YOUTUBE_AD",
        selector:
          buttonResult.selector ||
          buildSelector(buttonResult.element)
      },
      (response) => {
        requestInProgress = false;

        if (chrome.runtime.lastError) {
          updateStatus({
            lastAction: "Background 連線失敗",
            lastError:
              chrome.runtime.lastError.message
          });

          return;
        }

        if (!response) {
          updateStatus({
            lastAction: "Background 無回應",
            lastError: "沒有收到略過結果"
          });

          return;
        }

        if (response.busy) {
          return;
        }

        if (!response.success) {
          updateStatus({
            lastAction: "略過廣告失敗",
            lastError:
              response.message || "未知錯誤"
          });

          return;
        }

        updateStatus({
          skipCount: status.skipCount + 1,
          lastAction:
            response.method === "runtime-event"
              ? "已略過畫面外廣告"
              : "已使用 Debugger 略過廣告",
          lastSkipAt:
            new Date().toLocaleTimeString(),
          lastError: "",
          lastMethod: response.method || ""
        });

        showNotice("已自動略過廣告");
      }
    );
  }

  function getStatusText(
    hasPlayer,
    isAdPlaying,
    foundSkipButton,
    canSkip
  ) {
    if (!settings.enabled) {
      return "功能已停用";
    }

    if (!hasPlayer) {
      return "尚未找到播放器";
    }

    if (!isAdPlaying) {
      return "目前沒有偵測到廣告";
    }

    if (!foundSkipButton) {
      return "廣告播放中，尚未出現略過按鈕";
    }

    if (!canSkip) {
      return "找到略過按鈕，但目前不可使用";
    }

    return "已找到可略過按鈕";
  }

  function updateStatus(partialStatus) {
    status = {
      ...status,
      ...partialStatus
    };
  }

  function showNotice(message) {
    let notice =
      document.getElementById(
        "yt-auto-skipper-notice"
      );

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

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.type === "GET_STATUS") {
        checkAd();
        sendResponse(status);
        return false;
      }

      if (message.type === "SET_ENABLED") {
        settings.enabled =
          Boolean(message.enabled);

        status.enabled = settings.enabled;

        chrome.storage.sync.set({
          enabled: settings.enabled
        });

        sendResponse(status);
        return false;
      }

      if (message.type === "SET_INTERVAL") {
        settings.checkIntervalMs =
          Math.max(
            300,
            Number(message.checkIntervalMs) || 500
          );

        chrome.storage.sync.set({
          checkIntervalMs:
            settings.checkIntervalMs
        });

        restartChecker();
        sendResponse(status);
        return false;
      }

      return false;
    }
  );

  chrome.storage.onChanged.addListener(
    (changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      if (changes.enabled) {
        settings.enabled =
          Boolean(changes.enabled.newValue);

        status.enabled = settings.enabled;
      }

      if (changes.checkIntervalMs) {
        settings.checkIntervalMs =
          Math.max(
            300,
            Number(
              changes.checkIntervalMs.newValue
            ) || 500
          );

        restartChecker();
      }
    }
  );

  window.addEventListener(
    "yt-navigate-finish",
    () => {
      setTimeout(checkAd, 300);
    }
  );
})();