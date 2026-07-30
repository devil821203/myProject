"use strict";

const DEFAULT_SETTINGS = { enabled: true, checkIntervalMs: 500 };
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
let lastSkipSignature = "";
let lastOverlaySignature = "";
let lastStateSignature = "";
let lastCandidateAt = 0;

start();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SETTINGS_UPDATED") restart();
});

async function start() {
  stop();
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.enabled) return;

  observer = new MutationObserver(() => scheduleScan(50));
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-disabled"]
  });

  timer = setInterval(scan, normalizeInterval(settings.checkIntervalMs));
  scan();
}

function stop() {
  if (timer) clearInterval(timer);
  if (observer) observer.disconnect();
  timer = null;
  observer = null;
}

function restart() { start().catch(() => {}); }

let scheduled = false;
function scheduleScan(delay) {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan().catch(() => {});
  }, delay);
}

async function scan() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.enabled) return;

  const player = document.querySelector("#movie_player");
  const isAdPlaying = Boolean(player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting"));
  const skip = findVisible(SKIP_SELECTORS);
  const overlay = findVisible(CLOSE_SELECTORS);

  const state = {
    type: "PAGE_STATE",
    hasPlayer: Boolean(player),
    isAdPlaying,
    foundSkipButton: Boolean(skip),
    skipButtonText: skip?.text || "",
    matchedSelector: skip?.selector || ""
  };
  const stateSignature = JSON.stringify(state);
  if (stateSignature !== lastStateSignature) {
    lastStateSignature = stateSignature;
    safeSend(state);
  }

  if (skip) {
    const signature = `${skip.selector}|${skip.text}`;
    const now = Date.now();
    if (signature !== lastSkipSignature || now - lastCandidateAt > 1500) {
      lastSkipSignature = signature;
      lastCandidateAt = now;
      safeSend({ type: "SKIP_CANDIDATE" });
    }
  } else {
    lastSkipSignature = "";
  }

  if (overlay) {
    const signature = `${overlay.selector}|${overlay.text}`;
    if (signature !== lastOverlaySignature) {
      lastOverlaySignature = signature;
      safeSend({ type: "OVERLAY_CANDIDATE" });
    }
  } else {
    lastOverlaySignature = "";
  }
}

function findVisible(selectors) {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const r = element.getBoundingClientRect();
      const s = getComputedStyle(element);
      const visibleWidth = Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left));
      const visibleHeight = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
      const disabled = Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
      if (element.isConnected && !disabled && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0 && visibleWidth >= 4 && visibleHeight >= 4) {
        const text = [element.innerText, element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")]
          .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        return { selector, text };
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
  return Number.isFinite(number) ? Math.min(5000, Math.max(300, number)) : DEFAULT_SETTINGS.checkIntervalMs;
}
