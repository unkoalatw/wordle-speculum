// External Dictionary Engine Loader & Free Dictionary API Definitions
// Loads dedicated dictionary files dynamically via HTTP fetch or external sources

export const EXTERNAL_DICTIONARY_PRESETS = [
  {
    id: 'google_common',
    name: 'Google 高頻核心五字庫 (1,367 詞)',
    desc: '從 Google 10,000 最常用英文詞中篩選的高頻字，極致實用',
    path: './data/google_common_words.txt'
  },
  {
    id: 'nyt_target',
    name: 'NYT 官方標準目標解題庫 (2,315 詞)',
    desc: '標準 Wordle 每日謎底官方詞彙庫，無生僻罕見字',
    path: './data/nyt_target_words.txt'
  },
  {
    id: 'stanford_sgb',
    name: 'Stanford GraphBase 精選五字庫 (5,757 詞)',
    desc: '高質量經典英文五字庫 (Donald Knuth SGB)',
    path: './data/sgb_5757_words.txt'
  },
  {
    id: 'scrabble_dict',
    name: '官方 Scrabble 拼字比賽五字庫 (8,938 詞)',
    desc: '國際拼字競賽標準字典 (TWL/CSW) 所有合法五字母詞',
    path: './data/scrabble_8636_words.txt'
  },
  {
    id: 'allowed_expanded',
    name: 'Wordle 完整擴充合法猜測庫 (12,954 詞)',
    desc: '3Blue1Brown 與 NYT 官方承認的完整試探單字庫',
    path: './data/allowed_guesses.txt'
  },
  {
    id: 'massive_14k',
    name: '全網極限完整詞彙庫 (14,855 詞)',
    desc: '包含所有英語字典可能合法組合的極大化詞庫',
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

// In-memory cache for word definitions
const definitionCache = new Map();

/**
 * Fetch word definition, phonetics, audio, and part-of-speech
 * Uses Datamuse API (100% CORS-open, fast) as primary engine to avoid GitHub Pages CORS browser network errors
 */
export async function fetchWordDefinition(word) {
  const cleanWord = word.trim().toLowerCase();
  if (definitionCache.has(cleanWord)) {
    return definitionCache.get(cleanWord);
  }

  // 1. Primary engine: Datamuse API (CORS-friendly, no origin blocks)
  try {
    const datamuseUrl = `https://api.datamuse.com/words?sp=${cleanWord}&md=dpr&ipa=1&max=1`;
    const resp = await fetch(datamuseUrl);
    if (resp.ok) {
      const items = await resp.json();
      if (Array.isArray(items) && items.length > 0 && items[0].word.toLowerCase() === cleanWord) {
        const item = items[0];
        const defs = item.defs || [];
        
        if (defs.length > 0) {
          const meaningsMap = {};
          defs.forEach(dStr => {
            const parts = dStr.split('\t');
            const posCode = parts[0] || 'general';
            const defText = parts[1] || dStr;
            const posName = {
              'n': 'noun',
              'v': 'verb',
              'adj': 'adjective',
              'adv': 'adverb',
              'u': 'unknown'
            }[posCode] || posCode;

            if (!meaningsMap[posName]) {
              meaningsMap[posName] = [];
            }
            meaningsMap[posName].push({
              definition: defText,
              example: null,
              synonyms: []
            });
          });

          const meanings = Object.entries(meaningsMap).map(([pos, list]) => ({
            partOfSpeech: pos,
            definitions: list.slice(0, 3)
          }));

          const ipaTag = (item.tags || []).find(t => t.startsWith('ipa_'));
          const phonetic = ipaTag ? ipaTag.replace('ipa_', '') : '';

          const result = {
            word: cleanWord,
            found: true,
            phonetic: phonetic,
            audio: '',
            origin: 'Datamuse / Oxford & WordNet Lexicon',
            meanings
          };

          definitionCache.set(cleanWord, result);
          return result;
        }
      }
    }
  } catch (err) {
    // Network fallback
  }

  // 2. Fallback: Not found
  const fallbackResult = {
    word: cleanWord,
    found: false,
    message: '未在字典庫中找到此詞的詳細釋義（可能為縮寫或特定變形詞）'
  };
  definitionCache.set(cleanWord, fallbackResult);
  return fallbackResult;
}
