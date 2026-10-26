/**
 * crypto.js - Web Crypto API を用いた API キー暗号化・復号ユーティリティ
 * アルゴリズム: PBKDF2 (SHA-256, 100,000回反復) + AES-GCM (256-bit)
 */

(function (global) {
  'use strict';

  // ArrayBuffer <-> Base64 変換
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // PIN から CryptoKey を導出 (PBKDF2)
  async function deriveKeyFromPin(pin, salt) {
    const enc = new TextEncoder();
    const pinKeyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(pin),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      pinKeyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 平文テキストを PIN を用いて暗号化する
   * @param {string} plainText 暗号化対象文字列 (APIキーなど)
   * @param {string} pin 暗号化解除用PINコード
   * @returns {Promise<{salt: string, iv: string, ciphertext: string}>} Base64形式の暗号データ
   */
  async function encryptText(plainText, pin) {
    if (!plainText || !pin) {
      throw new Error('暗号化対象テキストとPINコードは必須です。');
    }

    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key = await deriveKeyFromPin(pin, salt);
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(plainText)
    );

    return {
      salt: arrayBufferToBase64(salt),
      iv: arrayBufferToBase64(iv),
      ciphertext: arrayBufferToBase64(encryptedBuffer)
    };
  }

  /**
   * 暗号データを PIN を用いて復号する
   * @param {{salt: string, iv: string, ciphertext: string}} encryptedData
   * @param {string} pin
   * @returns {Promise<string>} 復号された平文テキスト
   */
  async function decryptText(encryptedData, pin) {
    if (!encryptedData || !encryptedData.salt || !encryptedData.iv || !encryptedData.ciphertext) {
      throw new Error('暗号データが不正です。');
    }
    if (!pin) {
      throw new Error('PINコードが指定されていません。');
    }

    try {
      const salt = new Uint8Array(base64ToArrayBuffer(encryptedData.salt));
      const iv = new Uint8Array(base64ToArrayBuffer(encryptedData.iv));
      const ciphertextBuffer = base64ToArrayBuffer(encryptedData.ciphertext);

      const key = await deriveKeyFromPin(pin, salt);
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertextBuffer
      );

      const dec = new TextDecoder();
      return dec.decode(decryptedBuffer);
    } catch (e) {
      throw new Error('復号に失敗しました。PINコードが正しくない可能性があります。');
    }
  }

  global.CryptoUtils = {
    encryptText,
    decryptText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
