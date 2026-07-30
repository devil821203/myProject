"use strict";

const DEBUGGER_VERSION = "1.3";
const DEFAULT_SETTINGS = { enabled: true, checkIntervalMs: 500 };
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id ?? Number(message?.tabId);
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
          lastCheckedAt: new Date().toISOString(),
          lastAction: message.foundSkipButton
            ? "偵測到略過按鈕，準備使用 CDP 點擊"
            : (message.isAdPlaying ? "廣告播放中，等待略過按鈕" : "目前沒有可略過廣告"),
          lastError: ""
        });
        await persistStatus();
        sendResponse({ success: true });
        break;
      }
      case "SKIP_CANDIDATE": {
        if (!Number.isInteger(tabId)) return sendResponse({ success: false });
        const result = await clickCandidateWithTransientCdp(tabId, false);
        sendResponse({ success: true, result });
        break;
      }
      case "OVERLAY_CANDIDATE": {
        if (!Number.isInteger(tabId)) return sendResponse({ success: false });
        const result = await clickCandidateWithTransientCdp(tabId, true);
        sendResponse({ success: true, result });
        break;
      }
      case "GET_TAB_STATUS": {
        sendResponse(await getPublicStatus(Number(message.tabId)));
        break;
      }
      case "FORCE_SCAN": {
        const forcedTabId = Number(message.tabId);
        const result = await clickCandidateWithTransientCdp(forcedTabId, false, true);
        sendResponse({ success: true, result, status: await getPublicStatus(forcedTabId) });
        break;
      }
      case "SETTINGS_UPDATED": {
        const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://youtube.com/*"] });
        await Promise.allSettled(tabs.filter(t => t.id).map(t => chrome.tabs.sendMessage(t.id, { type: "SETTINGS_UPDATED" })));
        sendResponse({ success: true });
        break;
      }
      case "CLEAR_LOGS": {
        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: [] });
        sendResponse({ success: true });
        break;
      }
      default:
        sendResponse({ success: false, message: "未知訊息" });
    }
  })().catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
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

  processingTabs.add(tabId);
  const session = getSession(tabId);
  let attachedByUs = false;
  try {
    attachedByUs = await attachDebugger(tabId);
    const root = await getDocumentRoot(tabId);
    const selectors = overlayOnly ? CLOSE_SELECTORS : SKIP_SELECTORS;
    const found = await queryFirstWithSelector(tabId, root.nodeId, selectors);

    if (!found) {
      session.lastAction = overlayOnly ? "找不到廣告覆蓋層" : "略過按鈕已消失或尚未出現";
      return { found: false };
    }

    const info = await getNodeInfo(tabId, found.nodeId);
    updateSession(session, {
      foundSkipButton: !overlayOnly,
      canSkip: info.clickable,
      skipButtonText: info.text,
      matchedSelector: found.selector,
      lastCheckedAt: new Date().toISOString()
    });

    if (!info.clickable) {
      session.lastAction = "找到按鈕，但目前不在可點擊區域";
      return { found: true, clickable: false };
    }

    await dispatchClick(tabId, info.x, info.y);

    if (overlayOnly) {
      session.lastAction = "已關閉廣告覆蓋層";
      await writeLog("INFO", "cdp", "關閉廣告覆蓋層", { tabId, selector: found.selector });
      return { found: true, clicked: true };
    }

    const skipped = await verifyAdEnded(tabId, 1200);
    if (skipped) {
      session.skipCount += 1;
      session.lastSkipAt = new Date().toISOString();
      session.lastAction = "已使用短暫 CDP 連線略過廣告";
      session.lastError = "";
      await writeLog("INFO", "cdp", "略過廣告成功", {
        tabId, selector: found.selector, x: info.x, y: info.y, text: info.text
      });
    } else {
      session.lastAction = "已送出 CDP 點擊，但廣告仍在播放";
      session.lastError = "CDP 點擊後驗證失敗";
      await writeLog("WARN", "cdp", "略過後驗證失敗", { tabId, selector: found.selector });
    }
    return { found: true, clicked: true, skipped };
  } catch (error) {
    session.lastError = error?.message || String(error);
    session.lastAction = "CDP 點擊失敗";
    await logError(tabId, "短暫 CDP 操作失敗", error);
    throw error;
  } finally {
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

async function getDocumentRoot(tabId) {
  const result = await sendCommand(tabId, "DOM.getDocument", { depth: 1, pierce: true });
  return result.root;
}

async function queryFirst(tabId, rootNodeId, selectors) {
  const found = await queryFirstWithSelector(tabId, rootNodeId, selectors);
  return found?.nodeId || 0;
}

async function queryFirstWithSelector(tabId, rootNodeId, selectors) {
  for (const selector of selectors) {
    const result = await sendCommand(tabId, "DOM.querySelector", { nodeId: rootNodeId, selector });
    if (result.nodeId) return { nodeId: result.nodeId, selector };
  }
  return null;
}

async function getNodeInfo(tabId, nodeId) {
  const resolved = await sendCommand(tabId, "DOM.resolveNode", { nodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) return { clickable: false, text: "", x: 0, y: 0 };

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
        connected: this.isConnected,
        disabled: Boolean(this.disabled) || this.getAttribute('aria-disabled') === 'true',
        visible: s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0
      };
    }`
  });

  const value = result.result?.value || {};
  return {
    text: value.text || "",
    x: Number(value.x || 0),
    y: Number(value.y || 0),
    clickable: Boolean(value.connected && value.visible && !value.disabled && value.width >= 4 && value.height >= 4)
  };
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
      const root = await getDocumentRoot(tabId);
      const playerNodeId = await queryFirst(tabId, root.nodeId, ["#movie_player"]);
      if (!playerNodeId) return true;
      const adPlaying = await nodeHasAnyClass(tabId, playerNodeId, ["ad-showing", "ad-interrupting"]);
      const skipStillExists = await queryFirst(tabId, root.nodeId, SKIP_SELECTORS);
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
    hasPlayer: session?.hasPlayer || false,
    isAdPlaying: session?.isAdPlaying || false,
    foundSkipButton: session?.foundSkipButton || false,
    canSkip: session?.canSkip || false,
    skipButtonText: session?.skipButtonText || "",
    matchedSelector: session?.matchedSelector || "",
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

function updateSession(session, patch) { Object.assign(session, patch); }

async function persistStatus() {
  const data = {};
  for (const [tabId, session] of sessions) {
    data[tabId] = {
      skipCount: session.skipCount,
      lastAction: session.lastAction,
      lastError: session.lastError,
      lastSkipAt: session.lastSkipAt,
      lastCheckedAt: session.lastCheckedAt
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
  await writeLog("ERROR", "cdp", message, { tabId, error: error?.message || String(error), stack: error?.stack || "" });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
