# Security

## ネットワーク禁止

LocalShotのランタイムコードは外部通信を行わない。

- Manifest CSP: `connect-src 'none'`
- 外部script / font / stylesheetなし
- remote URLをランタイムへ埋め込まない
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` を使用しない

`npm run audit` でこれらを静的検査する。

## データ保持

撮影直後の画像は `chrome.storage.local` に一時的に保存し、Editorタブが読み込む。外部サーバーには送信しない。

## 権限

Host permissionsは宣言しない。ページアクセスはユーザー操作による `activeTab` に限定する。
