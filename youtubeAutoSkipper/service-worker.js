chrome.runtime.onInstalled.addListener(() => {
  console.log("YouTube Auto Ad Skipper installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "SKIP_AD_BY_DEBUGGER") {
    return false;
  }

  const tabId = sender.tab?.id;

  if (!tabId) {
    sendResponse({
      success: false,
      message: "找不到 sender.tab.id"
    });
    return true;
  }

  clickByDebugger(tabId, message.x, message.y)
    .then(() => {
      sendResponse({
        success: true,
        message: "Debugger 點擊完成"
      });
    })
    .catch((error) => {
      sendResponse({
        success: false,
        message: error.message || String(error)
      });
    });

  return true;
});

async function clickByDebugger(tabId, x, y) {
  const target = { tabId };

  await attachDebugger(target);

  await sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none"
  });

  await sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });

  await sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
}

function attachDebugger(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      const error = chrome.runtime.lastError;

      if (error) {
        if (error.message.includes("Another debugger is already attached")) {
          resolve();
          return;
        }

        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function sendCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}