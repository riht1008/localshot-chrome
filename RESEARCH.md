# OSSリサーチと採用判断

## 結論

既存OSSを丸ごとforkせず、**撮影アルゴリズムとUXパターンを参考にしたクリーンな小規模実装**を採用した。

理由:

1. 今回は「録画・共有・クラウド・外部送信を絶対に持たない」が重要。
2. 既存の高機能OSSには録画やアップロード機能が混在するものがある。
3. 依存ライブラリをなくし、Chrome標準API + Canvasだけにすると社内レビューが容易。
4. `<all_urls>` や `debugger` を要求しない設計を維持しやすい。

## 1. PGHQdev/OpenScreenShot

- Repository: https://github.com/PGHQdev/OpenScreenShot
- License: MIT
- 2026-08時点で TypeScript / Manifest V3
- Full Page / Visible / Region、注釈、Blur、Crop、Undo/Redoなどを実装
- privacy-first / local-first を明示

### 特に参考になる部分

- service worker が `chrome.tabs.captureVisibleTab()` を統括
- `chrome.scripting.executeScript({ func, args })` で自己完結関数をページへ注入
- full page は scroll & stitch
- 1枚目だけ fixed / sticky を残し、2枚目以降で非表示にして重複を避ける
- body/document がスクロールしないSPA向けに、主要な内部スクロール要素を探索
- region selection はページ上へ一時オーバーレイを作る

### そのままforkしなかった理由

現行ツリーには recorder 系コードも含まれ、今回の要件では不要な機能面積が大きい。必要部分だけ自前で組んだ方が、「ネットワーク・録画機能がコードベースに存在しない」ことを説明しやすい。

## 2. mrcoles/full-page-screen-capture-chrome-extension

- Repository: https://github.com/mrcoles/full-page-screen-capture-chrome-extension
- License: MIT
- 古くから利用されてきた Full Page capture の代表的OSS

### 参考点

- viewportを複数回キャプチャして結合する基本パターン
- Full Page screenshot は専用の外部サービスなしでChrome拡張内だけで成立すること

### 採用しなかった理由

歴史が長く、現行MV3で新規実装する際はOpenScreenShot型の `activeTab + scripting` 構成の方が要件に合う。

## 3. KurtStevenK/FeatherShot

- Repository: https://github.com/KurtStevenK/FeatherShot
- License: MIT
- 軽量なScreenshot annotationツール

### 参考点

- 選択範囲 → Editorという小さな責務分割
- 注釈ツールをブラウザCanvasで完結できること

## 4. alyssaxuu/screenity

- Repository: https://github.com/alyssaxuu/screenity
- 現行MV3版は GPLv3 とREADMEに記載
- 録画・注釈機能が非常に充実

### 今回コードを流用しない理由

- 今回は録画禁止
- GPLv3の現行コードを取り込む必要がない
- Screenshot editorだけを作るならMIT候補から設計を学ぶ方が単純

## 5. The01Geek/RadKit

- Repository: https://github.com/The01Geek/RadKit
- License: MIT
- Visible / Region / Full Page + Annotation を持つ
- privacy-firstだがRecordingも含む

### 判断

機能確認用の参考にはなるが、今回の最小コードベースには過剰。

## 6. slastrina/chrome-browser-screen-shots

- Repository: https://github.com/slastrina/chrome-browser-screen-shots
- License: MIT
- Full Page等で Chrome debugger を利用

### 判断

DevTools Protocolは強力だが、社内向けの最小権限という目的では `debugger` 権限を避けたい。今回は不採用。

## 今回の実装方針

実コードは上記OSSのソースをコピー&ペーストせず、以下の一般的な実装パターンを自前で記述した。

- `activeTab` と `scripting`
- `captureVisibleTab`
- scroll & stitch
- fixed/sticky重複対策
- 内部スクローラー検出
- DOM overlayによるregion picker
- Canvas annotation object model

したがって、本リポジトリの `THIRD_PARTY_NOTICES.md` は「設計上の参考」として記録し、OSSコードをバンドルしてはいない。
