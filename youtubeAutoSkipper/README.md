# YouTube Auto Ad Skipper v3.3.0

這是一個 Manifest V3 Chrome 擴充功能。Content Script 負責監控 YouTube DOM；偵測到「略過廣告」按鈕後，背景 Service Worker 才短暫連接 Chrome DevTools Protocol（CDP）並送出滑鼠點擊，完成後立即解除連線。

## 支援功能

- 自動偵測並點擊 YouTube「略過廣告」按鈕。
- 支援目前正在觀看的前景 YouTube 分頁。
- 支援切換到其他分頁後，仍在背景播放的 YouTube 分頁。
- 支援多個 YouTube 分頁，各分頁分開偵測及處理。
- 支援播放器捲出畫面、瀏覽留言區及一般 Mini Player 情境。
- 按鈕位於 viewport 外時，CDP 會暫時將按鈕移入可點擊區域，點擊後恢復原本捲動位置。
- 使用 `MutationObserver` 監控播放器及按鈕 DOM 變化，不只依賴計時器。
- 監聽 YouTube SPA 導航、頁面顯示狀態及影片播放事件，提升背景偵測機會。
- 使用低頻計時器作為備援偵測。
- 使用 `chrome.debugger` 短暫附加目標分頁。
- 使用 CDP `DOM.getDocument`、`DOM.querySelector`、`DOM.resolveNode` 尋找並解析按鈕。
- 使用 `DOM.scrollIntoViewIfNeeded` 處理畫面外按鈕。
- 使用 `Input.dispatchMouseEvent` 送出滑鼠移動、按下及放開事件。
- 點擊後檢查 `ad-showing`、`ad-interrupting` 及略過按鈕是否消失。
- 支援關閉影片上的廣告覆蓋層。
- 分頁被 Chrome 記憶體節省功能卸載時，會停止操作並顯示狀態，不會強制重新載入影片。
- Popup 支援一般使用者模式與開發者模式。
- 支援啟用／停用、手動重新偵測、略過次數、最近動作及 Debug Log。

## 背景播放支援範圍

可支援：

- 使用者切換到其他 Chrome 分頁，YouTube 仍持續播放。
- YouTube 分頁不是目前作用中的分頁。
- YouTube 播放器捲出目前畫面。
- Chrome 視窗最小化但分頁與影片仍未被凍結時，會盡力處理。

無法保證：

- 分頁已被 Chrome 標記為 `discarded` 並從記憶體卸載。
- 電腦睡眠、瀏覽器完全暫停頁面執行或作業系統停止背景程序。
- YouTube 修改按鈕結構或 selector，但擴充功能尚未更新。
- 分頁同時被 Chrome DevTools 或其他擴充功能占用 Debugger。

## 不包含的功能

- 不會快轉不可略過廣告。
- 不會封鎖廣告網路請求。
- 不包含 SponsorBlock 或其他第三方服務。
- 不會主動重新載入已被 Chrome 卸載的背景分頁。

## 專案結構

```text
youtubeAutoSkipper/
├─ manifest.json
├─ README.md
├─ config/
│  └─ app-config.js
├─ background/
│  └─ service-worker.js
├─ content_script/
│  └─ content.js
└─ popup/
   ├─ popup.html
   ├─ popup.css
   └─ popup.js
```

## 執行流程

```text
Content Script
  → MutationObserver / YouTube 導航事件 / 影片事件
  → 找到 DOM 中存在的略過按鈕
  → 傳送 SKIP_CANDIDATE

Service Worker
  → 確認分頁不是 discarded
  → chrome.debugger.attach
  → DOM.querySelector 重新確認按鈕
  → 必要時 DOM.scrollIntoViewIfNeeded
  → Input.dispatchMouseEvent
  → 驗證廣告結束
  → 恢復捲動位置
  → chrome.debugger.detach
```

## 安裝方式

1. 解壓縮 ZIP。
2. 開啟 `chrome://extensions/`。
3. 開啟右上角「開發人員模式」。
4. 點擊「載入未封裝項目」。
5. 選擇包含 `manifest.json` 的 `youtubeAutoSkipper` 資料夾。
6. 重新整理所有已開啟的 YouTube 分頁。

## Popup 顯示模式

透過以下檔案切換：

```text
config/app-config.js
```

一般使用者模式：

```javascript
globalThis.YOUTUBE_AUTO_SKIPPER_CONFIG = Object.freeze({
  mode: "user"
});
```

開發者模式：

```javascript
globalThis.YOUTUBE_AUTO_SKIPPER_CONFIG = Object.freeze({
  mode: "developer"
});
```

修改後請在 `chrome://extensions/` 對擴充功能按下「重新載入」。

## Debugger 提示

CDP 在 Chrome Extension 中必須透過 `chrome.debugger` 使用。每次附加分頁時，Chrome 可能短暫顯示「擴充功能已開始為這個瀏覽器偵錯」提示。此版本只在偵測到候選按鈕時短暫附加，操作完成後立即解除，但無法由擴充功能隱藏 Chrome 的安全提示。
