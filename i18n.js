/**
 * i18n.js - ThunderTranslate 国際化 (i18n) モジュール
 * WebExtension 標準の browser.i18n をベースに、ユーザー指定の手動言語切り替え (auto / ja / en) をサポート
 */
const I18n = (function () {
  'use strict';

  const extApi = typeof messenger !== 'undefined' ? messenger : (typeof browser !== 'undefined' ? browser : chrome);

  let currentOverride = 'auto'; // 'auto' | 'ja' | 'en'
  let cachedBrowserLang = null;
  const localeCache = {};

  async function loadLocaleFile(lang) {
    if (localeCache[lang]) return localeCache[lang];
    try {
      const url = extApi.runtime.getURL(`_locales/${lang}/messages.json`);
      const res = await fetch(url);
      const data = await res.json();
      localeCache[lang] = data;
      return data;
    } catch (e) {
      console.warn('[I18n] Failed to load locale file for', lang, e);
      return null;
    }
  }

  async function init(preloadedLang = undefined) {
    try {
      if (preloadedLang !== undefined) {
        currentOverride = preloadedLang || 'auto';
      } else {
        const data = await extApi.storage.local.get('uiLanguage');
        currentOverride = (data && data.uiLanguage) ? data.uiLanguage : 'auto';
      }
      if (currentOverride !== 'auto') {
        await loadLocaleFile(currentOverride);
      }
    } catch (e) {
      console.warn('[I18n] Storage read failed:', e);
    }
  }

  function getActiveLanguage() {
    if (currentOverride === 'ja' || currentOverride === 'en') {
      return currentOverride;
    }
    if (!cachedBrowserLang) {
      const uiLang = (extApi.i18n && extApi.i18n.getUILanguage)
        ? extApi.i18n.getUILanguage().toLowerCase()
        : (navigator.language || 'ja').toLowerCase();
      cachedBrowserLang = uiLang.startsWith('ja') ? 'ja' : 'en';
    }
    return cachedBrowserLang;
  }

  function getMessage(key, substitutions = []) {
    const activeLang = getActiveLanguage();

    // 手動オーバーライドがある場合、または辞書キャッシュがある場合はそれを優先
    if (currentOverride !== 'auto' && localeCache[activeLang]) {
      const item = localeCache[activeLang][key];
      if (item && typeof item.message === 'string') {
        let msg = item.message;
        if (substitutions) {
          const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
          subs.forEach((sub, i) => {
            msg = msg.split(`$${i + 1}`).join(String(sub));
          });
        }
        return msg;
      }
    }

    // 標準の browser.i18n.getMessage を利用
    if (extApi.i18n && extApi.i18n.getMessage) {
      const stdMsg = extApi.i18n.getMessage(key, substitutions);
      if (stdMsg) return stdMsg;
    }

    // キャッシュにあれば取得
    if (localeCache[activeLang] && localeCache[activeLang][key]) {
      return localeCache[activeLang][key].message;
    }

    return key;
  }

  async function setLanguage(lang) {
    currentOverride = lang;
    if (lang !== 'auto') {
      await loadLocaleFile(lang);
    }
    await extApi.storage.local.set({ uiLanguage: lang });
  }

  function applyToDOM(root = document) {
    const lang = getActiveLanguage();
    if (root.documentElement) {
      root.documentElement.lang = lang;
    }

    // textContent 置換
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        const msg = getMessage(key);
        if (msg && msg !== key) {
          el.textContent = msg;
        }
      }
    });

    // placeholder 置換
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        const msg = getMessage(key);
        if (msg && msg !== key) {
          el.placeholder = msg;
        }
      }
    });

    // title 属性置換
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        const msg = getMessage(key);
        if (msg && msg !== key) {
          el.title = msg;
        }
      }
    });

  }

  return {
    init,
    getMessage,
    getActiveLanguage,
    getCurrentOverride: () => currentOverride,
    setLanguage,
    applyToDOM,
    loadLocaleFile
  };
})();

// グローバルスコープへ公開
if (typeof window !== 'undefined') {
  window.I18n = I18n;
}
if (typeof globalThis !== 'undefined') {
  globalThis.I18n = I18n;
}
