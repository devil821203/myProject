const DEBUGGER_VERSION = "1.3";

/**
 * 紀錄目前已附加 Debugger 的分頁。
 */
const attachedTabs = new Set();

/**
 * 避免同一分頁同時進行多次點擊。
 */
const clickingTabs = new Set();

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

  if (clickingTabs.has(tabId)) {
    sendResponse({
      success: false,
      busy: true,
      message: "正在執行略過操作"
    });

    return true;
  }

  clickingTabs.add(tabId);

  skipYouTubeAd(tabId, message.selector)
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      sendResponse({
        success: false,
        message: error.message || String(error)
      });
    })
    .finally(() => {
      clickingTabs.delete(tabId);
    });

  return true;
});

/**
 * 使用 Debugger API：
 *
 * 1. 附加 debugger。
 * 2. 在 YouTube 頁面中尋找略過按鈕。
 * 3. 保存目前捲動位置。
 * 4. 將略過按鈕捲入畫面。
 * 5. 重新取得按鈕位置。
 * 6. 使用 Input.dispatchMouseEvent 點擊。
 * 7. 恢復原本捲動位置。
 */
async function skipYouTubeAd(tabId, selector) {
  const target = { tabId };

  await ensureDebuggerAttached(tabId);

  const buttonInfo = await findAndPrepareButton(target, selector);

  if (!buttonInfo.found) {
    return {
      success: false,
      message: buttonInfo.message || "找不到略過廣告按鈕"
    };
  }

  if (
    !Number.isFinite(buttonInfo.x) ||
    !Number.isFinite(buttonInfo.y)
  ) {
    return {
      success: false,
      message: "略過按鈕座標無效"
    };
  }

  await dispatchMouseClick(target, buttonInfo.x, buttonInfo.y);

  await wait(100);

  await restoreScrollPosition(
    target,
    buttonInfo.scrollX,
    buttonInfo.scrollY
  );

  return {
    success: true,
    message: "已送出 Debugger 點擊",
    buttonText: buttonInfo.text || "",
    selector: buttonInfo.selector || ""
  };
}

/**
 * 在頁面主要執行環境中尋找按鈕。
 *
 * 先使用 Content Script 傳來的 selector，
 * 找不到時再透過常見 selector 和按鈕文字搜尋。
 */
async function findAndPrepareButton(target, selector) {
  const safeSelector = JSON.stringify(selector || "");

  const expression = `
    (() => {
      const suppliedSelector = ${safeSelector};

      const getElementText = (element) => {
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

      const isUsable = (element) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
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

      const isSkipButton = (element) => {
        if (!element) {
          return false;
        }

        const id = String(element.id || "").toLowerCase();
        const className = String(element.className || "").toLowerCase();
        const text = getElementText(element).toLowerCase();

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
      let matchedSelector = "";

      if (suppliedSelector) {
        try {
          const selectedElement = document.querySelector(suppliedSelector);

          if (isUsable(selectedElement) && isSkipButton(selectedElement)) {
            button = selectedElement;
            matchedSelector = suppliedSelector;
          }
        } catch (error) {
          // selector 無效時改用備用搜尋。
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

        for (const currentSelector of selectors) {
          const elements = document.querySelectorAll(currentSelector);

          for (const element of elements) {
            if (isUsable(element) && isSkipButton(element)) {
              button = element;
              matchedSelector = currentSelector;
              break;
            }
          }

          if (button) {
            break;
          }
        }
      }

      if (!button) {
        const candidates = document.querySelectorAll(
          "button, tp-yt-paper-button, [role='button']"
        );

        for (const element of candidates) {
          if (isUsable(element) && isSkipButton(element)) {
            button = element;
            matchedSelector = "文字或屬性搜尋";
            break;
          }
        }
      }

      if (!button) {
        return {
          found: false,
          message: "Debugger 頁面環境找不到略過廣告按鈕"
        };
      }

      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      button.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant"
      });

      const rect = button.getBoundingClientRect();

      return {
        found: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        scrollX,
        scrollY,
        text: getElementText(button),
        selector: matchedSelector
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

  const value = result?.result?.value;

  if (!value) {
    return {
      found: false,
      message: "無法取得略過按鈕資訊"
    };
  }

  return value;
}

/**
 * 發送接近真實滑鼠操作的事件。
 */
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

/**
 * 點擊後恢復使用者原本的頁面位置。
 */
async function restoreScrollPosition(target, scrollX, scrollY) {
  if (
    !Number.isFinite(scrollX) ||
    !Number.isFinite(scrollY)
  ) {
    return;
  }

  const expression = `
    window.scrollTo({
      left: ${scrollX},
      top: ${scrollY},
      behavior: "instant"
    });
  `;

  try {
    await sendDebuggerCommand(
      target,
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true
      }
    );
  } catch (error) {
    console.warn("無法恢復頁面捲動位置：", error);
  }
}

/**
 * 確認 Debugger 已附加到指定分頁。
 */
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
      message.includes("Another debugger is already attached") ||
      message.includes("Already attached")
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

function sendDebuggerCommand(target, method, params = {}) {
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

/**
 * Debugger 被 Chrome、使用者或其他工具中斷時清除紀錄。
 */
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    clickingTabs.delete(source.tabId);
  }
});

/**
 * 分頁關閉時清除紀錄。
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  clickingTabs.delete(tabId);
});