# ThunderTranslate
ThunderTranslate is a Thunderbird add-on that translates emails and allows you to add notes to them.

Thunderbird 向け Google Gemini API インライン翻訳 & ユーザーメモ アドオン（Manifest V3 対応）

[![Thunderbird](https://img.shields.io/badge/Thunderbird-128%2B%20%28ESR%29-blue.svg)](https://www.thunderbird.net/)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Manifest Version](https://img.shields.io/badge/Manifest-V3-orange.svg)]()

ThunderTranslate は、Google の Gemini API を使用し、Thunderbird 内で受信メールを翻訳・閲覧するアドオンです。
外部ブラウザや別ウィンドウを開くことなく、メール本文中に直接「翻訳カード」を割り込み表示し、原文と訳文をスムーズに対比しながら閲覧できます。

---

## 主な機能と特徴

### 1. スマートなインライン割り込み表示
- メール本文のレイアウトを崩さず、段落間に自然に翻訳カードを挿入。
- **全文翻訳**: メールヘッダーの「全文を翻訳」ボタンでワンクリック翻訳。
- **部分翻訳**: マウスで選択した部分だけをピンポイントで翻訳（コンテキストメニューまたはショートカットキー）。
- **表示切り替え**: 「翻訳を非表示 / 表示」ボタンで原文のみの状態へ瞬時にトグル。

### 2. ユーザーメモ機能
- メールの気になる箇所を選択して右クリックメニューまたはショートカットキーで、メモを記録するカードを追加可能。
- 翻訳カードと同様に本文内の該当箇所に配置され、自動保存されます。
- メモデータはすべて Thunderbird のローカルプロファイル（`browser.storage.local`）に保存され、外部APIやサーバーへ送信されることは一切ありません。

### 3. 高度なセキュリティ設計
- **ゼロ幅文字・不可視文字サニタイズ**: メール本文に潜む不正な不可視トラッカーや制御文字をAI送信前に自動除去。
- **強固なAPIキー暗号化**: 登録した Gemini API キーは、Web Crypto API（PBKDF2 100,000回反復 + AES-GCM 256-bit）により、ユーザー独自のPINコードで暗号化して保存。
- **Closed Shadow DOM の採用**: メール自体のCSSや外部スクリプトの影響を完全に遮断した閉鎖環境でカードを描画。
- **審査ポリシー対応**: `innerHTML`, `outerHTML`, `document.write`, `eval` は一切使用していません。
- **Experiment API 不使用**: 公式標準の WebExtension / MailExtension API のみで動作します。

### 4. プライバシー保護
- 開発者サーバーや第三者へのデータ送信・テレメトリ収集は一切ありません。
- ユーザーが明示的に翻訳を要求したテキストのみが、Google Generative Language API（`https://generativelanguage.googleapis.com`）へダイレクトに送信されます。

---

## 動作環境

- **Thunderbird**: 128.0 以降（Thunderbird ESR 128 "Nebula" 対応）
- **プラットフォーム**: Windows / macOS / Linux
- **前提条件**: Google AI Studio 等で取得した Gemini API キー（無料枠で使用可能）

---

## インストール方法

### 開発版（XPI からの手動インストール）
1. [Releases](../../releases) ページから最新の `ThunderTranslate.xpi` をダウンロードします（または下記の手順でビルドします）。
2. Thunderbird を起動し、**「アドオンとテーマ」**（`Ctrl + Shift + A`）を開きます。
3. 右上の歯車アイコン ⚙️ をクリックし、**「ファイルからアドオンをインストール...」** を選択します。
4. ダウンロードした `ThunderTranslate.xpi` を選択し、インストールを許可します。

---

## ビルド方法

PowerShell 環境でプロジェクトルートにある `build_xpi.ps1` を実行するだけで、配布用の `ThunderTranslate.xpi` が生成されます。

```powershell
.\build_xpi.ps1
```

※ 外部ツール（Node.js, npm, Webpack 等）への依存はなく、標準の PowerShell だけでビルド可能です。

---

## 設定と初期セットアップ

1. Thunderbird の **「アドオンとテーマ」 → 「拡張機能」 → 「ThunderTranslate」のオプション**（設定画面）を開きます。
2. ご自身の **Gemini API キー** を入力します。
3. 任意の **4桁以上の暗号化PIN** を設定し、「設定を保存」をクリックします。
4. プロンプトプリセット（ビジネス / ぬこ / ユーザーカスタム等）や使用モデル（`gemini-3.5-flash-lite` 等）を好みに応じてカスタマイズできます。

---

## ファイル構成

```text
├── manifest.json              # WebExtension (MV3) マニフェスト
├── background.js              # バックグラウンドサービスロジック
├── crypto.js                  # Web Crypto API 暗号化・PIN管理モジュール
├── i18n.js                    # 多言語対応ヘルパー
├── content/
│   ├── content.js             # メール本文へのインライン描画・UIロジック
│   └── content.css            # Closed Shadow DOM 外枠用スタイル
├── options/
│   ├── options.html           # 設定画面 HTML
│   ├── options.js             # 設定画面 ロジック
│   └── options.css            # 設定画面 スタイル
├── icons/                     # アドオン各種サイズアイコン (16/32/64/128/256/512)
├── _locales/
│   ├── ja/messages.json       # 日本語リソース
│   └── en/messages.json       # 英語リソース
├── build_xpi.ps1              # XPI パッケージ生成スクリプト
├── PRIVACY_POLICY.txt         # プライバシーポリシー
└── README.md                  # 本ドキュメント
```

---

## ライセンス

本プロジェクトは [Mozilla Public License 2.0 (MPL-2.0)](https://www.mozilla.org/en-US/MPL/2.0/) の下で公開されています。
