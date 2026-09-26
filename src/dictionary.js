// External Dictionary Engine Loader & Free Dictionary API Definitions
// Loads dedicated dictionary files dynamically via HTTP fetch or external sources

export const EXTERNAL_DICTIONARY_PRESETS = [
  {
    id: 'nyt_target',
    name: 'NYT 官方標準目標解題庫 (2,315 詞)',
    desc: '標準 Wordle 每日謎底詞彙庫，無生僻罕見字',
    path: './data/nyt_target_words.txt'
  },
  {
    id: 'stanford_sgb',
    name: 'Stanford GraphBase 精選五字庫 (5,757 詞)',
    desc: '高質量的五字母常用英文詞庫 (Knuth SGB)',
    path: './data/sgb_5757_words.txt'
  },
  {
    id: 'allowed_expanded',
    name: 'Wordle 完整擴充猜測庫 (12,954 詞)',
    desc: '3Blue1Brown 與官方承認的完整試探單字庫',
    path: './data/allowed_guesses.txt'
  },
  {
    id: 'massive_14k',
    name: '全網極限完整詞彙庫 (14,855 詞)',
    desc: '包含所有可能合法組合的極大化詞庫',
    path: './data/official_targets.txt'
  }
];

export const PRECOMPUTED_OPENERS = {
  "salet": 5.836,
  "crane": 5.742,
  "trace": 5.830,
  "slate": 5.856,
  "roast": 5.731,
  "tarte": 5.789,
  "raise": 5.878,
  "arise": 5.867,
  "stare": 5.807,
  "soare": 5.886,
  "crate": 5.835,
  "reast": 5.868,
  "carse": 5.824,
  "carte": 5.802,
  "audio": 5.487,
  "adieu": 5.342
};

// Asynchronously load external dictionary from local file path or remote URL
export async function loadExternalDictionary(pathOrUrl) {
  const resp = await fetch(pathOrUrl);
  if (!resp.ok) {
    throw new Error(`無法載入外部字典 (${resp.status} ${resp.statusText})`);
  }
  const text = await resp.text();
  return parseWordList(text);
}

// Parse raw plain text or json into 5-letter unique lowercase words
export function parseWordList(rawText) {
  try {
    const json = JSON.parse(rawText);
    if (Array.isArray(json)) {
      return Array.from(new Set(
        json.map(w => String(w).trim().toLowerCase()).filter(w => w.length === 5 && /^[a-z]+$/.test(w))
      ));
    }
  } catch {
    // Plain text per line
  }

  const matches = rawText.match(/[a-zA-Z]{5}/g) || [];
  const unique = Array.from(new Set(matches.map(w => w.toLowerCase())));
  return unique;
}

// In-memory cache for Free Dictionary API results
const definitionCache = new Map();

/**
 * Fetch word definition, phonetics, audio, and part-of-speech from Free Dictionary API
 * API Endpoint: https://api.dictionaryapi.dev/api/v2/entries/en/<word>
 */
export async function fetchWordDefinition(word) {
  const cleanWord = word.trim().toLowerCase();
  if (definitionCache.has(cleanWord)) {
    return definitionCache.get(cleanWord);
  }

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
    if (!response.ok) {
      if (response.status === 404) {
        const notFoundResult = {
          word: cleanWord,
          found: false,
          message: '未在字典庫中找到此詞的詳細釋義（可能為縮寫或特殊變形詞）'
        };
        definitionCache.set(cleanWord, notFoundResult);
        return notFoundResult;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { word: cleanWord, found: false, message: '無釋義資料' };
    }

    const entry = data[0];
    const phoneticText = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';
    const audioUrl = entry.phonetics?.find(p => p.audio && p.audio.length > 0)?.audio || '';

    const meanings = (entry.meanings || []).map(m => ({
      partOfSpeech: m.partOfSpeech,
      definitions: (m.definitions || []).slice(0, 3).map(d => ({
        definition: d.definition,
        example: d.example || null,
        synonyms: d.synonyms || []
      }))
    }));

    const result = {
      word: entry.word || cleanWord,
      found: true,
      phonetic: phoneticText,
      audio: audioUrl,
      origin: entry.origin || null,
      meanings
    };

    definitionCache.set(cleanWord, result);
    return result;
  } catch (err) {
    console.warn(`[Free Dictionary API] Failed to fetch definition for "${cleanWord}":`, err);
    return {
      word: cleanWord,
      found: false,
      error: err.message,
      message: `釋義查詢連線異常 (${err.message})`
    };
  }
}
