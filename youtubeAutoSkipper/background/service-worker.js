const DEBUGGER_VERSION = "1.3";
const LOG_STORAGE_KEY = "youtubeAutoSkipperLogs";
const MAX_LOG_COUNT = 300;
const attachedTabs = new Set();
const processingTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLEAR_LOGS") {
    clearLogs().then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, message: error.message || String(error) }));
    return true;
  }

  if (message.type !== "SKIP_YOUTUBE_AD") return false;

  const tabId = sender.tab?.id;
  writeLog("INFO", "background", "收到略過廣告要求", {
    tabId,
    selector: message.selector || "",
    senderUrl: sender.tab?.url || ""
  });

  if (!tabId) {
    sendResponse({ success: false, message: "無法取得 YouTube 分頁 ID" });
    return true;
  }

  if (processingTabs.has(tabId)) {
    sendResponse({ success: false, busy: true, message: "略過操作執行中" });
    return true;
  }

  processingTabs.add(tabId);
  skipYouTubeAd(tabId, message.selector)
    .then(result => {
      writeLog(result.success ? "INFO" : "WARN", "background", "略過操作完成", { tabId, result });
      sendResponse(result);
    })
    .catch(error => {
      writeLog("ERROR", "background", "略過操作發生例外", {
        tabId,
        message: error.message || String(error),
        stack: error.stack || ""
      });
      sendResponse({ success: false, message: error.message || String(error) });
    })
    .finally(() => processingTabs.delete(tabId));

  return true;
});

async function skipYouTubeAd(tabId, suppliedSelector) {
  const target = { tabId };
  await ensureDebuggerAttached(tabId);

  let buttonInfo = await findSkipButton(target, suppliedSelector);
  await writeLog("INFO", "background", "第一次取得按鈕資訊", buttonInfo);

  if (!buttonInfo.found) {
    return { success: false, message: buttonInfo.message || "找不到略過廣告按鈕" };
  }

  if (buttonInfo.canClickVisibleArea) {
    await writeLog("INFO", "background", "使用可見區域座標點擊", {
      x: buttonInfo.visibleX,
      y: buttonInfo.visibleY,
      visibleWidth: buttonInfo.visibleWidth,
      visibleHeight: buttonInfo.visibleHeight
    });

    await dispatchMouseClick(target, buttonInfo.visibleX, buttonInfo.visibleY);
    return verifySkipResult(target, buttonInfo, "debugger-visible-area");
  }

  const movedInfo = await moveButtonIntoViewport(target, suppliedSelector);
  await writeLog("INFO", "background", "捲動後重新取得按鈕資訊", movedInfo);

  if (!movedInfo.found) {
    return { success: false, message: movedInfo.message || "捲動後找不到略過按鈕" };
  }

  if (!isViewportCoordinate(movedInfo.x, movedInfo.y, movedInfo.viewportWidth, movedInfo.viewportHeight)) {
    await restoreScrollIfNeeded(target, movedInfo);
    return { success: false, message: "捲動後按鈕座標仍不在可視範圍" };
  }

  await dispatchMouseClick(target, movedInfo.x, movedInfo.y);
  const result = await verifySkipResult(target, movedInfo, "debugger-scroll-and-click");
  await restoreScrollIfNeeded(target, movedInfo);
  return result;
}

function isViewportCoordinate(x, y, width, height) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < width && y < height;
}

async function findSkipButton(target, suppliedSelector) {
  const expression = buildFindButtonExpression(suppliedSelector, false);
  const result = await sendDebuggerCommand(target, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result?.result?.value || { found: false, message: "無法取得略過按鈕資訊" };
}

async function moveButtonIntoViewport(target, suppliedSelector) {
  const expression = buildFindButtonExpression(suppliedSelector, true);
  const result = await sendDebuggerCommand(target, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result?.result?.value || { found: false, message: "無法取得捲動後按鈕資訊" };
}

function buildFindButtonExpression(suppliedSelector, shouldScroll) {
  const safeSelector = JSON.stringify(suppliedSelector || "");
  return `
    (async () => {
      const suppliedSelector = ${safeSelector};
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

      const getText = element => [
        element?.innerText,
        element?.textContent,
        element?.getAttribute?.("aria-label"),
        element?.getAttribute?.("title")
      ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();

      const looksLikeSkip = element => {
        if (!element) return false;
        const id = String(element.id || "").toLowerCase();
        const className = String(element.className || "").toLowerCase();
        const text = getText(element).toLowerCase();
        return id.includes("skip-button") || className.includes("ytp-ad-skip") ||
          className.includes("ytp-skip-ad") || text.includes("skip ad") ||
          text.includes("略過廣告") || text.includes("略過這則廣告") || text.includes("跳過廣告") ||
          text === "略過 略過" || text === "略過";
      };

      const usable = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
          style.visibility !== "hidden" && Number(style.opacity) > 0 && !element.disabled &&
          element.getAttribute("aria-disabled") !== "true";
      };

      const find = () => {
        if (suppliedSelector) {
          try {
            const candidate = document.querySelector(suppliedSelector);
            if (usable(candidate) && looksLikeSkip(candidate)) return { element: candidate, selector: suppliedSelector };
          } catch (_) {}
        }
        for (const selector of selectors) {
          for (const element of document.querySelectorAll(selector)) {
            if (usable(element) && looksLikeSkip(element)) return { element, selector };
          }
        }
        for (const element of document.querySelectorAll("button, tp-yt-paper-button, [role='button']")) {
          if (usable(element) && looksLikeSkip(element)) return { element, selector: element.id ? "#" + CSS.escape(element.id) : element.tagName.toLowerCase() };
        }
        return null;
      };

      let found = find();
      if (!found) return { found: false, message: "找不到可用的略過按鈕" };

      const originalScrollX = window.scrollX;
      const originalScrollY = window.scrollY;

      if (${shouldScroll ? "true" : "false"}) {
        found.element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        found = find();
        if (!found) return { found: false, message: "捲動後按鈕已消失", originalScrollX, originalScrollY };
      }

      const rect = found.element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const visibleLeft = Math.max(rect.left, 0);
      const visibleTop = Math.max(rect.top, 0);
      const visibleRight = Math.min(rect.right, window.innerWidth);
      const visibleBottom = Math.min(rect.bottom, window.innerHeight);
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const hasVisibleArea = visibleWidth > 0 && visibleHeight > 0;

      return {
        found: true,
        selector: found.selector,
        text: getText(found.element),
        x: centerX,
        y: centerY,
        visibleX: hasVisibleArea ? (visibleLeft + visibleRight) / 2 : null,
        visibleY: hasVisibleArea ? (visibleTop + visibleBottom) / 2 : null,
        visibleWidth,
        visibleHeight,
        canClickVisibleArea: visibleWidth >= 8 && visibleHeight >= 8,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        originalScrollX,
        originalScrollY,
        currentScrollX: window.scrollX,
        currentScrollY: window.scrollY,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus()
      };
    })()
  `;
}

async function verifySkipResult(target, buttonInfo, method) {
  await wait(500);
  const result = await sendDebuggerCommand(target, "Runtime.evaluate", {
    expression: `
      (() => {
        const player = document.querySelector("#movie_player");
        const button = document.querySelector("button[id*='skip-button'], [id*='skip-button'], .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button");
        const isAdPlaying = Boolean(player) && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"));
        return { isAdPlaying, buttonStillExists: Boolean(button), playerClasses: player?.className || "" };
      })()
    `,
    returnByValue: true
  });

  const verification = result?.result?.value || {};
  await writeLog(verification.isAdPlaying ? "WARN" : "INFO", "background", "點擊後驗證結果", verification);

  if (verification.isAdPlaying && verification.buttonStillExists) {
    return {
      success: false,
      method,
      message: "已送出滑鼠點擊，但 YouTube 未略過廣告",
      buttonText: buttonInfo.text || "",
      verification
    };
  }

  return {
    success: true,
    method,
    message: "已確認廣告被略過",
    buttonText: buttonInfo.text || "",
    verification
  };
}

async function restoreScrollIfNeeded(target, info) {
  if (!Number.isFinite(info.originalScrollX) || !Number.isFinite(info.originalScrollY)) return;
  await sendDebuggerCommand(target, "Runtime.evaluate", {
    expression: `window.scrollTo({ left: ${info.originalScrollX}, top: ${info.originalScrollY}, behavior: "instant" });`
  });
}

async function dispatchMouseClick(target, x, y) {
  await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseMoved", x, y, button: "none", pointerType: "mouse"
  });
  await wait(40);
  await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse"
  });
  await wait(40);
  await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse"
  });
}

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  const target = { tabId };
  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(target, DEBUGGER_VERSION, () => {
        const error = chrome.runtime.lastError;
        error ? reject(new Error(error.message)) : resolve();
      });
    });
    attachedTabs.add(tabId);
  } catch (error) {
    const message = error.message || "";
    if (message.includes("Already attached") || message.includes("Another debugger is already attached")) {
      attachedTabs.add(tabId);
      return;
    }
    throw error;
  }
}

function sendDebuggerCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, result => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(result);
    });
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeLog(level, source, message, data = null) {
  const logItem = { time: new Date().toISOString(), level, source, message, data };
  const consoleMethod = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleMethod(`[YouTube Auto Skipper][${source}][${level}]`, message, data ?? "");
  try {
    const result = await chrome.storage.local.get(LOG_STORAGE_KEY);
    const logs = Array.isArray(result[LOG_STORAGE_KEY]) ? result[LOG_STORAGE_KEY] : [];
    logs.push(logItem);
    if (logs.length > MAX_LOG_COUNT) logs.splice(0, logs.length - MAX_LOG_COUNT);
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
  } catch (error) {
    console.error("寫入擴充功能 Log 失敗", error);
  }
}

async function clearLogs() {
  await chrome.storage.local.set({ [LOG_STORAGE_KEY]: [] });
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source.tabId) return;
  attachedTabs.delete(source.tabId);
  processingTabs.delete(source.tabId);
  writeLog("WARN", "background", "Debugger 已中斷", { tabId: source.tabId, reason });
});

chrome.tabs.onRemoved.addListener(tabId => {
  attachedTabs.delete(tabId);
  processingTabs.delete(tabId);
});
