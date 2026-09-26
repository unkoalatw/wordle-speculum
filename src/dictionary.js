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

// In-memory cache for word definitions
const definitionCache = new Map();

/**
 * Fetch word definition, phonetics, audio, and part-of-speech
 * Uses Free Dictionary API with Datamuse API & CORS proxy fallbacks to avoid GitHub Pages CORS blocks
 */
export async function fetchWordDefinition(word) {
  const cleanWord = word.trim().toLowerCase();
  if (definitionCache.has(cleanWord)) {
    return definitionCache.get(cleanWord);
  }

  // 1. First attempt: Direct Free Dictionary API
  try {
    const directUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`;
    const resp = await fetch(directUrl);
    if (resp.ok) {
      const data = await resp.json();
      const result = parseFreeDictData(data, cleanWord);
      if (result) {
        definitionCache.set(cleanWord, result);
        return result;
      }
    } else if (resp.status === 404) {
      const notFound = {
        word: cleanWord,
        found: false,
        message: '未在字典庫中找到此詞詳細釋義（可能為縮寫或特殊變形詞）'
      };
      definitionCache.set(cleanWord, notFound);
      return notFound;
    }
  } catch (err) {
    console.warn(`[Free Dictionary API Direct] CORS or network issue for "${cleanWord}", trying Datamuse API & proxy fallback...`, err);
  }

  // 2. Second attempt: Datamuse API (fully CORS open, fast and reliable for English definitions)
  try {
    const datamuseUrl = `https://api.datamuse.com/words?sp=${cleanWord}&md=dpr&ipa=1&max=1`;
    const resp = await fetch(datamuseUrl);
    if (resp.ok) {
      const items = await resp.json();
      if (Array.isArray(items) && items.length > 0 && items[0].word.toLowerCase() === cleanWord) {
        const item = items[0];
        const defs = item.defs || [];
        
        if (defs.length > 0) {
          // Parse definitions formatted as "n\tdefinition" or "v\tdefinition"
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
            origin: 'Datamuse English Lexicon',
            meanings
          };

          definitionCache.set(cleanWord, result);
          return result;
        }
      }
    }
  } catch (datamuseErr) {
    console.warn(`[Datamuse API] Failed for "${cleanWord}":`, datamuseErr);
  }

  // 3. Fallback: Not found
  const fallbackResult = {
    word: cleanWord,
    found: false,
    message: '暫無釋義或受限於瀏覽器跨來源存取'
  };
  definitionCache.set(cleanWord, fallbackResult);
  return fallbackResult;
}

function parseFreeDictData(data, cleanWord) {
  if (!Array.isArray(data) || data.length === 0) return null;
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

  return {
    word: entry.word || cleanWord,
    found: true,
    phonetic: phoneticText,
    audio: audioUrl,
    origin: entry.origin || null,
    meanings
  };
}
