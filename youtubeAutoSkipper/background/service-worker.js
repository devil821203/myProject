const DEBUGGER_VERSION = "1.3";

const LOG_STORAGE_KEY = "youtubeAutoSkipperLogs";
const MAX_LOG_COUNT = 300;

const attachedTabs = new Set();
const processingTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLEAR_LOGS") {
    clearLogs()
      .then(() => {
        sendResponse({
          success: true
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          message: error.message || String(error)
        });
      });

    return true;
  }

  if (message.type !== "SKIP_YOUTUBE_AD") {
    return false;
  }

  const tabId = sender.tab?.id;

  writeLog(
    "INFO",
    "background",
    "收到略過廣告要求",
    {
      tabId,
      selector: message.selector || "",
      senderUrl: sender.tab?.url || ""
    }
  );

  if (!tabId) {
    writeLog(
      "ERROR",
      "background",
      "無法取得 YouTube 分頁 ID"
    );

    sendResponse({
      success: false,
      message: "無法取得 YouTube 分頁 ID"
    });

    return true;
  }

  if (processingTabs.has(tabId)) {
    writeLog(
      "WARN",
      "background",
      "分頁已有略過操作執行中",
      {
        tabId
      }
    );

    sendResponse({
      success: false,
      busy: true,
      message: "略過操作執行中"
    });

    return true;
  }

  processingTabs.add(tabId);

  skipYouTubeAd(tabId, message.selector)
    .then((result) => {
      writeLog(
        result.success ? "INFO" : "WARN",
        "background",
        "略過操作完成",
        {
          tabId,
          result
        }
      );

      sendResponse(result);
    })
    .catch((error) => {
      writeLog(
        "ERROR",
        "background",
        "略過操作發生例外",
        {
          tabId,
          message: error.message || String(error),
          stack: error.stack || ""
        }
      );

      sendResponse({
        success: false,
        message: error.message || String(error)
      });
    })
    .finally(() => {
      processingTabs.delete(tabId);
    });

  return true;
});

async function skipYouTubeAd(tabId, suppliedSelector) {
  const target = {
    tabId
  };

  await writeLog(
    "INFO",
    "background",
    "準備附加 Debugger",
    {
      tabId,
      suppliedSelector: suppliedSelector || ""
    }
  );

  await ensureDebuggerAttached(tabId);

  await writeLog(
    "INFO",
    "background",
    "Debugger 已附加",
    {
      tabId
    }
  );

  const buttonInfo = await findSkipButton(
    target,
    suppliedSelector
  );

  await writeLog(
    "INFO",
    "background",
    "Debugger 搜尋按鈕結果",
    buttonInfo
  );

  if (!buttonInfo.found) {
    return {
      success: false,
      message:
        buttonInfo.message ||
        "找不到略過廣告按鈕"
    };
  }

  if (buttonInfo.inViewport) {
    await writeLog(
      "INFO",
      "background",
      "按鈕位於畫面內，使用滑鼠座標點擊",
      {
        x: buttonInfo.x,
        y: buttonInfo.y,
        selector: buttonInfo.selector,
        text: buttonInfo.text
      }
    );

    await dispatchMouseClick(
      target,
      buttonInfo.x,
      buttonInfo.y
    );

    return {
      success: true,
      method: "debugger-mouse",
      message: "已使用 Debugger 滑鼠事件略過",
      buttonText: buttonInfo.text || ""
    };
  }

  await writeLog(
    "INFO",
    "background",
    "按鈕位於畫面外，使用 Runtime 點擊",
    {
      selector: buttonInfo.selector,
      text: buttonInfo.text,
      x: buttonInfo.x,
      y: buttonInfo.y
    }
  );

  const runtimeResult = await clickOutsideViewport(
    target,
    buttonInfo.selector
  );

  await writeLog(
    runtimeResult.success ? "INFO" : "ERROR",
    "background",
    "畫面外 Runtime 點擊結果",
    runtimeResult
  );

  if (!runtimeResult.success) {
    return {
      success: false,
      message:
        runtimeResult.message ||
        "畫面外按鈕點擊失敗"
    };
  }

  return {
    success: true,
    method: "runtime-event",
    message: "已嘗試略過畫面外廣告",
    buttonText:
      runtimeResult.text ||
      buttonInfo.text ||
      ""
  };
}

async function findSkipButton(target, suppliedSelector) {
  const safeSelector = JSON.stringify(
    suppliedSelector || ""
  );

  const expression = `
    (() => {
      const suppliedSelector = ${safeSelector};

      const getText = (element) => {
        if (!element) {
          return "";
        }

        return [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
      };

      const isSkipButton = (element) => {
        if (!element) {
          return false;
        }

        const id =
          String(element.id || "").toLowerCase();

        const className =
          String(element.className || "").toLowerCase();

        const text =
          getText(element).toLowerCase();

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
      };

      const isUsable = (element) => {
        if (!element) {
          return false;
        }

        const style =
          window.getComputedStyle(element);

        const rect =
          element.getBoundingClientRect();

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          !element.disabled &&
          element.getAttribute("aria-disabled") !== "true"
        );
      };

      const buildSelector = (element) => {
        if (!element) {
          return "";
        }

        if (element.id) {
          return "#" + CSS.escape(element.id);
        }

        const tagName =
          element.tagName.toLowerCase();

        const classNames =
          Array.from(element.classList)
            .filter(Boolean)
            .slice(0, 5)
            .map((className) => CSS.escape(className));

        if (classNames.length > 0) {
          return (
            tagName +
            "." +
            classNames.join(".")
          );
        }

        return tagName;
      };

      let button = null;
      let matchedSelector = "";

      if (suppliedSelector) {
        try {
          const candidate =
            document.querySelector(suppliedSelector);

          if (
            isUsable(candidate) &&
            isSkipButton(candidate)
          ) {
            button = candidate;
            matchedSelector = suppliedSelector;
          }
        } catch (error) {
        }
      }

      if (!button) {
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
            if (
              isUsable(element) &&
              isSkipButton(element)
            ) {
              button = element;
              matchedSelector = selector;
              break;
            }
          }

          if (button) {
            break;
          }
        }
      }

      if (!button) {
        const candidates =
          document.querySelectorAll(
            "button, tp-yt-paper-button, [role='button']"
          );

        for (const element of candidates) {
          if (
            isUsable(element) &&
            isSkipButton(element)
          ) {
            button = element;
            matchedSelector =
              buildSelector(element);
            break;
          }
        }
      }

      if (!button) {
        return {
          found: false,
          message: "找不到可用的略過按鈕"
        };
      }

      const rect =
        button.getBoundingClientRect();

      const inViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;

      return {
        found: true,
        selector:
          matchedSelector ||
          buildSelector(button),
        text: getText(button),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        inViewport,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus()
      };
    })()
  `;

  const result = await sendDebuggerCommand(
    target,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    }
  );

  return result?.result?.value || {
    found: false,
    message: "無法取得略過按鈕資訊"
  };
}

async function clickOutsideViewport(target, selector) {
  const safeSelector = JSON.stringify(
    selector || ""
  );

  const expression = `
    (() => {
      const suppliedSelector = ${safeSelector};

      const getText = (element) => {
        if (!element) {
          return "";
        }

        return [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
      };

      const isSkipButton = (element) => {
        if (!element) {
          return false;
        }

        const id =
          String(element.id || "").toLowerCase();

        const className =
          String(element.className || "").toLowerCase();

        const text =
          getText(element).toLowerCase();

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
      };

      let button = null;

      if (suppliedSelector) {
        try {
          const candidate =
            document.querySelector(suppliedSelector);

          if (isSkipButton(candidate)) {
            button = candidate;
          }
        } catch (error) {
        }
      }

      if (!button) {
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
            if (isSkipButton(element)) {
              button = element;
              break;
            }
          }

          if (button) {
            break;
          }
        }
      }

      if (!button) {
        const candidates =
          document.querySelectorAll(
            "button, tp-yt-paper-button, [role='button']"
          );

        for (const element of candidates) {
          if (isSkipButton(element)) {
            button = element;
            break;
          }
        }
      }

      if (!button) {
        return {
          success: false,
          message: "執行點擊時按鈕已不存在"
        };
      }

      const text = getText(button);

      const rect =
        button.getBoundingClientRect();

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: 1,
        screenX: 0,
        screenY: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        button: 0,
        buttons: 1,
        relatedTarget: null
      };

      try {
        button.focus({
          preventScroll: true
        });
      } catch (error) {
        try {
          button.focus();
        } catch (focusError) {
        }
      }

      try {
        button.dispatchEvent(
          new PointerEvent(
            "pointerover",
            {
              ...eventOptions,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true
            }
          )
        );

        button.dispatchEvent(
          new PointerEvent(
            "pointerdown",
            {
              ...eventOptions,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true
            }
          )
        );
      } catch (error) {
      }

      button.dispatchEvent(
        new MouseEvent(
          "mouseover",
          eventOptions
        )
      );

      button.dispatchEvent(
        new MouseEvent(
          "mousedown",
          eventOptions
        )
      );

      button.dispatchEvent(
        new MouseEvent(
          "mouseup",
          {
            ...eventOptions,
            buttons: 0
          }
        )
      );

      try {
        button.dispatchEvent(
          new PointerEvent(
            "pointerup",
            {
              ...eventOptions,
              buttons: 0,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true
            }
          )
        );
      } catch (error) {
      }

      button.click();

      return {
        success: true,
        text,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        visibilityState:
          document.visibilityState,
        hasFocus:
          document.hasFocus()
      };
    })()
  `;

  const result = await sendDebuggerCommand(
    target,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    }
  );

  return result?.result?.value || {
    success: false,
    message: "Runtime.evaluate 沒有回傳結果"
  };
}

async function dispatchMouseClick(target, x, y) {
  await sendDebuggerCommand(
    target,
    "Input.dispatchMouseEvent",
    {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      pointerType: "mouse"
    }
  );

  await wait(30);

  await sendDebuggerCommand(
    target,
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse"
    }
  );

  await wait(30);

  await sendDebuggerCommand(
    target,
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse"
    }
  );
}

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) {
    return;
  }

  const target = {
    tabId
  };

  try {
    await attachDebugger(target);
    attachedTabs.add(tabId);
  } catch (error) {
    const message =
      error.message || "";

    if (
      message.includes("Already attached") ||
      message.includes(
        "Another debugger is already attached"
      )
    ) {
      attachedTabs.add(tabId);
      return;
    }

    throw error;
  }
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(
      target,
      DEBUGGER_VERSION,
      () => {
        const error =
          chrome.runtime.lastError;

        if (error) {
          reject(
            new Error(error.message)
          );

          return;
        }

        resolve();
      }
    );
  });
}

function sendDebuggerCommand(
  target,
  method,
  params = {}
) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      target,
      method,
      params,
      (result) => {
        const error =
          chrome.runtime.lastError;

        if (error) {
          reject(
            new Error(error.message)
          );

          return;
        }

        resolve(result);
      }
    );
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function writeLog(
  level,
  source,
  message,
  data = null
) {
  const logItem = {
    time: new Date().toISOString(),
    level,
    source,
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
    `[YouTube Auto Skipper][${source}][${level}]`,
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
        result[LOG_STORAGE_KEY]
      )
        ? result[LOG_STORAGE_KEY]
        : [];

    logs.push(logItem);

    if (logs.length > MAX_LOG_COUNT) {
      logs.splice(
        0,
        logs.length - MAX_LOG_COUNT
      );
    }

    await chrome.storage.local.set({
      [LOG_STORAGE_KEY]: logs
    });
  } catch (error) {
    console.error(
      "寫入擴充功能 Log 失敗",
      error
    );
  }
}

async function clearLogs() {
  await chrome.storage.local.set({
    [LOG_STORAGE_KEY]: []
  });
}

chrome.debugger.onDetach.addListener(
  (source, reason) => {
    if (!source.tabId) {
      return;
    }

    attachedTabs.delete(source.tabId);
    processingTabs.delete(source.tabId);

    writeLog(
      "WARN",
      "background",
      "Debugger 已中斷",
      {
        tabId: source.tabId,
        reason
      }
    );
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  processingTabs.delete(tabId);
});