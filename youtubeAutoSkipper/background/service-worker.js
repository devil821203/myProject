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
  await chrome.storage.sync.set(await chrome.storage.sync.get(DEFAULT_SETTINGS));
  await scanExistingYouTubeTabs();
});

chrome.runtime.onStartup.addListener(scanExistingYouTubeTabs);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && isYouTubeUrl(tab.url)) {
    startTab(tabId).catch((error) => logError(tabId, "啟動分頁失敗", error));
  }
  if (changeInfo.url && !isYouTubeUrl(changeInfo.url)) {
    stopTab(tabId, "離開 YouTube").catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopTab(tabId, "分頁已關閉").catch(() => {});
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (!tabId) return;
  const session = sessions.get(tabId);
  if (session) {
    session.attached = false;
    session.lastError = `Debugger 已中斷：${reason}`;
  }
  writeLog("WARN", "cdp", "Debugger 已中斷", { tabId, reason });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "GET_TAB_STATUS": {
        const tabId = Number(message.tabId);
        sendResponse(await getPublicStatus(tabId));
        break;
      }
      case "FORCE_SCAN": {
        const tabId = Number(message.tabId);
        await startTab(tabId);
        const result = await scanTab(tabId, true);
        sendResponse({ success: true, result, status: await getPublicStatus(tabId) });
        break;
      }
      case "SETTINGS_UPDATED": {
        for (const tabId of sessions.keys()) scheduleNext(tabId, 0);
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
  })().catch((error) => sendResponse({ success: false, message: error.message || String(error) }));
  return true;
});

async function scanExistingYouTubeTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://youtube.com/*"] });
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => startTab(tab.id)));
}

async function startTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("無效的 tabId");
  let session = sessions.get(tabId);
  if (!session) {
    session = createSession(tabId);
    sessions.set(tabId, session);
  }
  await ensureAttached(tabId);
  scheduleNext(tabId, 0);
}

function createSession(tabId) {
  return {
    tabId,
    attached: false,
    timer: null,
    cachedSelector: "",
    skipCount: 0,
    hasPlayer: false,
    isAdPlaying: false,
    foundSkipButton: false,
    canSkip: false,
    skipButtonText: "",
    matchedSelector: "",
    lastAction: "等待偵測",
    lastError: "",
    lastSkipAt: "",
    lastCheckedAt: ""
  };
}

async function stopTab(tabId, reason) {
  const session = sessions.get(tabId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  sessions.delete(tabId);
  processingTabs.delete(tabId);
  if (session.attached) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  }
  await writeLog("INFO", "cdp", "停止監控分頁", { tabId, reason });
}

function scheduleNext(tabId, delayMs) {
  const session = sessions.get(tabId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(async () => {
    try {
      await scanTab(tabId, false);
    } catch (error) {
      session.lastError = error.message || String(error);
      await logError(tabId, "CDP 偵測失敗", error);
    } finally {
      const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      if (sessions.has(tabId)) scheduleNext(tabId, normalizeInterval(settings.checkIntervalMs));
    }
  }, Math.max(0, delayMs));
}

async function scanTab(tabId, force) {
  if (processingTabs.has(tabId)) return { busy: true };
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.enabled && !force) {
    const session = sessions.get(tabId);
    if (session) session.lastAction = "自動略過已停用";
    return { disabled: true };
  }

  processingTabs.add(tabId);
  try {
    await ensureAttached(tabId);
    const session = sessions.get(tabId);
    if (!session) return { stopped: true };

    const root = await getDocumentRoot(tabId);
    const playerNodeId = await queryFirst(tabId, root.nodeId, ["#movie_player"]);
    session.hasPlayer = Boolean(playerNodeId);
    session.lastCheckedAt = new Date().toISOString();

    if (!playerNodeId) {
      updateSession(session, { isAdPlaying: false, foundSkipButton: false, canSkip: false, lastAction: "找不到播放器" });
      await persistStatus();
      return { found: false, reason: "no-player" };
    }

    session.isAdPlaying = await nodeHasAnyClass(tabId, playerNodeId, ["ad-showing", "ad-interrupting"]);

    const selectorOrder = session.cachedSelector
      ? [session.cachedSelector, ...SKIP_SELECTORS.filter((s) => s !== session.cachedSelector)]
      : SKIP_SELECTORS;

    const found = await queryFirstWithSelector(tabId, root.nodeId, selectorOrder);
    if (found) {
      const info = await getNodeInfo(tabId, found.nodeId);
      updateSession(session, {
        foundSkipButton: true,
        canSkip: info.clickable,
        skipButtonText: info.text,
        matchedSelector: found.selector,
        lastAction: info.clickable ? "找到略過按鈕，準備以 CDP 點擊" : "找到略過按鈕，但目前不可點擊",
        lastError: ""
      });
      session.cachedSelector = found.selector;

      if (info.clickable) {
        await dispatchClick(tabId, info.x, info.y);
        const skipped = await verifyAdEnded(tabId, 1200);
        if (skipped) {
          session.skipCount += 1;
          session.lastSkipAt = new Date().toISOString();
          session.lastAction = "已使用 CDP 略過廣告";
          await writeLog("INFO", "cdp", "略過廣告成功", { tabId, selector: found.selector, x: info.x, y: info.y, text: info.text });
        } else {
          session.lastAction = "已送出 CDP 點擊，但廣告仍在播放";
          session.lastError = "CDP 點擊後驗證失敗";
          await writeLog("WARN", "cdp", "略過後驗證失敗", { tabId, selector: found.selector });
        }
      }
    } else {
      updateSession(session, { foundSkipButton: false, canSkip: false, skipButtonText: "", matchedSelector: "", lastAction: session.isAdPlaying ? "廣告播放中，尚未出現略過按鈕" : "目前沒有可略過廣告", lastError: "" });
      session.cachedSelector = "";

      const overlay = await queryFirstWithSelector(tabId, root.nodeId, CLOSE_SELECTORS);
      if (overlay) {
        const info = await getNodeInfo(tabId, overlay.nodeId);
        if (info.clickable) {
          await dispatchClick(tabId, info.x, info.y);
          session.lastAction = "已關閉廣告覆蓋層";
          await writeLog("INFO", "cdp", "關閉廣告覆蓋層", { tabId, selector: overlay.selector });
        }
      }
    }

    await persistStatus();
    return { found: Boolean(found), adPlaying: session.isAdPlaying };
  } finally {
    processingTabs.delete(tabId);
  }
}

async function ensureAttached(tabId) {
  const session = sessions.get(tabId) || createSession(tabId);
  if (!sessions.has(tabId)) sessions.set(tabId, session);
  if (session.attached) return;
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
  } catch (error) {
    const message = error.message || String(error);
    if (!message.includes("Another debugger is already attached") && !message.includes("Already attached")) throw error;
  }
  session.attached = true;
  await sendCommand(tabId, "DOM.enable");
  await sendCommand(tabId, "Runtime.enable");
  await writeLog("INFO", "cdp", "Debugger 已附加", { tabId });
}

async function getDocumentRoot(tabId) {
  const result = await sendCommand(tabId, "DOM.getDocument", { depth: 1, pierce: true });
  return result.root;
}

async function queryFirst(tabId, rootNodeId, selectors) {
  for (const selector of selectors) {
    const result = await sendCommand(tabId, "DOM.querySelector", { nodeId: rootNodeId, selector });
    if (result.nodeId) return result.nodeId;
  }
  return 0;
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

function normalizeInterval(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(5000, Math.max(300, number)) : DEFAULT_SETTINGS.checkIntervalMs;
}

function isYouTubeUrl(url) {
  return typeof url === "string" && /^https:\/\/(www\.)?youtube\.com\//i.test(url);
}

function updateSession(session, patch) {
  Object.assign(session, patch);
}

async function getPublicStatus(tabId) {
  let session = sessions.get(tabId);
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) {}
  if (tab && isYouTubeUrl(tab.url) && !session) {
    await startTab(tabId);
    session = sessions.get(tabId);
  }
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
    lastAction: session?.lastAction || "尚未啟動偵測",
    lastError: session?.lastError || "",
    lastSkipAt: session?.lastSkipAt || "",
    lastCheckedAt: session?.lastCheckedAt || ""
  };
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
