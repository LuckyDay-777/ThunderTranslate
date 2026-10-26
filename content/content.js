/**
 * content.js - Thunderbird メッセージ表示用コンテンツスクリプト
 * メールの本文内に翻訳カードを割り込み挿入・復元・削除、トースト通知、PINモーダルを表示します。
 */

(function () {
  'use strict';

  const extApi = typeof messenger !== 'undefined' ? messenger : browser;

  const href = window.location.href || '';
  if (href === 'about:blank' || href.startsWith('about:3pane') || href.startsWith('about:message') || href.startsWith('chrome:')) {
    return;
  }

  let currentMessageId = null;
  let lastRestoredMessageId = null;
  let activeContextMenu = null;

  // 1.① 偽造翻訳カード（UIスプーフィング）対策: アドオン自身が生成した正規DOM要素のみを登録する WeakSet
  const authenticAddonElements = new WeakSet();

  // 2.① & 2.② 前処理最大バイト数・DOM走査上限設定
  let maxTranslationChars = 50000;
  const MAX_DOM_SCAN_NODES = 5000;
  const MAX_ANCESTOR_DEPTH = 50;

  // 重複実行・多重送信ガード用フラグ
  let isTranslatingSelection = false;
  let isTogglingFull = false;
  let lastCommandTimestamp = 0;
  let lastCommandType = '';

  // ショートカット設定の状態変数
  let shortcutEnabled = true;
  let shortcutKey = 't';
  let memoShortcutEnabled = true;
  let memoShortcutKey = 'm';

  // 右クリック位置の保持（範囲未選択での「メモを追加」用）
  let lastContextMenuRange = null;
  let lastContextMenuTimestamp = 0;
  let lastContextMenuY = null;

  // 1.③ Closed Shadow DOM 内部用カプセル化スタイルシート（メール内CSSからの干渉を完全遮断）
  const SHADOW_CONTENT_CSS = `
    :host {
      all: initial;
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1f1f1f;
      text-align: left;
      box-sizing: border-box;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    .gemini-trans-card-surface {
      display: block;
      padding: 10px 14px;
      background-color: #f0f4f9;
      border: 1px solid #c2e7ff;
      border-left: 5px solid #1a73e8;
      border-radius: 8px;
      color: #1f1f1f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      text-align: left;
      user-select: text;
    }
    .gemini-trans-card-surface.is-full {
      background-color: #eef5fc;
      border-color: #b9d7fb;
      border-left-color: #0b57d0;
    }
    .gemini-trans-card-surface.is-memo {
      background-color: #ecfdf5;
      border-color: #a7f3d0;
      border-left-color: #059669;
    }
    .gemini-trans-card-surface.is-loading {
      background-color: #f8fafd;
      border-color: #d2e3fc;
      border-left-color: #1a73e8;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      color: #1a73e8;
      font-weight: 500;
      user-select: none;
    }
    .gemini-spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(26, 115, 232, 0.2);
      border-top-color: #1a73e8;
      border-radius: 50%;
      animation: gemini-spin 0.8s linear infinite;
      display: inline-block;
      flex-shrink: 0;
    }
    @keyframes gemini-spin {
      to { transform: rotate(360deg); }
    }
    .gemini-trans-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px dashed rgba(26, 115, 232, 0.25);
      user-select: none;
    }
    .gemini-trans-header.is-memo {
      border-bottom-color: rgba(5, 150, 105, 0.28);
    }
    .gemini-trans-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      color: #0b57d0;
      letter-spacing: 0.3px;
    }
    .gemini-trans-badge.is-memo {
      color: #047857;
    }
    .gemini-trans-badge-icon {
      width: 13px;
      height: 13px;
      display: inline-block;
    }
    .gemini-memo-header-right {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .gemini-memo-status {
      font-size: 11px;
      color: #059669;
      opacity: 0.85;
      font-weight: 500;
    }
    .gemini-trans-delete-btn {
      background: transparent;
      border: none;
      color: #70757a;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
      transition: all 0.15s ease-in-out;
      opacity: 0.65;
    }
    .gemini-trans-card-surface:hover .gemini-trans-delete-btn {
      opacity: 1;
    }
    .gemini-trans-delete-btn:hover {
      background-color: #fce8e6;
      color: #c5221f;
    }
    .gemini-trans-body {
      white-space: pre-wrap;
      word-break: break-word;
      color: #1f1f1f;
    }
    .gemini-memo-textarea {
      width: 100%;
      min-height: 54px;
      padding: 6px 8px;
      border: 1px solid rgba(5, 150, 105, 0.28);
      border-radius: 6px;
      background-color: rgba(255, 255, 255, 0.85);
      color: #1f1f1f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      display: block;
      overflow-y: hidden;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
    }
    .gemini-memo-textarea:focus {
      background-color: #ffffff;
      border-color: #059669;
      box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.18);
    }
    .gemini-memo-textarea::placeholder {
      color: #6b7280;
    }
    .gemini-pin-modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 2147483645;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(2px);
    }
    .gemini-pin-modal {
      background: #ffffff;
      border-radius: 12px;
      padding: 24px;
      width: 320px;
      max-width: 90%;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      color: #1f1f1f;
    }
    .gemini-pin-modal-title {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
      color: #1f1f1f;
    }
    .gemini-pin-modal-desc {
      margin: 0 0 16px 0;
      font-size: 13px;
      color: #5f6368;
      line-height: 1.4;
    }
    .gemini-pin-modal-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #dadce0;
      border-radius: 6px;
      font-size: 14px;
      margin-bottom: 12px;
      outline: none;
      background: #ffffff;
      color: #1f1f1f;
    }
    .gemini-pin-modal-input:focus {
      border-color: #1a73e8;
      box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
    }
    .gemini-pin-modal-error {
      color: #d93025;
      font-size: 12px;
      margin-bottom: 12px;
      display: none;
    }
    .gemini-pin-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .gemini-pin-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
    .gemini-pin-btn-cancel {
      background: #f1f3f4;
      color: #3c4043;
    }
    .gemini-pin-btn-cancel:hover {
      background: #e8eaed;
    }
    .gemini-pin-btn-submit {
      background: #1a73e8;
      color: #ffffff;
    }
    .gemini-pin-btn-submit:hover {
      background: #1557b0;
    }
    @media (prefers-color-scheme: dark) {
      .gemini-trans-card-surface {
        background-color: #1e2638;
        border-color: #2b3955;
        border-left-color: #4c8bf5;
        color: #e8eaed;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      }
      .gemini-trans-card-surface.is-full {
        background-color: #1b283d;
        border-color: #294066;
        border-left-color: #5c9cfa;
      }
      .gemini-trans-card-surface.is-memo {
        background-color: #132a24;
        border-color: #1f473d;
        border-left-color: #10b981;
      }
      .gemini-trans-card-surface.is-loading {
        background-color: #1e2638;
        border-color: #2b3955;
        border-left-color: #4c8bf5;
        color: #8ab4f8;
      }
      .gemini-spinner {
        border-color: rgba(138, 180, 248, 0.2);
        border-top-color: #8ab4f8;
      }
      .gemini-trans-badge {
        color: #8ab4f8;
      }
      .gemini-trans-badge.is-memo {
        color: #34d399;
      }
      .gemini-memo-status {
        color: #6ee7b7;
      }
      .gemini-trans-body {
        color: #e8eaed;
      }
      .gemini-trans-header {
        border-bottom-color: rgba(138, 180, 248, 0.2);
      }
      .gemini-trans-header.is-memo {
        border-bottom-color: rgba(16, 185, 129, 0.25);
      }
      .gemini-memo-textarea {
        background-color: rgba(15, 28, 24, 0.75);
        border-color: #26594b;
        color: #e8eaed;
      }
      .gemini-memo-textarea:focus {
        background-color: #0f1c18;
        border-color: #10b981;
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.22);
      }
      .gemini-memo-textarea::placeholder {
        color: #8ab0a4;
      }
      .gemini-pin-modal {
        background: #282a2d;
        color: #e8eaed;
      }
      .gemini-pin-modal-title {
        color: #e8eaed;
      }
      .gemini-pin-modal-desc {
        color: #9aa0a6;
      }
      .gemini-pin-modal-input {
        background: #1f1f1f;
        border-color: #3c4043;
        color: #ffffff;
      }
      .gemini-pin-btn-cancel {
        background: #3c4043;
        color: #e8eaed;
      }
    }
  `;

  // UTF-8 エンコーダ・デコーダおよびスタイルシート・SVGテンプレートの共有キャッシュ（高速化）
  const sharedTextEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const sharedTextDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;
  let sharedShadowStyleSheet = null;
  let fallbackStyleTemplate = null;
  let sparkleIconTemplate = null;
  let memoIconTemplate = null;

  function applyShadowStyles(shadowRoot) {
    if (!shadowRoot) return;
    if (shadowRoot.adoptedStyleSheets !== undefined) {
      if (!sharedShadowStyleSheet && typeof CSSStyleSheet !== 'undefined') {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(SHADOW_CONTENT_CSS);
          sharedShadowStyleSheet = sheet;
        } catch (_) {
          sharedShadowStyleSheet = null;
        }
      }
      if (sharedShadowStyleSheet) {
        try {
          shadowRoot.adoptedStyleSheets = [sharedShadowStyleSheet];
          return;
        } catch (_) {}
      }
    }
    if (!fallbackStyleTemplate) {
      fallbackStyleTemplate = document.createElement('style');
      fallbackStyleTemplate.textContent = SHADOW_CONTENT_CSS;
    }
    shadowRoot.appendChild(fallbackStyleTemplate.cloneNode(true));
  }

  // UTF-8 バイト数上限で安全に文字列を切り詰めるヘルパー (2.①)
  function truncateByUtf8Bytes(str, maxBytes) {
    if (!str || typeof maxBytes !== 'number' || maxBytes <= 0) return str || '';
    // 高速パス: UTF-16 1コードユニットは最大3バイトのため、str.length * 3 <= maxBytes なら確実に上限内
    if (str.length * 3 <= maxBytes) {
      return str;
    }
    try {
      const encoder = sharedTextEncoder || new TextEncoder();
      const encoded = encoder.encode(str);
      if (encoded.byteLength <= maxBytes) {
        return str;
      }
      const sliced = encoded.subarray(0, maxBytes);
      const decoder = sharedTextDecoder || new TextDecoder('utf-8', { fatal: false });
      return decoder.decode(sliced).replace(/\uFFFD+$/, '');
    } catch (_) {
      return str.length > maxBytes ? str.slice(0, maxBytes) : str;
    }
  }

  // 1.① 送信者HTMLによって事前挿入された偽造翻訳・メモカードクラス・属性を無害化
  function neutralizeSpoofedAddonElements(root = document.body) {
    if (!root || !root.querySelectorAll) return;
    const candidates = root.querySelectorAll(
      '.gemini-trans-block, .gemini-full-trans-block, .gemini-memo-block, .gemini-pin-modal-overlay, .gemini-trans-toast, .gemini-custom-context-menu, [data-gemini-full], [data-gemini-id], [data-gemini-memo-id]'
    );
    for (const el of candidates) {
      if (!authenticAddonElements.has(el)) {
        el.classList.remove(
          'gemini-trans-block',
          'gemini-full-trans-block',
          'gemini-memo-block',
          'gemini-trans-loading',
          'gemini-pin-modal-overlay',
          'gemini-trans-toast',
          'gemini-custom-context-menu'
        );
        el.removeAttribute('data-gemini-full');
        el.removeAttribute('data-gemini-id');
        el.removeAttribute('data-gemini-memo-id');
        el.setAttribute('data-gemini-spoofed', 'true');
      }
    }
  }

  function isAuthenticAddonNode(el) {
    let curr = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
      if (authenticAddonElements.has(curr)) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  function findAuthenticFullTransBlock() {
    neutralizeSpoofedAddonElements(document.body);
    const blocks = document.querySelectorAll('.gemini-full-trans-block');
    for (const block of blocks) {
      if (authenticAddonElements.has(block)) {
        return block;
      }
    }
    return null;
  }

  // アイコンSVG (Gemini風 Sparkle) を安全にDOM生成（テンプレートクローンによる高速化）
  function createSparkleIcon() {
    if (!sparkleIconTemplate) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'gemini-trans-badge-icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2L14.39 9.61L22 12L14.39 14.39L12 22L9.61 14.39L2 12L9.61 9.61L12 2Z');
      path.setAttribute('fill', '#1a73e8');

      svg.appendChild(path);
      sparkleIconTemplate = svg;
    }
    return sparkleIconTemplate.cloneNode(true);
  }

  // アイコンSVG (メモ用ペン＆ノート) を安全にDOM生成（テンプレートクローンによる高速化）
  function createMemoIcon() {
    if (!memoIconTemplate) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'gemini-trans-badge-icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z'
      );
      path.setAttribute('fill', '#059669');

      svg.appendChild(path);
      memoIconTemplate = svg;
    }
    return memoIconTemplate.cloneNode(true);
  }

  /* ----------------------------------------------------
   * 0. 通信ラッパー: safeSendMessage (自動リトライ付き)
   * MV3のEvent Pageスリープ復帰遅延による接続エラーを自動吸収・再試行
   * ---------------------------------------------------- */
  async function safeSendMessage(payload, retries = 3, delayMs = 250) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await extApi.runtime.sendMessage(payload);
      } catch (err) {
        const errMsg = (err && err.message) ? err.message : String(err);
        const isConnectionError =
          errMsg.includes('Could not establish connection') ||
          errMsg.includes('コネクションが確立できませんでした') ||
          errMsg.includes('Receiving end does not exist') ||
          errMsg.includes('message port closed');

        if (isConnectionError && attempt < retries - 1) {
          console.warn(`[ThunderTranslate] Connection retry (${attempt + 1}/${retries - 1}) after ${delayMs}ms:`, errMsg);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
  }

  /* ----------------------------------------------------
   * 1. ユーティリティ: トースト通知 (3秒間表示)
   * ---------------------------------------------------- */
  function showToast(message) {
    const existing = document.querySelectorAll('.gemini-trans-toast');
    existing.forEach((el) => {
      if (authenticAddonElements.has(el)) el.remove();
    });

    const toast = document.createElement('div');
    toast.className = 'gemini-trans-toast';
    toast.textContent = message;
    authenticAddonElements.add(toast);
    (document.body || document.documentElement).appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('gemini-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('gemini-toast-visible');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  /* ----------------------------------------------------
   * 2. ユーティリティ: ローディングプレースホルダー作成 (Closed Shadow DOM)
   * ---------------------------------------------------- */
  function createLoadingCard(isFull = false, options = {}) {
    const { orderIndex = 0, endGlobalOffset = null } = options;
    const block = document.createElement('div');
    block.className = 'gemini-trans-block gemini-trans-loading' + (isFull ? ' gemini-full-trans-block' : '');
    if (typeof endGlobalOffset === 'number') {
      block.setAttribute('data-gemini-offset', String(endGlobalOffset));
    }
    if (typeof orderIndex === 'number') {
      block.setAttribute('data-gemini-order', String(orderIndex));
    }
    authenticAddonElements.add(block);

    const shadow = block.attachShadow({ mode: 'closed' });
    applyShadowStyles(shadow);

    const surface = document.createElement('div');
    surface.className = 'gemini-trans-card-surface is-loading' + (isFull ? ' is-full' : '');

    const spinner = document.createElement('span');
    spinner.className = 'gemini-spinner';

    const textSpan = document.createElement('span');
    const loadingKey = isFull ? 'translatingFull' : 'translatingSelection';
    textSpan.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage(loadingKey) : (isFull ? 'Gemini でメール全文を翻訳中...' : 'Gemini で選択テキストを翻訳中...');

    surface.appendChild(spinner);
    surface.appendChild(textSpan);
    shadow.appendChild(surface);
    return block;
  }

  /* ----------------------------------------------------
   * 3. ユーティリティ: PIN入力モーダル (Closed Shadow DOM)
   * ---------------------------------------------------- */
  function promptPinModal(reasonMessage) {
    return new Promise((resolve) => {
      const existing = document.querySelectorAll('.gemini-pin-modal-overlay');
      existing.forEach((el) => {
        if (authenticAddonElements.has(el)) el.remove();
      });

      const overlay = document.createElement('div');
      overlay.className = 'gemini-pin-modal-overlay';
      authenticAddonElements.add(overlay);

      const shadow = overlay.attachShadow({ mode: 'closed' });
      applyShadowStyles(shadow);

      const backdrop = document.createElement('div');
      backdrop.className = 'gemini-pin-modal-backdrop';

      const modal = document.createElement('div');
      modal.className = 'gemini-pin-modal';

      const title = document.createElement('h3');
      title.className = 'gemini-pin-modal-title';
      title.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('pinModalTitle') : 'Gemini API キーの解除';

      const desc = document.createElement('p');
      desc.className = 'gemini-pin-modal-desc';
      desc.textContent = reasonMessage || ((typeof I18n !== 'undefined') ? I18n.getMessage('pinModalDesc') : '設定時に指定した暗号化PINを入力してください。');

      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'gemini-pin-modal-input';
      input.placeholder = (typeof I18n !== 'undefined') ? I18n.getMessage('pinModalPlaceholder') : '暗号化PINコード';
      input.autocomplete = 'off';

      const errorText = document.createElement('div');
      errorText.className = 'gemini-pin-modal-error';

      const actions = document.createElement('div');
      actions.className = 'gemini-pin-modal-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'gemini-pin-btn gemini-pin-btn-cancel';
      cancelBtn.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('pinModalCancel') : 'キャンセル';

      const submitBtn = document.createElement('button');
      submitBtn.className = 'gemini-pin-btn gemini-pin-btn-submit';
      submitBtn.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('pinModalSubmit') : '解除して翻訳';

      actions.appendChild(cancelBtn);
      actions.appendChild(submitBtn);

      modal.appendChild(title);
      modal.appendChild(desc);
      modal.appendChild(input);
      modal.appendChild(errorText);
      modal.appendChild(actions);
      backdrop.appendChild(modal);
      shadow.appendChild(backdrop);
      (document.body || document.documentElement).appendChild(overlay);

      input.focus();

      function cleanup(val) {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(val);
      }

      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cleanup(null);
      });

      function submit() {
        const pin = input.value.trim();
        if (!pin) {
          errorText.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('pinModalEmpty') : 'PINを入力してください。';
          errorText.style.display = 'block';
          return;
        }
        cleanup(pin);
      }

      submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submit();
      });

      input.addEventListener('keydown', (e) => {
        e.key === 'Enter' && (e.preventDefault(), submit());
        e.key === 'Escape' && cleanup(null);
      });
    });
  }

  /* ----------------------------------------------------
   * 4. 翻訳カードDOMの生成とイベント登録 (Closed Shadow DOM)
   * ---------------------------------------------------- */
  function createTranslationCard(translatedText, options = {}) {
    const { isFull = false, id = null, orderIndex = 0, endGlobalOffset = null } = options;

    const block = document.createElement('div');
    block.className = 'gemini-trans-block' + (isFull ? ' gemini-full-trans-block' : '');
    if (id) {
      block.setAttribute('data-gemini-id', id);
    }
    if (isFull) {
      block.setAttribute('data-gemini-full', 'true');
    }
    if (typeof endGlobalOffset === 'number') {
      block.setAttribute('data-gemini-offset', String(endGlobalOffset));
    }
    if (typeof orderIndex === 'number') {
      block.setAttribute('data-gemini-order', String(orderIndex));
    }
    authenticAddonElements.add(block);

    const shadow = block.attachShadow({ mode: 'closed' });
    applyShadowStyles(shadow);

    const surface = document.createElement('div');
    surface.className = 'gemini-trans-card-surface' + (isFull ? ' is-full' : '');

    const header = document.createElement('div');
    header.className = 'gemini-trans-header';

    const badge = document.createElement('div');
    badge.className = 'gemini-trans-badge';
    badge.appendChild(createSparkleIcon());

    const badgeText = document.createElement('span');
    badgeText.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('badgeTitle') : (isFull ? 'Gemini 全文翻訳' : 'Gemini 翻訳');
    badge.appendChild(badgeText);

    const delBtn = document.createElement('button');
    delBtn.className = 'gemini-trans-delete-btn';
    delBtn.setAttribute('title', (typeof I18n !== 'undefined') ? I18n.getMessage('btnDelete') : 'この翻訳を削除');
    delBtn.textContent = '×';

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      deleteTranslation(block);
    });

    header.appendChild(badge);
    header.appendChild(delBtn);

    const body = document.createElement('div');
    body.className = 'gemini-trans-body';
    body.textContent = translatedText;

    surface.appendChild(header);
    surface.appendChild(body);
    shadow.appendChild(surface);

    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCustomContextMenu(e.clientX, e.clientY, () => {
        deleteTranslation(block);
      });
    });

    return block;
  }

  /* ----------------------------------------------------
   * 4-2. メモカードDOMの生成とイベント登録 (Closed Shadow DOM)
   * ---------------------------------------------------- */
  function createMemoCard(memoData = {}, autoFocus = false) {
    const id = memoData.id || ('gm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7));
    const initialText = typeof memoData.memoText === 'string' ? memoData.memoText : '';
    const selectedText = typeof memoData.selectedText === 'string' ? memoData.selectedText : '';
    const endGlobalOffset = typeof memoData.endGlobalOffset === 'number' ? memoData.endGlobalOffset : null;
    const prefixContext = typeof memoData.prefixContext === 'string' ? memoData.prefixContext : '';
    const suffixContext = typeof memoData.suffixContext === 'string' ? memoData.suffixContext : '';
    let orderIndex = typeof memoData.orderIndex === 'number' ? memoData.orderIndex : 0;
    let ownerMessageId = memoData.headerMessageId || currentMessageId || null;

    const block = document.createElement('div');
    block.className = 'gemini-trans-block gemini-memo-block';
    block.setAttribute('data-gemini-memo-id', id);
    if (typeof endGlobalOffset === 'number') {
      block.setAttribute('data-gemini-offset', String(endGlobalOffset));
    }
    block.setAttribute('data-gemini-order', String(orderIndex));
    authenticAddonElements.add(block);

    const shadow = block.attachShadow({ mode: 'closed', delegatesFocus: true });
    applyShadowStyles(shadow);

    const surface = document.createElement('div');
    surface.className = 'gemini-trans-card-surface is-memo';

    const header = document.createElement('div');
    header.className = 'gemini-trans-header is-memo';

    const badge = document.createElement('div');
    badge.className = 'gemini-trans-badge is-memo';
    badge.appendChild(createMemoIcon());

    const badgeText = document.createElement('span');
    badgeText.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('memoBadgeTitle') : 'メモ';
    badge.appendChild(badgeText);

    const headerRight = document.createElement('div');
    headerRight.className = 'gemini-memo-header-right';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'gemini-memo-status';
    statusSpan.textContent = initialText
      ? ((typeof I18n !== 'undefined') ? I18n.getMessage('memoStatusSaved') : '保存済み')
      : '';

    const delBtn = document.createElement('button');
    delBtn.className = 'gemini-trans-delete-btn';
    const delTitle = (typeof I18n !== 'undefined') ? I18n.getMessage('btnDeleteMemo') : 'このメモを削除';
    delBtn.setAttribute('title', delTitle);
    delBtn.textContent = '×';

    let lastSavedText = initialText;
    let isDirty = false;
    let saveDebounceTimer = null;
    let isDeleted = false;

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      isDeleted = true;
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      deleteMemo(block, ownerMessageId);
    });

    headerRight.appendChild(statusSpan);
    headerRight.appendChild(delBtn);

    header.appendChild(badge);
    header.appendChild(headerRight);

    const textarea = document.createElement('textarea');
    textarea.className = 'gemini-memo-textarea';
    textarea.placeholder = (typeof I18n !== 'undefined') ? I18n.getMessage('memoPlaceholder') : 'ここにメモを入力...';
    textarea.value = initialText;
    textarea.rows = 2;

    function adjustTextareaHeight() {
      textarea.style.height = 'auto';
      const nextHeight = Math.max(54, textarea.scrollHeight);
      textarea.style.height = `${nextHeight}px`;
    }

    async function persistMemo(force = false) {
      if (isDeleted) return;
      if (!force && !isDirty && textarea.value === lastSavedText) return;
      isDirty = false;
      lastSavedText = textarea.value;

      const targetMsgId = ownerMessageId || currentMessageId;
      try {
        const domOrder = block.getAttribute('data-gemini-order');
        const currentOrder = (domOrder !== null && domOrder !== '' && !isNaN(Number(domOrder)))
          ? Number(domOrder)
          : (typeof orderIndex === 'number' ? orderIndex : 0);

        const domOffset = block.getAttribute('data-gemini-offset');
        const currentOffset = (domOffset !== null && domOffset !== '' && !isNaN(Number(domOffset)))
          ? Number(domOffset)
          : endGlobalOffset;

        const res = await safeSendMessage({
          action: 'SAVE_MEMO_RECORD',
          headerMessageId: targetMsgId,
          memo: {
            id: id,
            memoText: textarea.value,
            selectedText: selectedText,
            endGlobalOffset: currentOffset,
            prefixContext: prefixContext,
            suffixContext: suffixContext,
            orderIndex: currentOrder
          }
        });
        if (res && res.headerMessageId) {
          if (!ownerMessageId) ownerMessageId = res.headerMessageId;
          if (!currentMessageId) currentMessageId = res.headerMessageId;
        }
        if (!isDeleted) {
          statusSpan.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('memoStatusSaved') : '保存済み';
        }
      } catch (err) {
        console.warn('[ThunderTranslate] Failed to auto-save memo:', err);
      }
    }

    textarea.addEventListener('input', () => {
      adjustTextareaHeight();
      if (textarea.value === lastSavedText) {
        isDirty = false;
        statusSpan.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('memoStatusSaved') : '保存済み';
        if (saveDebounceTimer) {
          clearTimeout(saveDebounceTimer);
          saveDebounceTimer = null;
        }
        return;
      }
      isDirty = true;
      statusSpan.textContent = (typeof I18n !== 'undefined') ? I18n.getMessage('memoStatusSaving') : '保存中...';
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
      saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = null;
        persistMemo();
      }, 150);
    });

    const flushSave = () => {
      if (!isDirty && !saveDebounceTimer) {
        return;
      }
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }
      if (isDirty) {
        persistMemo();
      }
    };

    textarea.addEventListener('blur', flushSave);
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);

    // Thunderbird本体の単一キーショートカット (R:返信, A:アーカイブ, M:既読, J/K, Delete等) が
    // メモ入力中に誤発動しないようキーイベントの伝播を遮断
    const stopKeyPropagation = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        textarea.blur();
        return;
      }
      e.stopPropagation();
    };
    textarea.addEventListener('keydown', stopKeyPropagation);
    textarea.addEventListener('keyup', (e) => e.stopPropagation());
    textarea.addEventListener('keypress', (e) => e.stopPropagation());

    // テキストエリア内の右クリックは標準のコピー・貼り付けメニューを許可
    textarea.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
    });

    // メモカード内のクリックが親リンクや本文イベントへ伝播してリンク誤発動等を起こさないよう遮断
    block.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    textarea.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    surface.appendChild(header);
    surface.appendChild(textarea);
    shadow.appendChild(surface);

    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCustomContextMenu(
        e.clientX,
        e.clientY,
        () => {
          isDeleted = true;
          if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
          deleteMemo(block, ownerMessageId);
        },
        delTitle
      );
    });

    function focusTextarea() {
      try {
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      } catch (_) {}
    }

    requestAnimationFrame(() => {
      adjustTextareaHeight();
      if (autoFocus) {
        focusTextarea();
      }
    });

    return {
      block,
      persistMemo,
      focusTextarea,
      textarea,
      setOrderIndex: (newOrder) => {
        orderIndex = newOrder;
        block.setAttribute('data-gemini-order', String(newOrder));
      }
    };
  }

  /* ----------------------------------------------------
   * 5. 右クリックメニュー (インライン)
   * ---------------------------------------------------- */
  function closeCustomContextMenu() {
    if (activeContextMenu && activeContextMenu.parentNode) {
      activeContextMenu.parentNode.removeChild(activeContextMenu);
      activeContextMenu = null;
    }
  }

  function showCustomContextMenu(x, y, onDeleteCallback, customLabel = null) {
    closeCustomContextMenu();

    const menu = document.createElement('div');
    menu.className = 'gemini-custom-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    authenticAddonElements.add(menu);

    const item = document.createElement('div');
    item.className = 'gemini-custom-context-menu-item';

    const iconSpan = document.createElement('span');
    iconSpan.textContent = '🗑️';

    const textSpan = document.createElement('span');
    textSpan.textContent = customLabel || ((typeof I18n !== 'undefined') ? I18n.getMessage('btnDelete') : 'この翻訳を削除');

    item.appendChild(iconSpan);
    item.appendChild(textSpan);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCustomContextMenu();
      onDeleteCallback();
    });

    menu.appendChild(item);
    (document.body || document.documentElement).appendChild(menu);
    activeContextMenu = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(10, window.innerWidth - rect.width - 10)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(10, window.innerHeight - rect.height - 10)}px`;
    }
  }

  document.addEventListener('click', () => {
    if (activeContextMenu) {
      closeCustomContextMenu();
    }
  });

  /* ----------------------------------------------------
   * 6. 翻訳データおよびメモデータの削除
   * ---------------------------------------------------- */
  async function deleteTranslation(blockElement) {
    if (!authenticAddonElements.has(blockElement)) return;
    const isFull = blockElement.getAttribute('data-gemini-full') === 'true';
    const id = blockElement.getAttribute('data-gemini-id');
    const offStr = blockElement.getAttribute('data-gemini-offset');
    const endGlobalOffset = (offStr !== null && offStr !== '') ? Number(offStr) : null;

    const prevBr = blockElement.previousSibling;
    const nextBr = blockElement.nextSibling;
    if (prevBr && prevBr.nodeName === 'BR') prevBr.remove();
    if (nextBr && nextBr.nodeName === 'BR') nextBr.remove();
    blockElement.remove();

    if (typeof endGlobalOffset === 'number') {
      syncOrderIndicesAtOffset(endGlobalOffset);
    }

    await safeSendMessage({
      action: 'DELETE_TRANSLATION_RECORD',
      headerMessageId: currentMessageId,
      isFull: isFull,
      id: id
    });
  }

  async function deleteMemo(blockElement, ownerMessageId = null) {
    if (!authenticAddonElements.has(blockElement)) return;
    const id = blockElement.getAttribute('data-gemini-memo-id');
    const offStr = blockElement.getAttribute('data-gemini-offset');
    const endGlobalOffset = (offStr !== null && offStr !== '') ? Number(offStr) : null;

    const prevBr = blockElement.previousSibling;
    const nextBr = blockElement.nextSibling;
    if (prevBr && prevBr.nodeName === 'BR') prevBr.remove();
    if (nextBr && nextBr.nodeName === 'BR') nextBr.remove();
    blockElement.remove();

    if (typeof endGlobalOffset === 'number') {
      syncOrderIndicesAtOffset(endGlobalOffset);
    }

    await safeSendMessage({
      action: 'DELETE_MEMO_RECORD',
      headerMessageId: ownerMessageId || currentMessageId,
      id: id
    });

    showToast((typeof I18n !== 'undefined') ? I18n.getMessage('toastMemoDeleted') : 'メモを削除しました。');
  }

  /* ----------------------------------------------------
   * 6-2. 当該メールの全翻訳を一括削除（ユーザー作成メモは保持）
   * ---------------------------------------------------- */
  async function clearAllTranslationsFromDom(notifyBackground = true) {
    lastRestoredMessageId = null;
    neutralizeSpoofedAddonElements(document.body);
    const blocks = document.querySelectorAll('.gemini-trans-block:not(.gemini-memo-block)');
    let count = 0;
    blocks.forEach((block) => {
      if (!authenticAddonElements.has(block)) return;
      const prevBr = block.previousSibling;
      const nextBr = block.nextSibling;
      if (prevBr && prevBr.nodeName === 'BR') prevBr.remove();
      if (nextBr && nextBr.nodeName === 'BR') nextBr.remove();
      block.remove();
      count++;
    });

    if (notifyBackground) {
      await safeSendMessage({
        action: 'CLEAR_ALL_TRANSLATIONS_FOR_MESSAGE',
        headerMessageId: currentMessageId
      });
    }

    if (count > 0) {
      showToast((typeof I18n !== 'undefined') ? I18n.getMessage('toastDeleteSuccess') : '翻訳を削除しました。');
    }
  }

  /* ----------------------------------------------------
   * 7. グローバル文字オフセット計算と位置特定
   * ---------------------------------------------------- */
  // 本文内テキストノード用のTreeWalkerフィルター（正規の翻訳カードのみ除外）
  function createCleanTextWalker(root = document.body) {
    return document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.parentElement && isAuthenticAddonNode(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
  }

  /**
   * 選択範囲(range)の終了位置における本文全体の累積文字オフセット(endGlobalOffset)を算出
   */
  function getGlobalOffset(range, root = document.body) {
    if (!range || !root) return null;

    const endContainer = range.endContainer;
    const endOffset = range.endOffset;

    const walker = createCleanTextWalker(root);
    let accumulated = 0;
    let node;
    let found = false;

    while ((node = walker.nextNode())) {
      const len = node.nodeValue ? node.nodeValue.length : 0;
      if (node === endContainer) {
        accumulated += Math.min(endOffset, len);
        found = true;
        break;
      }

      // endContainer が要素ノードの場合 (子ノード境界を指しているケース)
      if (endContainer.nodeType !== Node.TEXT_NODE) {
        try {
          if (range.comparePoint(node, 0) >= 0) {
            found = true;
            break;
          }
        } catch (_) {}
      }

      accumulated += len;
    }

    return found ? accumulated : null;
  }

  /**
   * 本文内のテキストノードを1回だけ走査してオフセットインデックスを構築（二分探索 O(log N) 対応）
   */
  function buildCleanTextIndex(root = document.body) {
    const walker = createCleanTextWalker(root);
    const spans = []; // { node, start, len, text }
    let totalLength = 0;
    let fullTextCache = null;
    let node;

    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      const len = text.length;
      spans.push({ node, start: totalLength, len, text });
      totalLength += len;
    }

    function getNodeAndOffsetAt(globalOffset) {
      if (typeof globalOffset !== 'number' || globalOffset < 0 || spans.length === 0) {
        return null;
      }
      let low = 0;
      let high = spans.length - 1;
      let matchedIdx = spans.length - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const span = spans[mid];
        if (span.start + span.len >= globalOffset) {
          matchedIdx = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      const target = spans[matchedIdx];
      const relOffset = Math.max(0, Math.min(target.len, globalOffset - target.start));
      const currentNodeLen = target.node.nodeValue ? target.node.nodeValue.length : 0;
      if (relOffset <= currentNodeLen && target.node.isConnected) {
        return { node: target.node, offset: relOffset };
      }
      return getNodeAndOffsetAtGlobal(globalOffset, root);
    }

    function getFullText() {
      if (fullTextCache === null) {
        fullTextCache = spans.map((s) => s.text).join('');
      }
      return fullTextCache;
    }

    return {
      spans,
      totalLength,
      hasTextNodes: spans.length > 0,
      getNodeAndOffsetAt,
      getFullText
    };
  }

  /**
   * 累積文字オフセット(globalOffset)から、該当するテキストノードとノード内オフセットを逆算
   */
  function getNodeAndOffsetAtGlobal(globalOffset, root = document.body) {
    if (typeof globalOffset !== 'number' || globalOffset < 0 || !root) return null;

    const walker = createCleanTextWalker(root);
    let accumulated = 0;
    let lastNode = null;
    let node;

    while ((node = walker.nextNode())) {
      lastNode = node;
      const len = node.nodeValue ? node.nodeValue.length : 0;
      if (accumulated + len >= globalOffset) {
        const offset = Math.max(0, Math.min(len, globalOffset - accumulated));
        return { node, offset };
      }
      accumulated += len;
    }

    if (lastNode) {
      return { node: lastNode, offset: lastNode.nodeValue ? lastNode.nodeValue.length : 0 };
    }
    return null;
  }

  /**
   * 全文結合テキストと二分探索による高精度テキストマッチング
   * 複数ノードやHTMLタグにまたがるテキストでも1回のTreeWalker走査（または事前構築インデックス）で完全に特定可能
   */
  function findTargetByTextSearch(selectedText, prefixContext, suffixContext, root = document.body, textIndex = null) {
    if (!selectedText || !root) return null;

    const idxObj = textIndex || buildCleanTextIndex(root);
    const fullText = idxObj.getFullText();
    if (!fullText || !idxObj.hasTextNodes) return null;

    // 1. 完全一致検索
    let searchIndex = 0;
    const matches = [];
    while (searchIndex < fullText.length) {
      const idx = fullText.indexOf(selectedText, searchIndex);
      if (idx === -1) break;
      matches.push(idx);
      searchIndex = idx + 1;
    }

    // 2. 空白・改行の正規化フォールバック（連続改行や空白の揺れを吸収）
    if (matches.length === 0) {
      const normSelected = selectedText.replace(/\s+/g, ' ').trim();
      const normFull = fullText.replace(/\s+/g, ' ');
      const normIdx = normFull.indexOf(normSelected);
      if (normIdx !== -1) {
        const ratio = (normIdx + normSelected.length) / (normFull.length || 1);
        const approxCharIdx = Math.min(fullText.length, Math.floor(ratio * fullText.length));
        return idxObj.getNodeAndOffsetAt(approxCharIdx);
      }
      return null;
    }

    // 3. prefixContext, suffixContext によるスコアリング
    let bestIdx = matches[0];
    let bestScore = -1;

    for (const idx of matches) {
      let score = 10;
      if (prefixContext) {
        const pre = fullText.substring(Math.max(0, idx - prefixContext.length), idx);
        if (prefixContext.endsWith(pre) || pre.endsWith(prefixContext)) {
          score += 20;
        }
      }
      if (suffixContext) {
        const suf = fullText.substring(idx + selectedText.length, idx + selectedText.length + suffixContext.length);
        if (suffixContext.startsWith(suf) || suf.startsWith(suffixContext)) {
          score += 20;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    const endCharIdx = bestIdx + selectedText.length;
    return idxObj.getNodeAndOffsetAt(endCharIdx);
  }

  /**
   * 指定ノードまたはその親祖先ノードから最も近い <a> 要素を探索
   */
  function findEnclosingAnchor(node) {
    if (!node) return null;
    let curr = (node.nodeType === Node.TEXT_NODE) ? node.parentNode : node;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.nodeType === Node.ELEMENT_NODE && curr.tagName === 'A') {
        return curr;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  /**
   * 復元用の統合位置探索関数（事前構築された textIndex があれば O(log N) で高速解決）
   */
  function findInsertionPoint(item, root = document.body, textIndex = null) {
    // 1. グローバル文字オフセットによる直接復元 (最優先・最も正確)
    if (typeof item.endGlobalOffset === 'number' && item.endGlobalOffset >= 0) {
      const point = textIndex
        ? textIndex.getNodeAndOffsetAt(item.endGlobalOffset)
        : getNodeAndOffsetAtGlobal(item.endGlobalOffset, root);
      if (point && point.node) {
        return point;
      }
    }

    // 2. 全文結合テキスト検索 (複数ノードまたがり・空白正規化対応)
    return findTargetByTextSearch(item.selectedText, item.prefixContext, item.suffixContext, root, textIndex);
  }

  /**
   * 同一個所に存在する1つまたは複数のカードを DocumentFragment で一括して順序通り（orderIndex昇順）に挿入
   * （複数回の insertBefore による不要なDOMリフローを1回に最小化）
   */
  function insertCardGroupAt(point, cardElements) {
    if (!cardElements || cardElements.length === 0) return;

    const validElements = cardElements.filter(Boolean);
    if (validElements.length === 0) return;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('br'));
    for (const el of validElements) {
      fragment.appendChild(el);
    }
    fragment.appendChild(document.createElement('br'));

    if (!point || !point.node) {
      if (document.body) {
        document.body.appendChild(fragment);
      }
      return;
    }

    const { node, offset = 0, isBlock = false } = point;

    // もし挿入対象ノードまたは親要素が <a> タグの場合、リンクの外（<a> の直後）に配置する
    const anchor = findEnclosingAnchor(node);
    if (anchor) {
      const parent = anchor.parentNode || document.body;
      parent.insertBefore(fragment, anchor.nextSibling);
      return;
    }

    if (isBlock) {
      const parent = node.parentNode || document.body;
      parent.insertBefore(fragment, node.nextSibling);
      return;
    }

    const parent = node.parentNode || document.body;
    let refNode = node;

    if (node.nodeType === Node.TEXT_NODE) {
      const textLen = node.nodeValue ? node.nodeValue.length : 0;
      if (offset > 0 && offset < textLen) {
        refNode = node.splitText(offset);
      } else if (offset >= textLen) {
        refNode = node.nextSibling;
      } else {
        refNode = node;
      }
    } else {
      refNode = node.nextSibling;
    }

    parent.insertBefore(fragment, refNode);
  }

  /**
   * 特定された位置に、直前の改行、単一カード、直後の改行を割り込み挿入
   */
  function insertTranslationCardAt(point, cardElement) {
    if (!cardElement) return;
    insertCardGroupAt(point, [cardElement]);
  }

  /**
   * 指定された endGlobalOffset (または同一位置) に既に存在するカード要素群を
   * DOMツリーの出現順（上から下）にソートして取得
   */
  function findExistingCardsAtOffset(endGlobalOffset) {
    if (typeof endGlobalOffset !== 'number' || !document.body) return [];
    const matched = [];
    const allBlocks = document.body.querySelectorAll('.gemini-trans-block:not(.gemini-full-trans-block)');
    for (const block of allBlocks) {
      if (!authenticAddonElements.has(block)) continue;
      const offStr = block.getAttribute('data-gemini-offset');
      if (offStr !== null && offStr !== '' && Number(offStr) === endGlobalOffset) {
        matched.push(block);
      }
    }
    if (matched.length > 1) {
      // DOMツリーの出現順（上から下）を厳密な推移的順序で保証
      matched.sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
    }
    return matched;
  }

  /**
   * 同位置にあるカード群の orderIndex をDOM上の出現順に再整流化（0, 1, 2...）し、
   * 変更分をバックグラウンドストレージへ非同期同期する
   */
  async function syncOrderIndicesAtOffset(endGlobalOffset) {
    if (typeof endGlobalOffset !== 'number' || !document.body) return;
    const cards = findExistingCardsAtOffset(endGlobalOffset);
    if (cards.length === 0) return;

    const updates = [];
    cards.forEach((card, idx) => {
      card.setAttribute('data-gemini-order', String(idx));
      card.setAttribute('data-gemini-offset', String(endGlobalOffset));

      const transId = card.getAttribute('data-gemini-id');
      const memoId = card.getAttribute('data-gemini-memo-id');

      if (transId) {
        updates.push({ type: 'translation', id: transId, orderIndex: idx });
      } else if (memoId) {
        updates.push({ type: 'memo', id: memoId, orderIndex: idx });
      }
    });

    if (updates.length > 0) {
      await safeSendMessage({
        action: 'UPDATE_CARDS_ORDER',
        headerMessageId: currentMessageId || null,
        updates
      }).catch((err) => {
        console.warn('[ThunderTranslate] Error syncing cards order:', err);
      });
    }
  }

  /**
   * 単一カードをスマート挿入
   * 同位置に既存カードがある場合、ユーザーの挿入位置（range/point）に応じて
   * 既存カードの前・間・後の任意の位置に挿入し、orderIndexを自動採番・再整流化する
   */
  function insertSmartCardAt({ range, endGlobalOffset, cardElement, selectedText, prefixContext, suffixContext }) {
    if (typeof endGlobalOffset === 'number') {
      const existingCards = findExistingCardsAtOffset(endGlobalOffset);
      if (existingCards.length > 0) {
        // ユーザーの指定位置（range または point）に基づいて挿入スロット (0 〜 existingCards.length) を決定
        let insertIndex = existingCards.length; // デフォルトは最後尾

        if (range) {
          for (let i = 0; i < existingCards.length; i++) {
            const card = existingCards[i];
            let isBeforeCard = false;

            // 1. 同一親ノード内での childNodes インデックス直接比較（最も高精度）
            if (range.startContainer && range.startContainer === card.parentNode) {
              const childNodes = Array.from(card.parentNode.childNodes);
              const cardIndex = childNodes.indexOf(card);
              if (cardIndex !== -1 && range.startOffset <= cardIndex) {
                isBeforeCard = true;
              }
            } else {
              // 2. DOM ツリー位置比較
              try {
                const pos = range.startContainer.compareDocumentPosition(card);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                  isBeforeCard = true;
                }
              } catch (_) {
                try {
                  if (range.comparePoint(card, 0) >= 0) {
                    isBeforeCard = true;
                  }
                } catch (_) {}
              }
            }

            // 3. 右クリック Y 座標による視覚的境界フォールバック判定
            if (!isBeforeCard && typeof lastContextMenuY === 'number' && lastContextMenuY > 0) {
              try {
                const rect = card.getBoundingClientRect();
                if (rect.top > 0 && lastContextMenuY < (rect.top + rect.height / 2)) {
                  isBeforeCard = true;
                }
              } catch (_) {}
            }

            if (isBeforeCard) {
              insertIndex = i;
              break;
            }
          }
        } else {
          const point = findInsertionPoint({
            selectedText,
            endGlobalOffset,
            prefixContext,
            suffixContext
          }, document.body);
          if (point && point.node) {
            for (let i = 0; i < existingCards.length; i++) {
              const card = existingCards[i];
              const pos = point.node.compareDocumentPosition(card);
              if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                insertIndex = i;
                break;
              }
            }
          }
        }

        cardElement.setAttribute('data-gemini-offset', String(endGlobalOffset));
        cardElement.setAttribute('data-gemini-order', String(insertIndex));

        // 決定したスロット位置に応じてDOMへ挿入
        if (insertIndex === 0) {
          // 先頭に挿入: 既存先頭カードの手前に配置
          const firstCard = existingCards[0];
          if (firstCard && firstCard.parentNode) {
            firstCard.parentNode.insertBefore(cardElement, firstCard);
          }
        } else if (insertIndex < existingCards.length) {
          // 既存カード同士の間に挿入: 対象カードの手前に配置
          const targetCard = existingCards[insertIndex];
          if (targetCard && targetCard.parentNode) {
            targetCard.parentNode.insertBefore(cardElement, targetCard);
          }
        } else {
          // 最後尾に挿入: 既存最後尾カードの直後に配置
          const lastCard = existingCards[existingCards.length - 1];
          if (lastCard && lastCard.parentNode) {
            lastCard.parentNode.insertBefore(cardElement, lastCard.nextSibling);
          }
        }

        // 挿入後、同位置の全カードの orderIndex を再整流化してストレージと同期
        syncOrderIndicesAtOffset(endGlobalOffset);

        return insertIndex;
      }
    }

    // 既存カードがない場合：最初のカード (orderIndex: 0)
    cardElement.setAttribute('data-gemini-order', '0');
    if (typeof endGlobalOffset === 'number') {
      cardElement.setAttribute('data-gemini-offset', String(endGlobalOffset));
    }

    if (range) {
      const cloneRange = range.cloneRange();
      cloneRange.collapse(false);
      const anchor = findEnclosingAnchor(cloneRange.endContainer);
      if (anchor) {
        cloneRange.setStartAfter(anchor);
        cloneRange.collapse(true);
      }
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createElement('br'));
      frag.appendChild(cardElement);
      frag.appendChild(document.createElement('br'));
      cloneRange.insertNode(frag);
    } else {
      const point = findInsertionPoint({
        selectedText,
        endGlobalOffset,
        prefixContext,
        suffixContext
      }, document.body);
      insertTranslationCardAt(point, cardElement);
    }

    return 0;
  }

  /* ----------------------------------------------------
   * 7-2. 不可視テキスト攻撃対策: DOM / CSS 隠し要素フィルタリング
   * (font-size:0, opacity:0, 透明文字, 背景同色文字, 画面外配置, 0サイズoverflow:hidden, 既存翻訳ブロック等を除外)
   * ---------------------------------------------------- */
  const CSS_RGB_REGEX = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i;
  const TRANSPARENT_COLOR = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
  const BLACK_COLOR = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
  const WHITE_COLOR = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });

  function parseCssColor(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') {
      return TRANSPARENT_COLOR;
    }
    if (colorStr === 'rgb(0, 0, 0)') return BLACK_COLOR;
    if (colorStr === 'rgb(255, 255, 255)') return WHITE_COLOR;
    const match = CSS_RGB_REGEX.exec(colorStr);
    if (!match) return null;
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1
    };
  }

  function getEffectiveBackgroundColor(el, bgCache) {
    if (bgCache.has(el)) {
      return bgCache.get(el);
    }
    let curr = el;
    const chain = [];
    let resolved = null;
    let depth = 0;

    while (curr && curr.nodeType === Node.ELEMENT_NODE && depth < MAX_ANCESTOR_DEPTH) {
      depth++;
      if (bgCache.has(curr)) {
        resolved = bgCache.get(curr);
        break;
      }
      chain.push(curr);
      const style = window.getComputedStyle(curr);
      const bg = parseCssColor(style.backgroundColor);
      if (bg && bg.a >= 0.15) {
        resolved = bg;
        break;
      }
      curr = curr.parentElement;
    }

    for (const node of chain) {
      bgCache.set(node, resolved);
    }
    return resolved;
  }

  function isDeceptivelyHiddenElement(el, style, bgCache) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

    // 正規の翻訳カード・アドオンUI要素のみ抽出対象外とする（偽造カードは除外せず本文として扱う: 1.①）
    if (authenticAddonElements.has(el)) {
      return true;
    }

    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG') {
      return true;
    }

    if (el.hidden || el.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
      return true;
    }

    // 1. 極端な透明化 (opacity < 0.05) - 子要素も含め全体が透明化される
    const opacity = parseFloat(style.opacity);
    if (!isNaN(opacity) && opacity < 0.05) {
      return true;
    }

    // 2. 極小フォントサイズ (font-size < 2px) & 3. 背景同色カモフラージュ文字
    // 注意: MJML等のレスポンシブHTMLメールでは、段組みカラム間の不要な半角スペース隙間を防ぐため
    // 親コンテナ(td/div)に font-size: 0px を指定し、子要素(h1/p/span)に 16px 等を指定する標準設計が取られます。
    // 子要素を持つコンテナ(childElementCount > 0)を非表示にすると可視本文が道連れで消滅するため、
    // フォントサイズおよび文字色・カモフラージュ判定は末端要素(childElementCount === 0)にのみ適用します。
    const isLeaf = (el.childElementCount === 0);
    if (isLeaf) {
      const fontSize = parseFloat(style.fontSize);
      if (!isNaN(fontSize) && fontSize < 2) {
        return true;
      }

      // 透明テキストカラー または 背景色と同色のカモフラージュ文字
      const fg = parseCssColor(style.color);
      if (fg) {
        if (fg.a < 0.05) {
          return true;
        }
        const bg = getEffectiveBackgroundColor(el, bgCache);
        if (bg && bg.a >= 0.15) {
          const colorDiff = Math.abs(fg.r - bg.r) + Math.abs(fg.g - bg.g) + Math.abs(fg.b - bg.b);
          if (colorDiff < 12) {
            return true;
          }
        }
      }
    }

    // 4. サイズ0 + overflow:hidden / clip による不可視領域化
    const ov = style.overflow;
    const ovX = style.overflowX;
    const ovY = style.overflowY;
    if (ov === 'hidden' || ov === 'clip' || ovX === 'hidden' || ovX === 'clip' || ovY === 'hidden' || ovY === 'clip') {
      const maxH = parseFloat(style.maxHeight);
      const maxW = parseFloat(style.maxWidth);
      const h = parseFloat(style.height);
      const w = parseFloat(style.width);
      if (maxH === 0 || maxW === 0 || h === 0 || w === 0) {
        return true;
      }
    }

    // 5. clip / clip-path / transform:scale(0) による不可視化
    if (
      style.clip === 'rect(0px, 0px, 0px, 0px)' ||
      style.clipPath === 'inset(100%)' ||
      style.clipPath === 'circle(0px)' ||
      style.transform === 'scale(0)' ||
      style.transform === 'matrix(0, 0, 0, 0, 0, 0)'
    ) {
      return true;
    }

    // 6. 画面外への極端なオフスクリーン配置 (left/top < -1000px, text-indent < -500px)
    if (style.position === 'absolute' || style.position === 'fixed') {
      const left = parseFloat(style.left);
      const top = parseFloat(style.top);
      if ((!isNaN(left) && left < -1000) || (!isNaN(top) && top < -1000)) {
        return true;
      }
    }
    const textIndent = parseFloat(style.textIndent);
    if (!isNaN(textIndent) && textIndent < -500) {
      return true;
    }

    return false;
  }

  /**
   * 1.② フィッシングリンク・表示URL偽装・IDNホモグラフ（Punycode）検知ヘルパー
   * <a>タグの表示テキストがURL/ドメイン形式であるにもかかわらず実際のリンク先ホストと異なる場合、
   * またはリンク先が Punycode (xn--) や危険スキーム (javascript:/data:) の場合に警告注釈を返す
   */
  function inspectSuspiciousLink(anchorEl) {
    if (!anchorEl || anchorEl.tagName !== 'A') return null;
    const rawHref = (anchorEl.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || /^mailto:|^tel:|^cid:/i.test(rawHref)) {
      return null;
    }

    if (/^(?:javascript|data|vbscript):/i.test(rawHref)) {
      const scheme = rawHref.split(':')[0].toLowerCase();
      return ` [⚠️SECURITY WARNING: Suspicious non-HTTP link scheme "${scheme}:" detected]`;
    }

    let actualUrl;
    try {
      actualUrl = new URL(rawHref, window.location.href);
    } catch (_) {
      return null;
    }

    if (actualUrl.protocol !== 'http:' && actualUrl.protocol !== 'https:') {
      return null;
    }

    const actualHost = (actualUrl.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!actualHost) return null;

    const warnings = [];

    // 1. IDN ホモグラフ攻撃 (Punycode: xn--) の検知
    if (actualHost.includes('xn--')) {
      warnings.push(`IDN/Punycode domain "${actualHost}"`);
    }

    // 2. アンカー表示テキストがURLまたはドメイン名に見えるのに実際の遷移先ドメインと一致しないケースを検知
    const visibleText = (anchorEl.textContent || '').trim();
    if (visibleText && !visibleText.includes('@') && visibleText.length <= 300) {
      const urlLikeMatch = visibleText.match(/^(?:https?:\/\/)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?:[/?#:]|\s|$)/i);
      if (urlLikeMatch && urlLikeMatch[1]) {
        const displayedHost = urlLikeMatch[1].toLowerCase().replace(/^www\./, '');
        // 共通のTLD/ドメイン階層を持たない別ドメインへの誘導を検知
        if (
          displayedHost !== actualHost &&
          !actualHost.endsWith('.' + displayedHost) &&
          !displayedHost.endsWith('.' + actualHost)
        ) {
          warnings.push(`Displayed link text claims "${displayedHost}" but actual href destination is "${actualHost}" (${actualUrl.origin})`);
        }
      }
    }

    if (warnings.length === 0) return null;
    return ` [⚠️SECURITY WARNING - Phishing/Deceptive Link Detected: ${warnings.join('; ')}]`;
  }

  /**
   * 不可視要素および翻訳ブロックを一時的に display:none にし、不審なリンクに一時的な注釈ノードを付与して
   * コールバック（innerText / selection.toString）を実行後、同一同期フレーム内で即座に元のDOM状態へ復元する
   */
  function withHiddenDeceptiveElements(root, extractFn) {
    if (!root) return extractFn();

    // 1.① 偽造カードのクラス・属性を先に無害化
    neutralizeSpoofedAddonElements(root);

    const bgCache = new Map();
    const rootStyle = window.getComputedStyle(root);
    const rootBg = parseCssColor(rootStyle.backgroundColor);
    bgCache.set(root, (rootBg && rootBg.a >= 0.15) ? rootBg : null);

    const modifiedElements = [];
    const injectedLinkNotes = [];
    let scannedNodes = 0;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (scannedNodes >= MAX_DOM_SCAN_NODES) {
            return NodeFilter.FILTER_REJECT;
          }
          scannedNodes++;

          const style = window.getComputedStyle(node);
          if (style.display === 'none') {
            return NodeFilter.FILTER_REJECT;
          }

          // 親→子の順で走査されるため、ここで実効背景色を bgCache に前計算して O(1) 参照化
          const ownBg = parseCssColor(style.backgroundColor);
          if (ownBg && ownBg.a >= 0.15) {
            bgCache.set(node, ownBg);
          } else if (node.parentElement && bgCache.has(node.parentElement)) {
            bgCache.set(node, bgCache.get(node.parentElement));
          }

          if (isDeceptivelyHiddenElement(node, style, bgCache)) {
            modifiedElements.push({
              el: node,
              prevValue: node.style.getPropertyValue('display'),
              prevPriority: node.style.getPropertyPriority('display')
            });
            node.style.setProperty('display', 'none', 'important');
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    try {
      let currentElem;
      while (scannedNodes < MAX_DOM_SCAN_NODES && (currentElem = walker.nextNode())) {
        // 1.② 可視の <a> タグに対してリンク偽装・Punycode検査を実行し、抽出時のみ一時注釈を付与
        if (currentElem.tagName === 'A') {
          const warningNote = inspectSuspiciousLink(currentElem);
          if (warningNote) {
            const tempSpan = document.createElement('span');
            tempSpan.textContent = warningNote;
            currentElem.appendChild(tempSpan);
            injectedLinkNotes.push(tempSpan);
          }
        }
      }
      return extractFn();
    } finally {
      for (let i = injectedLinkNotes.length - 1; i >= 0; i--) {
        const span = injectedLinkNotes[i];
        if (span.parentNode) {
          span.parentNode.removeChild(span);
        }
      }
      for (let i = modifiedElements.length - 1; i >= 0; i--) {
        const item = modifiedElements[i];
        if (item.prevValue) {
          item.el.style.setProperty('display', item.prevValue, item.prevPriority);
        } else {
          item.el.style.removeProperty('display');
        }
      }
    }
  }

  /* ----------------------------------------------------
   * 8. 全文翻訳の表示・トグル
   * ---------------------------------------------------- */
  async function toggleFullTranslation() {
    if (isTogglingFull) {
      return;
    }
    isTogglingFull = true;

    try {
      const existingBlock = findAuthenticFullTransBlock();

      if (existingBlock && existingBlock.style.display !== 'none' && !existingBlock.classList.contains('gemini-trans-loading')) {
        existingBlock.style.display = 'none';
        await safeSendMessage({
          action: 'UPDATE_FULL_TRANSLATION_VISIBILITY',
          headerMessageId: currentMessageId,
          hidden: true
        });
        return;
      }

      if (existingBlock && existingBlock.style.display === 'none') {
        existingBlock.style.display = 'block';
        await safeSendMessage({
          action: 'UPDATE_FULL_TRANSLATION_VISIBILITY',
          headerMessageId: currentMessageId,
          hidden: false
        });
        return;
      }

      const rawFullText = document.body
        ? withHiddenDeceptiveElements(document.body, () => document.body.innerText.trim())
        : '';
      const fullText = truncateByUtf8Bytes(rawFullText, maxTranslationChars);
      if (!fullText) {
        showToast((typeof I18n !== 'undefined') ? I18n.getMessage('errNoTextFound') : 'エラーが発生しました ： メール本文が空です。');
        return;
      }

      const loadingCard = createLoadingCard(true);
      if (document.body && document.body.firstChild) {
        document.body.insertBefore(loadingCard, document.body.firstChild);
      } else if (document.body) {
        document.body.appendChild(loadingCard);
      }

      await executeTranslation({
        text: fullText,
        isFull: true,
        loadingElement: loadingCard
      });
    } finally {
      setTimeout(() => {
        isTogglingFull = false;
      }, 500);
    }
  }

  /* ----------------------------------------------------
   * 9. 選択範囲の翻訳実行
   * ---------------------------------------------------- */
  async function translateSelection(fallbackText = '') {
    if (isTranslatingSelection) {
      return;
    }
    isTranslatingSelection = true;

    try {
      const selection = window.getSelection();
      let prefixContext = '';
      let suffixContext = '';
      let range = null;
      let endGlobalOffset = null;

      if (selection && selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
        endGlobalOffset = getGlobalOffset(range, document.body);

        const startNode = range.startContainer;
        if (startNode && startNode.nodeType === Node.TEXT_NODE) {
          const text = startNode.textContent;
          prefixContext = text.substring(Math.max(0, range.startOffset - 30), range.startOffset);
        }
        const endNode = range.endContainer;
        if (endNode && endNode.nodeType === Node.TEXT_NODE) {
          const text = endNode.textContent;
          suffixContext = text.substring(range.endOffset, Math.min(text.length, range.endOffset + 30));
        }
      }

      // ユーザーが可視画面で選択したテキストを取得（DOM変更を行わず選択範囲の崩壊を防止）
      let selectedText = (selection && selection.toString) ? selection.toString().trim() : '';

      if (!selectedText && fallbackText) {
        selectedText = fallbackText.trim();
      }

      selectedText = truncateByUtf8Bytes(selectedText, maxTranslationChars);

      if (!selectedText) {
        showToast((typeof I18n !== 'undefined') ? I18n.getMessage('toastSelectText') : 'エラーが発生しました ： 翻訳するテキストが選択されていません。');
        return;
      }

      const transId = 'gt-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
      const loadingCard = createLoadingCard(false, { endGlobalOffset });

      const assignedOrder = insertSmartCardAt({
        range,
        endGlobalOffset,
        cardElement: loadingCard,
        selectedText,
        prefixContext,
        suffixContext
      });

      await executeTranslation({
        text: selectedText,
        isFull: false,
        transId: transId,
        endGlobalOffset: endGlobalOffset,
        orderIndex: assignedOrder,
        prefixContext,
        suffixContext,
        loadingElement: loadingCard
      });
    } finally {
      setTimeout(() => {
        isTranslatingSelection = false;
      }, 500);
    }
  }

  /* ----------------------------------------------------
   * 9-2. メモカードの追加処理（選択範囲直後 / 右クリック位置 / 本文先頭）
   * ---------------------------------------------------- */
  function insertCardAtTopOfBody(cardElement) {
    if (!document.body) return;
    const fullBlock = findAuthenticFullTransBlock();

    // 先頭にある既存のトップレベルメモ群を探す
    const existingTopMemos = [];
    const blocks = document.body.querySelectorAll('.gemini-memo-block');
    for (const b of blocks) {
      if (!authenticAddonElements.has(b)) continue;
      const off = b.getAttribute('data-gemini-offset');
      if (off === null || off === '' || off === '-1') {
        existingTopMemos.push(b);
      }
    }

    if (existingTopMemos.length > 0) {
      const lastMemo = existingTopMemos[existingTopMemos.length - 1];
      if (lastMemo && lastMemo.parentNode) {
        lastMemo.parentNode.insertBefore(cardElement, lastMemo.nextSibling);
        cardElement.setAttribute('data-gemini-order', String(existingTopMemos.length));
        return;
      }
    }

    if (fullBlock && fullBlock.parentNode === document.body) {
      const ref = fullBlock.nextSibling;
      if (ref) {
        document.body.insertBefore(cardElement, ref);
      } else {
        document.body.appendChild(cardElement);
      }
    } else if (document.body.firstChild) {
      document.body.insertBefore(cardElement, document.body.firstChild);
    } else {
      document.body.appendChild(cardElement);
    }
  }

  async function addMemoCard(fallbackText = '') {
    const selection = window.getSelection();
    let prefixContext = '';
    let suffixContext = '';
    let range = null;
    let endGlobalOffset = null;
    let selectedText = '';

    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      range = selection.getRangeAt(0);
      selectedText = selection.toString ? selection.toString().trim() : '';
    } else if (fallbackText && fallbackText.trim()) {
      selectedText = fallbackText.trim();
    } else if (lastContextMenuRange && (Date.now() - lastContextMenuTimestamp < 10000)) {
      range = lastContextMenuRange;
    }

    if (range) {
      endGlobalOffset = getGlobalOffset(range, document.body);

      const startNode = range.startContainer;
      if (startNode && startNode.nodeType === Node.TEXT_NODE) {
        const text = startNode.textContent;
        prefixContext = text.substring(Math.max(0, range.startOffset - 30), range.startOffset);
      }
      const endNode = range.endContainer;
      if (endNode && endNode.nodeType === Node.TEXT_NODE) {
        const text = endNode.textContent;
        suffixContext = text.substring(range.endOffset, Math.min(text.length, range.endOffset + 30));
      }
    }

    const memoId = 'gm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
    const { block, persistMemo, focusTextarea, setOrderIndex } = createMemoCard(
      {
        id: memoId,
        memoText: '',
        selectedText: selectedText,
        endGlobalOffset: endGlobalOffset,
        prefixContext: prefixContext,
        suffixContext: suffixContext
      },
      true
    );

    let assignedOrder = 0;
    if (range || typeof endGlobalOffset === 'number' || (selectedText && selectedText.trim())) {
      assignedOrder = insertSmartCardAt({
        range,
        endGlobalOffset,
        cardElement: block,
        selectedText,
        prefixContext,
        suffixContext
      });
      if (typeof setOrderIndex === 'function') {
        setOrderIndex(assignedOrder);
      }
    } else {
      insertCardAtTopOfBody(block);
    }
    lastContextMenuRange = null;
    lastContextMenuY = null;

    // 選択範囲を解除して本文選択へのフォーカス復帰競合を防止
    try {
      const curSel = window.getSelection();
      if (curSel && typeof curSel.removeAllRanges === 'function') {
        curSel.removeAllRanges();
      }
    } catch (_) {}

    // DOM挿入後にテキストボックスへフォーカス
    requestAnimationFrame(() => {
      if (block.isConnected) {
        block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (typeof focusTextarea === 'function') {
        focusTextarea();
      }
    });

    await persistMemo(true);
    if (typeof endGlobalOffset === 'number') {
      await syncOrderIndicesAtOffset(endGlobalOffset);
    }
  }

  /* ----------------------------------------------------
   * 10. 翻訳実行共通フロー
   * ---------------------------------------------------- */
  async function executeTranslation({
    text,
    isFull,
    transId = null,
    endGlobalOffset = null,
    orderIndex = 0,
    prefixContext = '',
    suffixContext = '',
    loadingElement = null
  }) {
    let pin = null;

    while (true) {
      let response;
      try {
        response = await safeSendMessage({
          action: 'TRANSLATE_TEXT',
          text: text,
          pin: pin,
          headerMessageId: currentMessageId,
          isFull: isFull,
          transId: transId,
          endGlobalOffset: endGlobalOffset,
          orderIndex: orderIndex,
          prefixContext: prefixContext,
          suffixContext: suffixContext
        });
      } catch (err) {
        if (loadingElement) loadingElement.remove();
        const connErr = (typeof I18n !== 'undefined') ? I18n.getMessage('errConnectionFailed') : '通信エラー';
        showToast(`${connErr} (${err.message})`);
        return;
      }

      if (response && response.needPin) {
        pin = await promptPinModal(response.message);
        if (!pin) {
          if (loadingElement) loadingElement.remove();
          return;
        }
        continue;
      }

      if (!response || !response.success) {
        if (loadingElement) loadingElement.remove();
        const fallbackFail = (typeof I18n !== 'undefined') ? I18n.getMessage('errConnectionFailed') : '翻訳に失敗しました。';
        const errMsg = (response && response.error) ? response.error : fallbackFail;
        showToast(errMsg);
        return;
      }

      // 翻訳成功
      const translatedText = response.translatedText;
      if (response.headerMessageId) {
        currentMessageId = response.headerMessageId;
      }

      if (isFull) {
        const card = createTranslationCard(translatedText, { isFull: true });
        if (loadingElement && loadingElement.parentNode) {
          loadingElement.parentNode.replaceChild(card, loadingElement);
        } else if (document.body) {
          document.body.insertBefore(card, document.body.firstChild);
        }
      } else {
        const card = createTranslationCard(translatedText, {
          isFull: false,
          id: transId,
          orderIndex: orderIndex,
          endGlobalOffset: endGlobalOffset
        });
        if (loadingElement && loadingElement.parentNode) {
          loadingElement.parentNode.replaceChild(card, loadingElement);
          if (typeof endGlobalOffset === 'number') {
            syncOrderIndicesAtOffset(endGlobalOffset);
          }
        } else {
          insertSmartCardAt({
            range: null,
            endGlobalOffset,
            cardElement: card,
            selectedText: text,
            prefixContext,
            suffixContext
          });
        }
      }

      break;
    }
  }

  /* ----------------------------------------------------
   * 11. 保存済み翻訳・メモの復元処理 (べき等・1パスインデックス・オフセット降順で高速かつ正確に描画)
   * ---------------------------------------------------- */
  let pendingRestoreRetryTimer = null;
  let isRequestingContext = false;

  function restoreSavedTranslations(savedData) {
    if (!savedData) return true;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => restoreSavedTranslations(savedData), { once: true });
      return false;
    }

    neutralizeSpoofedAddonElements(document.body);

    // DOM上の既存正規カードを1パスで収集し、重複チェックを O(1) 化
    const existingTransIds = new Set();
    const existingMemoIds = new Set();
    let existingFullBlock = null;
    const existingBlocks = document.body.querySelectorAll('.gemini-trans-block');
    for (const el of existingBlocks) {
      if (!authenticAddonElements.has(el)) continue;
      if (!existingFullBlock && el.classList.contains('gemini-full-trans-block')) {
        existingFullBlock = el;
      }
      const tid = el.getAttribute('data-gemini-id');
      if (tid) existingTransIds.add(tid);
      const mid = el.getAttribute('data-gemini-memo-id');
      if (mid) existingMemoIds.add(mid);
    }

    // 1. 全文翻訳の復元（既にDOM上に存在する場合は再生成せず表示状態のみ同期）
    if (savedData.fullTranslation && savedData.fullTranslation.translatedText) {
      if (existingFullBlock && existingFullBlock.isConnected) {
        existingFullBlock.style.display = savedData.fullTranslation.hidden ? 'none' : 'block';
      } else {
        const fullCard = createTranslationCard(savedData.fullTranslation.translatedText, { isFull: true });
        if (savedData.fullTranslation.hidden) {
          fullCard.style.display = 'none';
        }
        document.body.insertBefore(fullCard, document.body.firstChild);
      }
    }

    // 2. 部分翻訳およびメモの統合復元（未描画のカードのみを抽出）
    const combinedAnchoredItems = [];
    const topLevelMemos = [];

    if (Array.isArray(savedData.partialTranslations) && savedData.partialTranslations.length > 0) {
      const seenTransIds = new Set();
      for (const item of savedData.partialTranslations) {
        if (!item) continue;
        const itemId = item.id ? String(item.id) : null;
        if (itemId && (seenTransIds.has(itemId) || existingTransIds.has(itemId))) {
          continue;
        }
        if (itemId) seenTransIds.add(itemId);
        combinedAnchoredItems.push({ kind: 'translation', item });
      }
    }

    if (Array.isArray(savedData.memos) && savedData.memos.length > 0) {
      const seenMemoIds = new Set();
      for (const memo of savedData.memos) {
        if (!memo || !memo.id || seenMemoIds.has(String(memo.id))) continue;
        const memoId = String(memo.id);
        seenMemoIds.add(memoId);

        if (existingMemoIds.has(memoId)) {
          continue;
        }

        const rawOffset = memo.endGlobalOffset;
        const hasOffset = (typeof rawOffset === 'number' && !isNaN(rawOffset)) ||
          (rawOffset !== null && rawOffset !== '' && !isNaN(Number(rawOffset)));

        if (hasOffset || (memo.selectedText && memo.selectedText.trim())) {
          combinedAnchoredItems.push({ kind: 'memo', item: memo });
        } else {
          topLevelMemos.push(memo);
        }
      }
    }

    // 本文先頭アンカーのメモを復元
    if (topLevelMemos.length > 0) {
      topLevelMemos.sort((a, b) => {
        const ordA = (typeof a.orderIndex === 'number') ? a.orderIndex : Number(a.orderIndex) || 0;
        const ordB = (typeof b.orderIndex === 'number') ? b.orderIndex : Number(b.orderIndex) || 0;
        return ordA - ordB;
      });
      const frag = document.createDocumentFragment();
      for (let i = 0; i < topLevelMemos.length; i++) {
        const memoData = Object.assign({}, topLevelMemos[i], { orderIndex: i });
        const { block } = createMemoCard(memoData, false);
        frag.appendChild(block);
      }
      const fullBlock = findAuthenticFullTransBlock();
      if (fullBlock && fullBlock.parentNode === document.body) {
        document.body.insertBefore(frag, fullBlock.nextSibling);
      } else if (document.body.firstChild) {
        document.body.insertBefore(frag, document.body.firstChild);
      } else {
        document.body.appendChild(frag);
      }
    }

    // アンカー付きカードがある場合、1パスでテキストインデックスを構築して O(log N) で位置特定
    if (combinedAnchoredItems.length > 0) {
      const textIndex = buildCleanTextIndex(document.body);
      if (!textIndex.hasTextNodes) {
        return false;
      }

      // 同一位置（同一オフセットまたは同一DOM挿入位置）ごとにグループ化
      const groups = []; // [{ keyOffset, point, entries: [] }]

      for (const entry of combinedAnchoredItems) {
        const item = entry.item;
        const rawOffset = item.endGlobalOffset;
        const numOffset = (typeof rawOffset === 'number' && !isNaN(rawOffset))
          ? rawOffset
          : (rawOffset !== null && rawOffset !== '' && !isNaN(Number(rawOffset)) ? Number(rawOffset) : null);

        const point = findInsertionPoint(item, document.body, textIndex);

        // 既存のグループと一致するか判定
        let matchedGroup = null;
        for (const g of groups) {
          // 1. オフセット一致
          if (numOffset !== null && g.keyOffset !== null && numOffset === g.keyOffset) {
            matchedGroup = g;
            break;
          }
          // 2. DOM挿入位置の一致 (同一ノードかつ同一・近接オフセット)
          if (point && point.node && g.point && g.point.node && point.node === g.point.node) {
            const diff = Math.abs((point.offset || 0) - (g.point.offset || 0));
            if (diff <= 3) {
              matchedGroup = g;
              break;
            }
          }
        }

        if (matchedGroup) {
          matchedGroup.entries.push(entry);
          if (!matchedGroup.point && point) matchedGroup.point = point;
          if (matchedGroup.keyOffset === null && numOffset !== null) matchedGroup.keyOffset = numOffset;
        } else {
          groups.push({
            keyOffset: numOffset,
            point: point,
            entries: [entry]
          });
        }
      }

      // 各グループ内を orderIndex の昇順（上から下へ、0, 1, 2...）でソート
      for (const g of groups) {
        g.entries.sort((a, b) => {
          const getOrder = (entry) => {
            const raw = entry.item.orderIndex;
            if (typeof raw === 'number' && !isNaN(raw)) return raw;
            if (raw !== undefined && raw !== null && raw !== '' && !isNaN(Number(raw))) {
              return Number(raw);
            }
            return null;
          };
          const orderA = getOrder(a);
          const orderB = getOrder(b);

          if (orderA !== null && orderB !== null) {
            if (orderA !== orderB) {
              return orderA - orderB;
            }
          } else if (orderA !== null) {
            return -1;
          } else if (orderB !== null) {
            return 1;
          }

          // 同一 orderIndex の場合のフォールバック（作成日時の古い順を尊重）
          const timeA = a.item.createdAt || a.item.updatedAt || 0;
          const timeB = b.item.createdAt || b.item.updatedAt || 0;
          if (timeA !== timeB) {
            return timeA - timeB;
          }

          return 0;
        });
      }

      // 複数グループがある場合、DOM分割が前方のオフセットに影響を与えないよう
      // endGlobalOffset の降順（メール後方から前方へ）にソートして順次挿入
      groups.sort((a, b) => {
        const offA = a.keyOffset !== null ? a.keyOffset : -1;
        const offB = b.keyOffset !== null ? b.keyOffset : -1;
        return offB - offA;
      });

      for (const g of groups) {
        const point = g.point;
        const cardElements = [];
        for (let i = 0; i < g.entries.length; i++) {
          const entry = g.entries[i];
          const rawOrd = entry.item.orderIndex;
          const resolvedOrder = (typeof rawOrd === 'number' && !isNaN(rawOrd))
            ? rawOrd
            : (rawOrd !== null && rawOrd !== '' && !isNaN(Number(rawOrd)) ? Number(rawOrd) : i);

          if (entry.kind === 'memo') {
            const memoData = Object.assign({}, entry.item, { orderIndex: resolvedOrder });
            const { block } = createMemoCard(memoData, false);
            cardElements.push(block);
          } else {
            const card = createTranslationCard(entry.item.translatedText, {
              isFull: false,
              id: entry.item.id,
              orderIndex: resolvedOrder,
              endGlobalOffset: entry.item.endGlobalOffset
            });
            cardElements.push(card);
          }
        }
        insertCardGroupAt(point, cardElements);
      }
    }

    return true;
  }

  function scheduleRestoreWithRetry(savedData) {
    if (!savedData) return;
    if (pendingRestoreRetryTimer) {
      clearTimeout(pendingRestoreRetryTimer);
      pendingRestoreRetryTimer = null;
    }
    const ok = restoreSavedTranslations(savedData);
    if (!ok) {
      pendingRestoreRetryTimer = setTimeout(() => {
        pendingRestoreRetryTimer = null;
        const ok2 = restoreSavedTranslations(savedData);
        if (!ok2) {
          pendingRestoreRetryTimer = setTimeout(() => {
            pendingRestoreRetryTimer = null;
            restoreSavedTranslations(savedData);
          }, 300);
        }
      }, 120);
    }
  }

  /* ----------------------------------------------------
   * 12. バックグラウンドからのメッセージ受信
   * ---------------------------------------------------- */
  if (!window.__geminiTranslatorListenersAdded) {
    window.__geminiTranslatorListenersAdded = true;

    extApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'PING') {
        sendResponse({ pong: true });
        return false;
      }

      if (message.action === 'RESTORE_TRANSLATIONS_COMMAND') {
        if (message.headerMessageId) {
          currentMessageId = message.headerMessageId;
        }
        if (message.savedData) {
          lastRestoredMessageId = currentMessageId;
          scheduleRestoreWithRetry(message.savedData);
        }
        sendResponse({ status: 'restored' });
        return false;
      }

      const now = Date.now();

      if (message.action === 'TRANSLATE_SELECTION_COMMAND') {
        if (now - lastCommandTimestamp < 800 && lastCommandType === 'TRANSLATE_SELECTION_COMMAND') {
          sendResponse({ status: 'ignored_duplicate' });
          return false;
        }
        lastCommandTimestamp = now;
        lastCommandType = 'TRANSLATE_SELECTION_COMMAND';

        if (message.headerMessageId) {
          currentMessageId = message.headerMessageId;
        }
        translateSelection(message.selectionText || '');
        sendResponse({ status: 'started' });
        return false;
      }

      if (message.action === 'ADD_MEMO_COMMAND') {
        if (now - lastCommandTimestamp < 500 && lastCommandType === 'ADD_MEMO_COMMAND') {
          sendResponse({ status: 'ignored_duplicate' });
          return false;
        }
        lastCommandTimestamp = now;
        lastCommandType = 'ADD_MEMO_COMMAND';

        if (message.headerMessageId) {
          currentMessageId = message.headerMessageId;
        }
        addMemoCard(message.selectionText || '');
        sendResponse({ status: 'started' });
        return false;
      }

      if (message.action === 'TOGGLE_FULL_TRANSLATION_COMMAND') {
        if (now - lastCommandTimestamp < 800 && lastCommandType === 'TOGGLE_FULL_TRANSLATION_COMMAND') {
          sendResponse({ status: 'ignored_duplicate' });
          return false;
        }
        lastCommandTimestamp = now;
        lastCommandType = 'TOGGLE_FULL_TRANSLATION_COMMAND';

        if (message.headerMessageId) {
          currentMessageId = message.headerMessageId;
        }
        toggleFullTranslation();
        sendResponse({ status: 'started' });
        return false;
      }

      if (message.action === 'CLEAR_ALL_TRANSLATIONS_COMMAND') {
        clearAllTranslationsFromDom(false);
        sendResponse({ status: 'cleared' });
        return false;
      }

      return false;
    });
  }

  /* ----------------------------------------------------
   * 13. 初期設定 & メッセージ表示時の自動コンテキスト取得・復元
   * ---------------------------------------------------- */
  async function requestContextAndRestore() {
    if (isRequestingContext) return;
    isRequestingContext = true;
    try {
      const ctx = await safeSendMessage({
        action: 'GET_MESSAGE_CONTEXT'
      });
      if (ctx && ctx.headerMessageId) {
        currentMessageId = ctx.headerMessageId;
      }
      if (ctx && ctx.savedData) {
        lastRestoredMessageId = currentMessageId;
        scheduleRestoreWithRetry(ctx.savedData);
      }
    } catch (_) {
    } finally {
      isRequestingContext = false;
    }
  }

  async function loadInitialSettings() {
    try {
      const data = await extApi.storage.local.get([
        'shortcutEnabled',
        'shortcutKey',
        'memoShortcutEnabled',
        'memoShortcutKey',
        'uiLanguage',
        'maxTranslationChars'
      ]);
      if (data) {
        if (data.shortcutEnabled !== undefined) {
          shortcutEnabled = data.shortcutEnabled !== false;
        }
        if (data.shortcutKey && typeof data.shortcutKey === 'string') {
          shortcutKey = data.shortcutKey.toLowerCase();
        }
        if (data.memoShortcutEnabled !== undefined) {
          memoShortcutEnabled = data.memoShortcutEnabled !== false;
        }
        if (data.memoShortcutKey && typeof data.memoShortcutKey === 'string') {
          memoShortcutKey = data.memoShortcutKey.toLowerCase();
        }
        if (typeof data.maxTranslationChars === 'number' && data.maxTranslationChars >= 1000) {
          maxTranslationChars = data.maxTranslationChars;
        }
        if (data.uiLanguage && data.uiLanguage !== 'auto' && typeof I18n !== 'undefined' && I18n.init) {
          await I18n.init(data.uiLanguage);
        }
      }
    } catch (e) {
      console.warn('[ThunderTranslate] Failed to load settings:', e);
    }

    // メールドキュメント読み込み完了時に自発的に保存済み翻訳・メモを取得して復元
    await requestContextAndRestore();
  }

  loadInitialSettings();

  window.addEventListener('pageshow', () => {
    requestContextAndRestore();
  });

  if (extApi.storage && extApi.storage.onChanged) {
    extApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.shortcutEnabled !== undefined) {
          shortcutEnabled = changes.shortcutEnabled.newValue !== false;
        }
        if (changes.shortcutKey !== undefined) {
          shortcutKey = (changes.shortcutKey.newValue && typeof changes.shortcutKey.newValue === 'string')
            ? changes.shortcutKey.newValue.toLowerCase()
            : 't';
        }
        if (changes.memoShortcutEnabled !== undefined) {
          memoShortcutEnabled = changes.memoShortcutEnabled.newValue !== false;
        }
        if (changes.memoShortcutKey !== undefined) {
          memoShortcutKey = (changes.memoShortcutKey.newValue && typeof changes.memoShortcutKey.newValue === 'string')
            ? changes.memoShortcutKey.newValue.toLowerCase()
            : 'm';
        }
        if (changes.maxTranslationChars !== undefined) {
          const val = changes.maxTranslationChars.newValue;
          maxTranslationChars = (typeof val === 'number' && val >= 1000) ? val : 50000;
        }
        if (changes.uiLanguage && typeof I18n !== 'undefined' && I18n.init) {
          I18n.init(changes.uiLanguage.newValue || 'auto');
        }
      }
    });
  }

  // 右クリック位置の記録（範囲未選択状態で「メモを追加」した際の挿入位置特定用）
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (e.target && isAuthenticAddonNode(e.target)) return;
      lastContextMenuY = typeof e.clientY === 'number' ? e.clientY : null;
      try {
        if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos && pos.offsetNode && !isAuthenticAddonNode(pos.offsetNode)) {
            const r = document.createRange();
            r.setStart(pos.offsetNode, pos.offset);
            r.collapse(true);
            lastContextMenuRange = r;
            lastContextMenuTimestamp = Date.now();
          }
        } else if (document.caretRangeFromPoint) {
          const r = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (r && r.startContainer && !isAuthenticAddonNode(r.startContainer)) {
            lastContextMenuRange = r;
            lastContextMenuTimestamp = Date.now();
          }
        }
      } catch (_) {}
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || !e.key) return;
      const pressedKey = e.key.toLowerCase();

      if (shortcutEnabled && pressedKey === shortcutKey) {
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : '';
        if (selectedText) {
          e.preventDefault();
          e.stopPropagation();
          translateSelection();
          return;
        }
      }

      if (memoShortcutEnabled && pressedKey === memoShortcutKey) {
        e.preventDefault();
        e.stopPropagation();
        addMemoCard();
      }
    },
    true
  );
})();
