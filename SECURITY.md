# Security

## セキュリティ方針

LocalShotのランタイムコードは外部通信を行いません。

- Manifest CSPで `connect-src 'none'` を指定
- 外部script、font、stylesheetなし
- リモートURLをランタイムへ埋め込まない
- `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`を使用しない
- Host permissionsを宣言しない

`npm run audit` でこれらを静的検査します。

## 脆弱性の報告

脆弱性を発見した場合は、詳細を公開Issueに投稿せず、[GitHubのPrivate vulnerability reporting](https://github.com/riht1008/localshot-chrome/security/advisories/new)から報告してください。

報告には、再現手順、影響範囲、可能であれば修正案を含めてください。報告を受けた後、影響確認と修正版の公開について連絡します。

## データ保持

撮影直後の画像は `chrome.storage.local` に一時的に保存し、Editorタブが読み込みます。外部サーバーには送信しません。
