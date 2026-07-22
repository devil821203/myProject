# YouTube Auto Ad Skipper v3.0.0

這是一個 Manifest V3 Chrome 擴充功能，使用 Chrome DevTools Protocol（CDP）偵測並點擊 YouTube 的「略過廣告」按鈕。

## 支援功能

- 使用 `chrome.debugger` 附加 YouTube 分頁。
- 使用 CDP `DOM.getDocument` 與 `DOM.querySelector` 尋找按鈕。
- 使用 `Runtime.callFunctionOn` 取得按鈕文字、狀態與實際可見座標。
- 使用 `Input.dispatchMouseEvent` 送出滑鼠移動、按下與放開事件。
- 點擊後驗證廣告狀態，避免將「指令成功送出」誤判為「略過成功」。
- 支援新版與舊版 YouTube 略過按鈕 selector。
- 支援關閉影片上的廣告覆蓋層。
- 支援一般播放器、頁面捲動後播放器與 Mini Player；只要按鈕仍有可見區域即可點擊。
- 支援多個 YouTube 分頁，各分頁獨立維護 CDP session 與狀態。
- 支援啟用／停用自動略過。
- 支援設定偵測間隔，範圍為 300～5000 毫秒。
- Popup 顯示播放器、廣告、按鈕、略過次數與最近動作。
- 內建偵錯 Log，可重新整理或清除。
- 不使用 content script 搜尋按鈕，也不使用 `HTMLElement.click()` 或合成 `dispatchEvent()` 作為主要點擊方式。

## 不包含的功能

- 不會自動快轉不可略過廣告。
- 不會封鎖廣告請求。
- 不包含 SponsorBlock 或第三方服務。
- 不保證每一種 YouTube A/B 測試介面都能立即支援；若 selector 改變，需要更新 `SKIP_SELECTORS`。

## 安裝方式

1. 解壓縮 ZIP。
2. 在 Chrome 開啟 `chrome://extensions/`。
3. 開啟右上角「開發人員模式」。
4. 點擊「載入未封裝項目」。
5. 選擇包含 `manifest.json` 的 `youtubeAutoSkipper` 資料夾。
6. 重新整理已開啟的 YouTube 分頁。

## 正式打包與權限

正式打包後 `chrome.debugger` 仍可使用，前提是 `manifest.json` 保留 `debugger` 權限。使用者安裝時會看到高權限警告；若上架 Chrome Web Store，Google 可能要求說明此權限的必要性。

## 架構

```text
youtubeAutoSkipper/
├─ manifest.json
├─ README.md
├─ background/
│  └─ service-worker.js
└─ popup/
   ├─ popup.html
   ├─ popup.css
   └─ popup.js
```

主要流程：

```text
Service Worker
  → chrome.debugger.attach
  → DOM.getDocument
  → DOM.querySelector
  → DOM.resolveNode
  → Runtime.callFunctionOn
  → Input.dispatchMouseEvent
  → 驗證 ad-showing / ad-interrupting
```

## 注意事項

- 開啟 Chrome DevTools 時，可能與擴充功能的 debugger attachment 衝突。
- Chrome 或 YouTube 更新後，可能需要調整 CDP 行為或 selector。
- Manifest V3 service worker 可能由 Chrome 暫停；擴充功能會在分頁事件、Popup 操作或重新啟動時恢復監控。
