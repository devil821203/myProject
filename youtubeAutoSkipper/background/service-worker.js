const DEBUGGER_VERSION = "1.3";

const attachedTabs = new Set();
const processingTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SKIP_YOUTUBE_AD") {
    return false;
  }

  const tabId = sender.tab?.id;

  if (!tabId) {
    sendResponse({
      success: false,
      message: "無法取得 YouTube 分頁 ID"
    });

    return true;
  }

  if (processingTabs.has(tabId)) {
    sendResponse({
      success: false,
      busy: true,
      message: "略過操作執行中"
    });

    return true;
  }

  processingTabs.add(tabId);

  skipYouTubeAd(tabId, message.selector)
    .then(sendResponse)
    .catch((error) => {
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
  const target = { tabId };

  await ensureDebuggerAttached(tabId);

  const buttonInfo = await findSkipButton(target, suppliedSelector);

  if (!buttonInfo.found) {
    return {
      success: false,
      message: buttonInfo.message || "找不到略過廣告按鈕"
    };
  }

  /*
   * 按鈕位於目前 viewport 內時，
   * 使用原本已成功的 Debugger 滑鼠點擊。
   */
  if (buttonInfo.inViewport) {
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

  /*
   * 按鈕位於畫面外時，不再 scrollIntoView。
   * 直接在頁面主要執行環境中對節點送出事件。
   */
  const runtimeResult = await clickOutsideViewport(
    target,
    buttonInfo.selector
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
    message: "已略過畫面外的廣告",
    buttonText: runtimeResult.text || buttonInfo.text || ""
  };
}

/**
 * 在 Chrome 頁面主要執行環境尋找略過按鈕。
 */
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

        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();

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

        const tag =
          element.tagName.toLowerCase();

        const classes =
          Array.from(element.classList)
            .filter(Boolean)
            .slice(0, 5)
            .map((name) => CSS.escape(name));

        if (classes.length > 0) {
          return tag + "." + classes.join(".");
        }

        return tag;
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
          // 忽略無效 selector。
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
        width: rect.width,
        height: rect.height,
        inViewport
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

/**
 * 畫面外按鈕不使用座標。
 *
 * 依序嘗試：
 * 1. pointer 事件
 * 2. mouse 事件
 * 3. 原生 click()
 */
async function clickOutsideViewport(target, selector) {
  const safeSelector = JSON.stringify(selector || "");

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
          // 改用備用搜尋。
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
          ".ytp-ad-skip-button-container button"
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

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      };

      try {
        button.focus({
          preventScroll: true
        });
      } catch (error) {
        button.focus();
      }

      try {
        button.dispatchEvent(
          new PointerEvent(
            "pointerover",
            eventOptions
          )
        );

        button.dispatchEvent(
          new PointerEvent(
            "pointerenter",
            eventOptions
          )
        );

        button.dispatchEvent(
          new PointerEvent(
            "pointerdown",
            eventOptions
          )
        );
      } catch (error) {
        // 某些環境可能不支援 PointerEvent。
      }

      button.dispatchEvent(
        new MouseEvent(
          "mouseover",
          eventOptions
        )
      );

      button.dispatchEvent(
        new MouseEvent(
          "mouseenter",
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
              buttons: 0
            }
          )
        );
      } catch (error) {
        // 忽略。
      }

      button.click();

      return {
        success: true,
        text: getText(button)
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

  await wait(20);

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

  await wait(20);

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

  const target = { tabId };

  try {
    await attachDebugger(target);
    attachedTabs.add(tabId);
  } catch (error) {
    const message = error.message || "";

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
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
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
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
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

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    processingTabs.delete(source.tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  processingTabs.delete(tabId);
});