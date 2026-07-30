"use strict";

const DEBUGGER_VERSION = "1.3";
const DEFAULT_SETTINGS = { enabled: true, checkIntervalMs: 1000 };
const LOG_STORAGE_KEY = "youtubeAutoSkipperLogs";
const STATUS_STORAGE_KEY = "youtubeAutoSkipperStatus";
const MAX_LOG_COUNT = 300;

const SKIP_SELECTORS = [
  ".ytp-ad-skip-button-modern",
  ".ytp-ad-skip-button",
  ".ytp-skip-ad-button",
  "button.ytp-ad-skip-button-modern",
  "button.ytp-ad-skip-button",
  "button.ytp-skip-ad-button"
];

const CLOSE_SELECTORS = [
  ".ytp-ad-overlay-close-button",
  ".ytp-ad-overlay-close-container button"
];

const sessions = new Map();
const processingTabs = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set(current);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  processingTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && isYouTubeUrl(tab.url)) {
    const session = getSession(tabId);
    updateSession(session, {
      hasPlayer: false,
      isAdPlaying: false,
      foundSkipButton: false,
      canSkip: false,
      lastAction: "YouTube 頁面載入中",
      lastError: ""
    });
    persistStatus().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const senderTabId = sender.tab?.id;
    const requestedTabId = Number(message?.tabId);
    const tabId = Number.isInteger(senderTabId) ? senderTabId : requestedTabId;

    switch (message?.type) {
      case "PAGE_STATE": {
        if (!Number.isInteger(tabId)) return sendResponse({ success: false });
        const session = getSession(tabId);
        updateSession(session, {
          hasPlayer: Boolean(message.hasPlayer),
          isAdPlaying: Boolean(message.isAdPlaying),
          foundSkipButton: Boolean(message.foundSkipButton),
          canSkip: Boolean(message.foundSkipButton),
          skipButtonText: message.skipButtonText || "",
          matchedSelector: message.matchedSelector || "",
          pageVisibility: message.pageVisibility || "unknown",
          lastCheckedAt: new Date().toISOString(),
          lastAction: message.foundSkipButton
            ? "偵測到略過按鈕，準備使用短暫 CDP 點擊"
            : (message.isAdPlaying ? "廣告播放中，等待略過按鈕" : "目前沒有可略過廣告"),
          lastError: ""
        });
        await persistStatus();
        return sendResponse({ success: true });
      }

      case "SKIP_CANDIDATE": {
        if (!Number.isInteger(tabId)) return sendResponse({ success: false });
        const result = await clickCandidateWithTransientCdp(tabId, false);
        return sendResponse({ success: true, result });
      }

      case "OVERLAY_CANDIDATE": {
        if (!Number.isInteger(tabId)) return sendResponse({ success: false });
        const result = await clickCandidateWithTransientCdp(tabId, true);
        return sendResponse({ success: true, result });
      }

      case "GET_TAB_STATUS":
        return sendResponse(await getPublicStatus(requestedTabId));

      case "FORCE_SCAN": {
        const result = await clickCandidateWithTransientCdp(requestedTabId, false, true);
        return sendResponse({ success: true, result, status: await getPublicStatus(requestedTabId) });
      }

      case "SETTINGS_UPDATED": {
        const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://youtube.com/*"] });
        await Promise.allSettled(
          tabs.filter((tab) => Number.isInteger(tab.id))
            .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED" }))
        );
        return sendResponse({ success: true });
      }

      case "CLEAR_LOGS":
        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: [] });
        return sendResponse({ success: true });

      default:
        return sendResponse({ success: false, message: "未知訊息" });
    }
  })().catch((error) => {
    sendResponse({ success: false, message: error?.message || String(error) });
  });

  return true;
});

function getSession(tabId) {
  let session = sessions.get(tabId);
  if (!session) {
    session = {
      tabId,
      skipCount: 0,
      hasPlayer: false,
      isAdPlaying: false,
      foundSkipButton: false,
      canSkip: false,
      skipButtonText: "",
      matchedSelector: "",
      pageVisibility: "unknown",
      lastAction: "等待頁面偵測",
      lastError: "",
      lastSkipAt: "",
      lastCheckedAt: ""
    };
    sessions.set(tabId, session);
  }
  return session;
}

async function clickCandidateWithTransientCdp(tabId, overlayOnly = false, force = false) {
  if (!Number.isInteger(tabId)) throw new Error("無效的 tabId");
  if (processingTabs.has(tabId)) return { busy: true };

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.enabled && !force) return { disabled: true };

  const tab = await chrome.tabs.get(tabId);
  if (!isYouTubeUrl(tab.url)) return { ignored: true, reason: "not-youtube" };
  if (tab.discarded) {
    const session = getSession(tabId);
    session.lastAction = "分頁已被 Chrome 記憶體節省功能卸載，無法略過";
    session.lastError = "tab.discarded = true";
    await persistStatus();
    return { discarded: true };
  }

  processingTabs.add(tabId);
  const session = getSession(tabId);
  let attachedByUs = false;
  let originalScroll = null;

  try {
    attachedByUs = await attachDebugger(tabId);
    const selectors = overlayOnly ? CLOSE_SELECTORS : SKIP_SELECTORS;

    let found = await findNode(tabId, selectors);
    if (!found) {
      session.lastAction = overlayOnly ? "找不到廣告覆蓋層" : "略過按鈕已消失或尚未出現";
      return { found: false };
    }

    let info = await getNodeInfo(tabId, found.nodeId);
    originalScroll = info.scroll;

    updateSession(session, {
      foundSkipButton: !overlayOnly,
      canSkip: info.clickable,
      skipButtonText: info.text,
      matchedSelector: found.selector,
      lastCheckedAt: new Date().toISOString()
    });

    if (!info.clickable) {
      await scrollNodeIntoView(tabId, found.nodeId);
      await sleep(80);

      // YouTube 可能在捲動或版面切換時重建按鈕，因此重新查詢。
      found = await findNode(tabId, selectors);
      if (!found) {
        session.lastAction = "按鈕移入可見區域時已被頁面重建或移除";
        return { found: false, afterScroll: true };
      }
      info = await getNodeInfo(tabId, found.nodeId);
    }

    if (!info.clickable) {
      session.lastAction = "找到按鈕，但無法取得可點擊的畫面座標";
      return { found: true, clickable: false };
    }

    await dispatchClick(tabId, info.x, info.y);

    if (overlayOnly) {
      session.lastAction = "已關閉廣告覆蓋層";
      await writeLog("INFO", "cdp", "關閉廣告覆蓋層", {
        tabId,
        selector: found.selector,
        backgroundTab: !tab.active
      });
      return { found: true, clicked: true };
    }

    const skipped = await verifyAdEnded(tabId, 1800);
    if (skipped) {
      session.skipCount += 1;
      session.lastSkipAt = new Date().toISOString();
      session.lastAction = tab.active
        ? "已使用短暫 CDP 連線略過廣告"
        : "已在背景分頁使用短暫 CDP 連線略過廣告";
      session.lastError = "";
      session.isAdPlaying = false;
      session.foundSkipButton = false;
      session.canSkip = false;

      await writeLog("INFO", "cdp", "略過廣告成功", {
        tabId,
        selector: found.selector,
        x: info.x,
        y: info.y,
        text: info.text,
        backgroundTab: !tab.active,
        windowId: tab.windowId
      });
    } else {
      session.lastAction = "已送出 CDP 點擊，但廣告仍在播放";
      session.lastError = "CDP 點擊後驗證失敗";
      await writeLog("WARN", "cdp", "略過後驗證失敗", {
        tabId,
        selector: found.selector,
        backgroundTab: !tab.active
      });
    }

    return { found: true, clicked: true, skipped, backgroundTab: !tab.active };
  } catch (error) {
    session.lastError = error?.message || String(error);
    session.lastAction = "CDP 點擊失敗";
    await logError(tabId, "短暫 CDP 操作失敗", error);
    throw error;
  } finally {
    if (originalScroll) {
      await restoreScroll(tabId, originalScroll).catch(() => {});
    }
    await persistStatus();
    if (attachedByUs) await detachDebugger(tabId);
    processingTabs.delete(tabId);
  }
}

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
    await sendCommand(tabId, "DOM.enable");
    await sendCommand(tabId, "Runtime.enable");
    await writeLog("DEBUG", "cdp", "短暫附加 Debugger", { tabId });
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes("Another debugger is already attached") || message.includes("Already attached")) {
      throw new Error("此分頁目前被其他 DevTools 或擴充功能偵錯，無法自動略過");
    }
    throw error;
  }
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    await writeLog("DEBUG", "cdp", "已解除 Debugger", { tabId });
  } catch (_) {}
}

async function findNode(tabId, selectors) {
  const rootResult = await sendCommand(tabId, "DOM.getDocument", { depth: 1, pierce: true });
  const rootNodeId = rootResult.root.nodeId;
  for (const selector of selectors) {
    const result = await sendCommand(tabId, "DOM.querySelector", { nodeId: rootNodeId, selector });
    if (result.nodeId) return { nodeId: result.nodeId, selector };
  }
  return null;
}

async function getNodeInfo(tabId, nodeId) {
  const resolved = await sendCommand(tabId, "DOM.resolveNode", { nodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) {
    return { clickable: false, text: "", x: 0, y: 0, scroll: null };
  }

  const result = await sendCommand(tabId, "Runtime.callFunctionOn", {
    objectId,
    returnByValue: true,
    functionDeclaration: `function () {
      const r = this.getBoundingClientRect();
      const s = getComputedStyle(this);
      const left = Math.max(0, r.left);
      const top = Math.max(0, r.top);
      const right = Math.min(innerWidth, r.right);
      const bottom = Math.min(innerHeight, r.bottom);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      const text = [this.innerText, this.textContent, this.getAttribute('aria-label'), this.getAttribute('title')]
        .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim();
      return {
        text,
        x: left + width / 2,
        y: top + height / 2,
        width,
        height,
        rectWidth: r.width,
        rectHeight: r.height,
        connected: this.isConnected,
        disabled: Boolean(this.disabled) || this.getAttribute('aria-disabled') === 'true',
        visible: s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0,
        scrollX,
        scrollY
      };
    }`
  });

  const value = result.result?.value || {};
  return {
    text: value.text || "",
    x: Number(value.x || 0),
    y: Number(value.y || 0),
    clickable: Boolean(
      value.connected &&
      value.visible &&
      !value.disabled &&
      value.width >= 4 &&
      value.height >= 4
    ),
    existsAndVisible: Boolean(
      value.connected &&
      value.visible &&
      value.rectWidth >= 4 &&
      value.rectHeight >= 4
    ),
    scroll: {
      x: Number(value.scrollX || 0),
      y: Number(value.scrollY || 0)
    }
  };
}

async function scrollNodeIntoView(tabId, nodeId) {
  try {
    await sendCommand(tabId, "DOM.scrollIntoViewIfNeeded", { nodeId });
  } catch (_) {
    const resolved = await sendCommand(tabId, "DOM.resolveNode", { nodeId });
    const objectId = resolved.object?.objectId;
    if (!objectId) return;
    await sendCommand(tabId, "Runtime.callFunctionOn", {
      objectId,
      awaitPromise: true,
      returnByValue: true,
      functionDeclaration: `async function () {
        this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      }`
    });
  }
}

async function restoreScroll(tabId, scroll) {
  await sendCommand(tabId, "Runtime.evaluate", {
    expression: `window.scrollTo(${JSON.stringify(scroll.x)}, ${JSON.stringify(scroll.y)})`,
    returnByValue: true
  });
}

async function nodeHasAnyClass(tabId, nodeId, classNames) {
  const resolved = await sendCommand(tabId, "DOM.resolveNode", { nodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) return false;

  const result = await sendCommand(tabId, "Runtime.callFunctionOn", {
    objectId,
    returnByValue: true,
    arguments: [{ value: classNames }],
    functionDeclaration: "function(names){ return names.some(name => this.classList.contains(name)); }"
  });
  return Boolean(result.result?.value);
}

async function dispatchClick(tabId, x, y) {
  const common = { x, y, button: "left", clickCount: 1 };
  await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...common });
  await sendCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
}

async function verifyAdEnded(tabId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(120);
    try {
      const root = await sendCommand(tabId, "DOM.getDocument", { depth: 1, pierce: true });
      const playerResult = await sendCommand(tabId, "DOM.querySelector", {
        nodeId: root.root.nodeId,
        selector: "#movie_player"
      });

      if (!playerResult.nodeId) return true;
      const adPlaying = await nodeHasAnyClass(tabId, playerResult.nodeId, ["ad-showing", "ad-interrupting"]);
      const skipStillExists = await findNode(tabId, SKIP_SELECTORS);
      if (!adPlaying || !skipStillExists) return true;
    } catch (_) {}
  }
  return false;
}

function sendCommand(tabId, method, commandParams = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, commandParams);
}

async function getPublicStatus(tabId) {
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) {}
  const session = sessions.get(tabId);
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  return {
    enabled: settings.enabled,
    isYouTube: Boolean(tab && isYouTubeUrl(tab.url)),
    discarded: Boolean(tab?.discarded),
    active: Boolean(tab?.active),
    hasPlayer: session?.hasPlayer || false,
    isAdPlaying: session?.isAdPlaying || false,
    foundSkipButton: session?.foundSkipButton || false,
    canSkip: session?.canSkip || false,
    skipButtonText: session?.skipButtonText || "",
    matchedSelector: session?.matchedSelector || "",
    pageVisibility: session?.pageVisibility || "unknown",
    skipCount: session?.skipCount || 0,
    lastAction: session?.lastAction || "等待 YouTube 頁面回報",
    lastError: session?.lastError || "",
    lastSkipAt: session?.lastSkipAt || "",
    lastCheckedAt: session?.lastCheckedAt || ""
  };
}

function isYouTubeUrl(url) {
  return typeof url === "string" && /^https:\/\/(www\.)?youtube\.com\//i.test(url);
}

function updateSession(session, patch) {
  Object.assign(session, patch);
}

async function persistStatus() {
  const data = {};
  for (const [tabId, session] of sessions) {
    data[tabId] = {
      skipCount: session.skipCount,
      lastAction: session.lastAction,
      lastError: session.lastError,
      lastSkipAt: session.lastSkipAt,
      lastCheckedAt: session.lastCheckedAt,
      pageVisibility: session.pageVisibility
    };
  }
  await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: data });
}

async function writeLog(level, source, message, detail = undefined) {
  const stored = await chrome.storage.local.get({ [LOG_STORAGE_KEY]: [] });
  const logs = Array.isArray(stored[LOG_STORAGE_KEY]) ? stored[LOG_STORAGE_KEY] : [];
  logs.push({ time: new Date().toISOString(), level, source, message, detail });
  if (logs.length > MAX_LOG_COUNT) logs.splice(0, logs.length - MAX_LOG_COUNT);
  await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
}

async function logError(tabId, message, error) {
  await writeLog("ERROR", "cdp", message, {
    tabId,
    error: error?.message || String(error),
    stack: error?.stack || ""
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
