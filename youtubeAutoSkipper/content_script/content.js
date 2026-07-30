"use strict";

const DEFAULT_SETTINGS = { enabled: true, checkIntervalMs: 1000 };

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

let timer = null;
let observer = null;
let scheduledTimer = null;
let lastSkipSignature = "";
let lastOverlaySignature = "";
let lastStateSignature = "";
let lastSkipMessageAt = 0;
let lastOverlayMessageAt = 0;
let running = false;

start().catch(() => {});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SETTINGS_UPDATED") restart();
});

document.addEventListener("visibilitychange", () => scheduleScan(0), true);
document.addEventListener("yt-navigate-finish", () => scheduleScan(100), true);
document.addEventListener("yt-page-data-updated", () => scheduleScan(100), true);
window.addEventListener("pageshow", () => scheduleScan(0), true);
window.addEventListener("focus", () => scheduleScan(0), true);

async function start() {
  stop();
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.enabled) return;

  running = true;
  observer = new MutationObserver(() => scheduleScan(30));
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-disabled", "aria-label"]
  });

  bindVideoEvents();
  timer = setInterval(() => scan().catch(() => {}), normalizeInterval(settings.checkIntervalMs));
  await scan();
}

function stop() {
  running = false;
  if (timer) clearInterval(timer);
  if (observer) observer.disconnect();
  if (scheduledTimer) clearTimeout(scheduledTimer);
  timer = null;
  observer = null;
  scheduledTimer = null;
}

function restart() {
  start().catch(() => {});
}

function bindVideoEvents() {
  const video = document.querySelector("video");
  if (!video || video.dataset.autoSkipperBound === "1") return;

  video.dataset.autoSkipperBound = "1";
  for (const eventName of ["play", "playing", "timeupdate", "loadedmetadata", "durationchange", "ended"]) {
    video.addEventListener(eventName, () => scheduleScan(0), { passive: true });
  }
}

function scheduleScan(delay) {
  if (!running || scheduledTimer) return;
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    scan().catch(() => {});
  }, delay);
}

async function scan() {
  if (!running) return;

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.enabled) return;

  bindVideoEvents();

  const player = document.querySelector("#movie_player");
  const isAdPlaying = Boolean(
    player?.classList.contains("ad-showing") ||
    player?.classList.contains("ad-interrupting")
  );

  // 背景分頁或播放器在畫面外時，仍然回報 DOM 中存在且可操作的按鈕。
  // 真正座標與是否需要捲動，由 Service Worker 的 CDP 再確認。
  const skip = findCandidate(SKIP_SELECTORS);
  const overlay = findCandidate(CLOSE_SELECTORS);

  const state = {
    type: "PAGE_STATE",
    hasPlayer: Boolean(player),
    isAdPlaying,
    foundSkipButton: Boolean(skip),
    skipButtonText: skip?.text || "",
    matchedSelector: skip?.selector || "",
    pageVisibility: document.visibilityState
  };

  const stateSignature = JSON.stringify(state);
  if (stateSignature !== lastStateSignature) {
    lastStateSignature = stateSignature;
    safeSend(state);
  }

  const now = Date.now();
  if (skip) {
    const signature = `${skip.selector}|${skip.text}`;
    if (signature !== lastSkipSignature || now - lastSkipMessageAt >= 1800) {
      lastSkipSignature = signature;
      lastSkipMessageAt = now;
      safeSend({
        type: "SKIP_CANDIDATE",
        pageVisibility: document.visibilityState
      });
    }
  } else {
    lastSkipSignature = "";
  }

  if (overlay) {
    const signature = `${overlay.selector}|${overlay.text}`;
    if (signature !== lastOverlaySignature || now - lastOverlayMessageAt >= 5000) {
      lastOverlaySignature = signature;
      lastOverlayMessageAt = now;
      safeSend({ type: "OVERLAY_CANDIDATE" });
    }
  } else {
    lastOverlaySignature = "";
  }
}

function findCandidate(selectors) {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled = Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
      const hasSize = rect.width >= 4 && rect.height >= 4;
      const rendered =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) > 0;

      if (element.isConnected && !disabled && hasSize && rendered) {
        const text = [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        return {
          selector,
          text,
          inViewport:
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < innerWidth &&
            rect.top < innerHeight
        };
      }
    }
  }
  return null;
}

function safeSend(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (_) {}
}

function normalizeInterval(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(5000, Math.max(500, number))
    : DEFAULT_SETTINGS.checkIntervalMs;
}
