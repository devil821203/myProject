(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    checkIntervalMs: 500
  };

  const LOG_STORAGE_KEY =
    "youtubeAutoSkipperLogs";

  const MAX_LOG_COUNT = 300;
  const MIN_REQUEST_INTERVAL_MS = 1800;

  let settings = {
    ...DEFAULT_SETTINGS
  };

  let timerId = null;
  let requestInProgress = false;
  let lastRequestAt = 0;
  let previousDebugState = "";

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

        status.enabled =
          settings.enabled;

        writeLog(
          "INFO",
          "Content Script 初始化",
          {
            url: location.href,
            settings
          }
        );

        restartChecker();
        checkAd();
      }
    );
  }

  function restartChecker() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }

    const interval =
      normalizeInterval(
        settings.checkIntervalMs
      );

    timerId = setInterval(
      checkAd,
      interval
    );

    writeLog(
      "INFO",
      "重新啟動偵測計時器",
      {
        interval
      }
    );
  }

  function checkAd() {
    const player =
      document.querySelector(
        "#movie_player"
      );

    const isAdPlaying =
      Boolean(player) &&
      (
        player.classList.contains(
          "ad-showing"
        ) ||
        player.classList.contains(
          "ad-interrupting"
        )
      );

    const buttonResult =
      findSkipButton();

    const foundSkipButton =
      Boolean(buttonResult.element);

    const canSkip =
      foundSkipButton &&
      isClickable(
        buttonResult.element
      );

    updateStatus({
      enabled: settings.enabled,
      isYouTube:
        location.hostname.includes(
          "youtube.com"
        ),
      hasPlayer: Boolean(player),
      isAdPlaying,
      foundSkipButton,
      canSkip,
      skipButtonText:
        buttonResult.text,
      matchedSelector:
        buttonResult.selector,
      lastCheckedAt:
        new Date().toLocaleTimeString(),
      lastAction: getStatusText(
        Boolean(player),
        isAdPlaying,
        foundSkipButton,
        canSkip
      )
    });

    logStateChange(
      player,
      isAdPlaying,
      buttonResult,
      foundSkipButton,
      canSkip
    );

    if (!settings.enabled) {
      return;
    }

    if (!isAdPlaying) {
      return;
    }

    if (
      !foundSkipButton ||
      !canSkip
    ) {
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

  function logStateChange(
    player,
    isAdPlaying,
    buttonResult,
    foundSkipButton,
    canSkip
  ) {
    const currentDebugState =
      JSON.stringify({
        hasPlayer: Boolean(player),
        playerClasses:
          player?.className || "",
        isAdPlaying,
        foundSkipButton,
        canSkip,
        selector:
          buttonResult.selector,
        text:
          buttonResult.text,
        visibilityState:
          document.visibilityState,
        scrollY:
          window.scrollY
      });

    if (
      currentDebugState ===
      previousDebugState
    ) {
      return;
    }

    previousDebugState =
      currentDebugState;

    writeLog(
      "INFO",
      "偵測狀態改變",
      {
        url: location.href,
        visibilityState:
          document.visibilityState,
        hasFocus:
          document.hasFocus(),
        scrollX:
          window.scrollX,
        scrollY:
          window.scrollY,
        viewportWidth:
          window.innerWidth,
        viewportHeight:
          window.innerHeight,
        hasPlayer:
          Boolean(player),
        playerClasses:
          player?.className || "",
        isAdPlaying,
        foundSkipButton,
        canSkip,
        selector:
          buttonResult.selector,
        buttonText:
          buttonResult.text,
        buttonRect:
          buttonResult.element
            ? getRectInfo(
                buttonResult.element
              )
            : null
      }
    );
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

    for (
      const selector of selectors
    ) {
      const elements =
        document.querySelectorAll(
          selector
        );

      for (
        const element of elements
      ) {
        if (
          !isSkipButton(element)
        ) {
          continue;
        }

        if (
          !hasLayout(element)
        ) {
          continue;
        }

        return {
          element,
          selector,
          text:
            getElementText(element)
        };
      }
    }

    const candidates =
      document.querySelectorAll(
        "button, tp-yt-paper-button, [role='button']"
      );

    for (
      const element of candidates
    ) {
      if (
        isSkipButton(element) &&
        hasLayout(element)
      ) {
        return {
          element,
          selector:
            buildSelector(element),
          text:
            getElementText(element)
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
    if (!element) {
      return false;
    }

    const id =
      String(
        element.id || ""
      ).toLowerCase();

    const className =
      String(
        element.className || ""
      ).toLowerCase();

    const text =
      getElementText(
        element
      ).toLowerCase();

    return (
      id.includes(
        "skip-button"
      ) ||
      className.includes(
        "ytp-ad-skip"
      ) ||
      className.includes(
        "ytp-skip-ad"
      ) ||
      text.includes(
        "skip ad"
      ) ||
      text.includes(
        "skip ads"
      ) ||
      text.includes(
        "略過廣告"
      ) ||
      text.includes(
        "略過這則廣告"
      ) ||
      text.includes(
        "跳過廣告"
      )
    );
  }

  function hasLayout(element) {
    if (!element) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    const style =
      window.getComputedStyle(
        element
      );

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  }

  function isClickable(element) {
    if (!element) {
      return false;
    }

    return (
      !element.disabled &&
      element.getAttribute(
        "aria-disabled"
      ) !== "true"
    );
  }

  function getElementText(element) {
    if (!element) {
      return "";
    }

    return [
      element.innerText,
      element.textContent,
      element.getAttribute(
        "aria-label"
      ),
      element.getAttribute(
        "title"
      )
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getRectInfo(element) {
    if (!element) {
      return null;
    }

    const rect =
      element.getBoundingClientRect();

    const style =
      window.getComputedStyle(
        element
      );

    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility:
        style.visibility,
      opacity:
        style.opacity,
      pointerEvents:
        style.pointerEvents,
      inViewport:
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top <
          window.innerHeight &&
        rect.left <
          window.innerWidth
    };
  }

  function buildSelector(element) {
    if (!element) {
      return "";
    }

    if (element.id) {
      return `#${CSS.escape(
        element.id
      )}`;
    }

    const tagName =
      element.tagName.toLowerCase();

    const classes =
      Array.from(
        element.classList
      )
        .filter(Boolean)
        .slice(0, 5)
        .map((className) =>
          CSS.escape(className)
        );

    if (classes.length > 0) {
      return (
        `${tagName}.` +
        classes.join(".")
      );
    }

    return tagName;
  }

  function requestSkip(
    buttonResult
  ) {
    requestInProgress = true;

    const selector =
      buttonResult.selector ||
      buildSelector(
        buttonResult.element
      );

    writeLog(
      "INFO",
      "準備送出略過要求",
      {
        selector,
        text:
          buttonResult.text,
        rect:
          getRectInfo(
            buttonResult.element
          ),
        visibilityState:
          document.visibilityState,
        hasFocus:
          document.hasFocus(),
        scrollX:
          window.scrollX,
        scrollY:
          window.scrollY
      }
    );

    updateStatus({
      lastAction:
        "正在執行略過操作",
      lastError: ""
    });

    chrome.runtime.sendMessage(
      {
        type:
          "SKIP_YOUTUBE_AD",
        selector
      },
      (response) => {
        requestInProgress =
          false;

        if (
          chrome.runtime.lastError
        ) {
          const errorMessage =
            chrome.runtime
              .lastError
              .message;

          writeLog(
            "ERROR",
            "Background 連線失敗",
            {
              message:
                errorMessage
            }
          );

          updateStatus({
            lastAction:
              "Background 連線失敗",
            lastError:
              errorMessage
          });

          return;
        }

        if (!response) {
          writeLog(
            "ERROR",
            "Background 沒有回應"
          );

          updateStatus({
            lastAction:
              "Background 無回應",
            lastError:
              "沒有收到略過結果"
          });

          return;
        }

        writeLog(
          response.success
            ? "INFO"
            : "ERROR",
          "收到 Background 略過結果",
          response
        );

        if (response.busy) {
          return;
        }

        if (!response.success) {
          updateStatus({
            lastAction:
              "略過廣告失敗",
            lastError:
              response.message ||
              "未知錯誤"
          });

          return;
        }

        updateStatus({
          skipCount:
            status.skipCount + 1,
          lastAction:
            response.method ===
            "runtime-event"
              ? "已嘗試略過畫面外廣告"
              : "已使用 Debugger 略過廣告",
          lastSkipAt:
            new Date()
              .toLocaleTimeString(),
          lastError: "",
          lastMethod:
            response.method || ""
        });

        showNotice(
          "已送出自動略過操作"
        );
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

  function normalizeInterval(
    value
  ) {
    const numberValue =
      Number(value);

    if (
      !Number.isFinite(
        numberValue
      )
    ) {
      return DEFAULT_SETTINGS
        .checkIntervalMs;
    }

    return Math.max(
      300,
      Math.floor(numberValue)
    );
  }

  function updateStatus(
    partialStatus
  ) {
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
      notice =
        document.createElement(
          "div"
        );

      notice.id =
        "yt-auto-skipper-notice";

      document.body.appendChild(
        notice
      );
    }

    notice.textContent =
      message;

    notice.classList.add(
      "show"
    );

    setTimeout(() => {
      notice.classList.remove(
        "show"
      );
    }, 1200);
  }

  async function writeLog(
    level,
    message,
    data = null
  ) {
    const logItem = {
      time:
        new Date().toISOString(),
      level,
      source: "content",
      message,
      data
    };

    const consoleMethod =
      level === "ERROR"
        ? console.error
        : level === "WARN"
          ? console.warn
          : console.log;

    consoleMethod(
      `[YouTube Auto Skipper][content][${level}]`,
      message,
      data ?? ""
    );

    try {
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

      logs.push(logItem);

      if (
        logs.length >
        MAX_LOG_COUNT
      ) {
        logs.splice(
          0,
          logs.length -
            MAX_LOG_COUNT
        );
      }

      await chrome.storage.local.set({
        [LOG_STORAGE_KEY]:
          logs
      });
    } catch (error) {
      console.error(
        "寫入 Content Log 失敗",
        error
      );
    }
  }

  chrome.runtime.onMessage.addListener(
    (
      message,
      sender,
      sendResponse
    ) => {
      if (
        message.type ===
        "GET_STATUS"
      ) {
        checkAd();
        sendResponse(status);
        return false;
      }

      if (
        message.type ===
        "SET_ENABLED"
      ) {
        settings.enabled =
          Boolean(
            message.enabled
          );

        status.enabled =
          settings.enabled;

        chrome.storage.sync.set({
          enabled:
            settings.enabled
        });

        writeLog(
          "INFO",
          settings.enabled
            ? "功能已啟用"
            : "功能已停用"
        );

        sendResponse(status);
        return false;
      }

      if (
        message.type ===
        "SET_INTERVAL"
      ) {
        settings.checkIntervalMs =
          normalizeInterval(
            message.checkIntervalMs
          );

        chrome.storage.sync.set({
          checkIntervalMs:
            settings
              .checkIntervalMs
        });

        restartChecker();
        sendResponse(status);

        return false;
      }

      return false;
    }
  );

  chrome.storage.onChanged.addListener(
    (
      changes,
      areaName
    ) => {
      if (
        areaName !== "sync"
      ) {
        return;
      }

      if (changes.enabled) {
        settings.enabled =
          Boolean(
            changes.enabled
              .newValue
          );

        status.enabled =
          settings.enabled;
      }

      if (
        changes
          .checkIntervalMs
      ) {
        settings.checkIntervalMs =
          normalizeInterval(
            changes
              .checkIntervalMs
              .newValue
          );

        restartChecker();
      }
    }
  );

  window.addEventListener(
    "yt-navigate-finish",
    () => {
      writeLog(
        "INFO",
        "偵測到 YouTube 頁面切換",
        {
          url:
            location.href
        }
      );

      setTimeout(
        checkAd,
        300
      );
    }
  );
})();