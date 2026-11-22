/**
 * model_capabilities.js - Gemini モデルごとの対応パラメータ・許容範囲の判定ユーティリティ
 * background.js および options/options.js の両方から参照されます。
 */

const ModelCapabilities = (() => {
  const THINKING_LEVEL_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const DEFAULT_MAX_SEED = 2147483647; // Gemini API int32 上限 (2^31 - 1)

  function normalizeModelName(modelName) {
    if (!modelName || typeof modelName !== 'string') return '';
    return modelName.trim().replace(/^models\//, '');
  }

  /**
   * /v1beta/models レスポンスのモデル配列からメタデータマップを抽出する
   * @param {Array<Object>} apiModels
   * @returns {Object<string, Object>}
   */
  function extractModelMetadataMap(apiModels) {
    const map = {};
    if (!Array.isArray(apiModels)) return map;

    for (const m of apiModels) {
      if (!m || !m.name) continue;
      if (!Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes('generateContent')) {
        continue;
      }
      const key = normalizeModelName(m.name);
      if (!key) continue;

      map[key] = {
        inputTokenLimit: (typeof m.inputTokenLimit === 'number' && Number.isFinite(m.inputTokenLimit) && m.inputTokenLimit > 0)
          ? Math.floor(m.inputTokenLimit)
          : null,
        outputTokenLimit: (typeof m.outputTokenLimit === 'number' && Number.isFinite(m.outputTokenLimit) && m.outputTokenLimit > 0)
          ? Math.floor(m.outputTokenLimit)
          : null,
        temperature: (typeof m.temperature === 'number' && Number.isFinite(m.temperature))
          ? m.temperature
          : null,
        maxTemperature: (typeof m.maxTemperature === 'number' && Number.isFinite(m.maxTemperature) && m.maxTemperature > 0)
          ? m.maxTemperature
          : null,
        topP: (typeof m.topP === 'number' && Number.isFinite(m.topP))
          ? m.topP
          : null,
        topK: (typeof m.topK === 'number' && Number.isFinite(m.topK) && m.topK > 0)
          ? Math.round(m.topK)
          : null,
        thinking: (typeof m.thinking === 'boolean') ? m.thinking : null
      };
    }

    return map;
  }

  function findModelMetadata(modelName, metadataMap) {
    if (!metadataMap || typeof metadataMap !== 'object') return null;
    const normalized = normalizeModelName(modelName);
    if (!normalized) return null;
    if (metadataMap[normalized]) return metadataMap[normalized];

    const lower = normalized.toLowerCase();
    for (const [k, v] of Object.entries(metadataMap)) {
      if (k.toLowerCase() === lower) {
        return v;
      }
    }
    return null;
  }

  /**
   * 選択中のモデルが対応する思考レベル (thinkingLevel) の選択肢一覧を返す
   * 非対応の場合は空配列 [] を返す
   * @param {string} modelName
   * @returns {string[]}
   */
  function getSupportedThinkingLevels(modelName) {
    const normalized = normalizeModelName(modelName).toLowerCase();
    if (!normalized) return [];
    if (/(?:image|imagen|tts|audio|embedding|aqa|veo|lyria|robotics)/i.test(normalized)) {
      return [];
    }
    const match = normalized.match(/^gemini-(\d+)(?:\.(\d+))?(?:-|$)/);
    if (!match) return [];
    const major = parseInt(match[1], 10);
    const minor = match[2] ? parseInt(match[2], 10) : 0;
    if (major < 3) return [];

    if (major === 3) {
      if (normalized.includes('-pro')) {
        if (minor >= 1) {
          return ['default', 'low', 'medium', 'high'];
        }
        return ['default', 'low', 'high'];
      }
      return ['default', 'minimal', 'low', 'medium', 'high'];
    }

    // Gemini 4 系以降
    return ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  }

  function supportsThinkingLevel(modelName) {
    return getSupportedThinkingLevels(modelName).length > 0;
  }

  /**
   * 指定された思考レベルが対応一覧に含まれない場合、最も近い対応レベルへクランプする
   * @param {string} currentLevel
   * @param {string[]} allowedLevels
   * @returns {{ value: string, changed: boolean }}
   */
  function clampThinkingLevel(currentLevel, allowedLevels) {
    const normalized = (typeof currentLevel === 'string') ? currentLevel.toLowerCase() : 'default';
    if (!Array.isArray(allowedLevels) || allowedLevels.length === 0) {
      return { value: normalized, changed: false };
    }
    if (allowedLevels.includes(normalized)) {
      return { value: normalized, changed: false };
    }
    if (normalized === 'default') {
      return { value: 'default', changed: false };
    }

    const nonDefaultAllowed = allowedLevels.filter((lv) => lv !== 'default');
    if (nonDefaultAllowed.length === 0) {
      return { value: 'default', changed: normalized !== 'default' };
    }

    const currentIdx = THINKING_LEVEL_ORDER.indexOf(normalized);
    if (currentIdx === -1) {
      return { value: 'default', changed: true };
    }

    const allowedIndices = nonDefaultAllowed
      .map((lv) => ({ lv, idx: THINKING_LEVEL_ORDER.indexOf(lv) }))
      .filter((item) => item.idx !== -1)
      .sort((a, b) => a.idx - b.idx);

    if (allowedIndices.length === 0) {
      return { value: 'default', changed: true };
    }

    // 下限未満 -> 最小の対応レベルへ
    if (currentIdx < allowedIndices[0].idx) {
      return { value: allowedIndices[0].lv, changed: true };
    }
    // 上限超過 -> 最大の対応レベルへ
    const last = allowedIndices[allowedIndices.length - 1];
    if (currentIdx > last.idx) {
      return { value: last.lv, changed: true };
    }
    // 中間にある非対応レベル -> 最も近い下側の対応レベルへ
    let nearest = allowedIndices[0].lv;
    for (const item of allowedIndices) {
      if (item.idx <= currentIdx) {
        nearest = item.lv;
      } else {
        break;
      }
    }
    return { value: nearest, changed: nearest !== normalized };
  }

  function clampNumber(value, min, max, decimals = null) {
    let clamped = value;
    let direction = null;
    if (clamped < min) {
      clamped = min;
      direction = 'min';
    } else if (clamped > max) {
      clamped = max;
      direction = 'max';
    }
    if (typeof decimals === 'number') {
      clamped = Number(clamped.toFixed(decimals));
    }
    return {
      value: clamped,
      changed: direction !== null,
      direction
    };
  }

  /**
   * 選択モデルの機能・パラメータ対応状況および許容範囲を解決する
   * @param {string} modelName
   * @param {Object<string, Object>|null} metadataMap
   * @returns {Object}
   */
  function getModelCapabilities(modelName, metadataMap = null) {
    const normalized = normalizeModelName(modelName);
    const lower = normalized.toLowerCase();
    const meta = findModelMetadata(normalized, metadataMap);

    const isNonTextSpecialized = /(?:image|imagen|tts|audio|embedding|aqa|veo|lyria|robotics)/i.test(lower);
    const isGemma = /^gemma(?:-|$)/.test(lower);
    const isGemini10 = /^gemini-(?:1\.0|pro(?:-|$))/.test(lower);
    const isGemini15 = /^gemini-1\.5(?:-|$)/.test(lower);
    const isGemini20 = /^gemini-2\.0(?:-|$)/.test(lower);
    const isGemini20Thinking = isGemini20 && lower.includes('thinking');

    const hasSamplingMeta = !!(
      meta &&
      (meta.temperature !== null || meta.maxTemperature !== null || meta.topP !== null || meta.topK !== null)
    );

    // 1. Temperature
    const tempSupported = isNonTextSpecialized
      ? false
      : (hasSamplingMeta ? (meta.temperature !== null || meta.maxTemperature !== null) : true);
    const tempMax = (meta && typeof meta.maxTemperature === 'number' && meta.maxTemperature > 0)
      ? meta.maxTemperature
      : (isGemini10 ? 1 : 2);

    // 2. Top-K
    const topKSupported = isNonTextSpecialized
      ? false
      : (hasSamplingMeta ? (typeof meta.topK === 'number' && meta.topK > 0) : true);
    const topKMax = (meta && typeof meta.topK === 'number' && meta.topK > 0)
      ? Math.max(1, Math.round(meta.topK))
      : 40;

    // 3. Top-P
    const topPSupported = isNonTextSpecialized
      ? false
      : (hasSamplingMeta ? (meta.topP !== null) : true);

    // 4. Seed
    const seedSupported = !isNonTextSpecialized && !isGemma && !isGemini10;

    // 5. Thinking Level
    const allowedThinkingLevels = getSupportedThinkingLevels(normalized);
    const thinkingSupported = allowedThinkingLevels.length > 0;

    // 6. Max Output Tokens
    let maxOutputTokensLimit = 65536;
    if (meta && typeof meta.outputTokenLimit === 'number' && meta.outputTokenLimit >= 100) {
      maxOutputTokensLimit = Math.floor(meta.outputTokenLimit);
    } else if (isGemini10) {
      maxOutputTokensLimit = 2048;
    } else if (isGemini15 || (isGemini20 && !isGemini20Thinking) || isGemma) {
      maxOutputTokensLimit = 8192;
    }

    return {
      model: normalized,
      hasApiMetadata: !!meta,
      temperature: {
        supported: tempSupported,
        min: 0,
        max: tempMax
      },
      topK: {
        supported: topKSupported,
        min: 1,
        max: topKMax
      },
      topP: {
        supported: topPSupported,
        min: 0.01,
        max: 1.0
      },
      seed: {
        supported: seedSupported,
        min: 0,
        max: DEFAULT_MAX_SEED
      },
      thinkingLevel: {
        supported: thinkingSupported,
        allowedLevels: allowedThinkingLevels
      },
      maxOutputTokens: {
        supported: true,
        min: 100,
        max: maxOutputTokensLimit
      }
    };
  }

  return {
    normalizeModelName,
    extractModelMetadataMap,
    getSupportedThinkingLevels,
    supportsThinkingLevel,
    clampThinkingLevel,
    clampNumber,
    getModelCapabilities
  };
})();
