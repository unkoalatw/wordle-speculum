import { 
  EXTERNAL_DICTIONARY_PRESETS, 
  PRECOMPUTED_OPENERS, 
  loadExternalDictionary, 
  parseWordList,
  fetchWordDefinition 
} from './dictionary.js';

// Application State
const STATE = {
  currentDictName: 'NYT 官方標準目標解題庫 (2,315 詞)',
  targetWords: [],
  allowedWords: [],
  precomputedOpeners: { ...PRECOMPUTED_OPENERS },
  
  secretWord: 'crane',
  candidatePool: [],
  currentStep: 0,
  maxSteps: 6,
  
  // Board state: 6 rows of { word: string, feedback: number[5], entropyGain: number }
  boardRows: Array.from({ length: 6 }, () => ({
    word: '',
    feedback: [0, 0, 0, 0, 0],
    entropyGain: null
  })),
  
  // Handicap banned letters set
  bannedLetters: new Set(),
  
  // Keyboard letter states: 'correct' | 'present' | 'absent' | null
  letterStateMap: {},
  
  // Playback control
  isPlaying: false,
  playSpeed: 1.0,
  playTimer: null,
  
  // Decay history for canvas: [{ step: 0, count: N, entropy: H }]
  decayHistory: [],
  
  // Latest rankings from worker
  latestRankings: [],
  
  // Reveal secret toggle
  revealSecret: false
};

// Initialize Web Worker
let solverWorker = null;

function initWorker() {
  solverWorker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'classic' });
  
  solverWorker.onmessage = (e) => {
    const { type, result, filtered, count } = e.data;
    
    if (type === 'INIT_DONE') {
      updateAIStatusBadge('AI ENGINE: READY', 'ready');
      triggerEvaluation();
    } else if (type === 'RANK_RESULT') {
      handleRankResult(result);
    } else if (type === 'FILTER_DONE') {
      handleFilterDone(filtered);
    } else if (type === 'SIMULATION_RESULT') {
      handleSimulationResult(result);
    }
  };
}

// DOM Elements
const DOM = {
  gameBoard: document.getElementById('gameBoard'),
  letterKeyboard: document.getElementById('letterKeyboard'),
  rankingList: document.getElementById('rankingList'),
  targetWordInput: document.getElementById('targetWordInput'),
  btnRandomTarget: document.getElementById('btnRandomTarget'),
  btnRevealTarget: document.getElementById('btnRevealTarget'),
  btnDefineTarget: document.getElementById('btnDefineTarget'),
  btnStep: document.getElementById('btnStep'),
  btnAutoPlay: document.getElementById('btnAutoPlay'),
  btnPause: document.getElementById('btnPause'),
  btnReset: document.getElementById('btnReset'),
  speedSlider: document.getElementById('speedSlider'),
  speedDisplay: document.getElementById('speedDisplay'),
  btnBatchBenchmark: document.getElementById('btnBatchBenchmark'),
  metricRemainingWords: document.getElementById('metricRemainingWords'),
  metricReductionPct: document.getElementById('metricReductionPct'),
  metricEntropy: document.getElementById('metricEntropy'),
  metricLatency: document.getElementById('metricLatency'),
  stepCounterBadge: document.getElementById('stepCounterBadge'),
  aiStatusBadge: document.getElementById('aiStatusBadge'),
  aiStatusText: document.getElementById('aiStatusText'),
  decayCanvas: document.getElementById('decayCanvas'),
  entropyReductionSummary: document.getElementById('entropyReductionSummary'),
  dictCountBadge: document.getElementById('dictCountBadge'),
  activeDictNameDisplay: document.getElementById('activeDictNameDisplay'),
  bannedLettersDisplay: document.getElementById('bannedLettersDisplay'),
  validTargetCountDisplay: document.getElementById('validTargetCountDisplay'),
  wordDefinitionCard: document.getElementById('wordDefinitionCard'),
  btnClearBans: document.getElementById('btnClearBans'),
  presetCasual: document.getElementById('presetCasual'),
  presetVowels: document.getElementById('presetVowels'),
  presetConsonants: document.getElementById('presetConsonants'),
  presetRandom3: document.getElementById('presetRandom3'),
  dictModal: document.getElementById('dictModal'),
  dictPresetsContainer: document.getElementById('dictPresetsContainer'),
  btnDictModal: document.getElementById('btnDictModal'),
  btnCloseDictModal: document.getElementById('btnCloseDictModal'),
  btnApplyCustomDict: document.getElementById('btnApplyCustomDict'),
  dictUrlInput: document.getElementById('dictUrlInput'),
  btnFetchDictUrl: document.getElementById('btnFetchDictUrl'),
  dictFileInput: document.getElementById('dictFileInput'),
  dictPasteInput: document.getElementById('dictPasteInput'),
  privacyModal: document.getElementById('privacyModal'),
  btnPrivacyModal: document.getElementById('btnPrivacyModal'),
  btnClosePrivacyModal: document.getElementById('btnClosePrivacyModal'),
  benchmarkModal: document.getElementById('benchmarkModal'),
  btnCloseBenchmarkModal: document.getElementById('btnCloseBenchmarkModal'),
  benchmarkResultsContent: document.getElementById('benchmarkResultsContent')
};

// Initialize UI
async function init() {
  buildBoardUI();
  buildKeyboardUI();
  buildDictPresetsUI();
  setupEventListeners();
  initWorker();

  // Load default external dictionary preset (NYT Official Target 2315)
  try {
    updateAIStatusBadge('LOADING EXTERNAL DICTIONARY...', 'calculating');
    await switchDictionaryPreset(EXTERNAL_DICTIONARY_PRESETS[0]);
  } catch (err) {
    console.error('Failed to load default external dictionary, fallback to local fetch', err);
  }
}

function updateAIStatusBadge(text, status = 'running') {
  DOM.aiStatusText.textContent = text;
  if (status === 'ready') {
    DOM.aiStatusBadge.className = 'status-badge';
  } else if (status === 'calculating') {
    DOM.aiStatusBadge.className = 'status-badge running';
  } else if (status === 'finished') {
    DOM.aiStatusBadge.className = 'status-badge';
    DOM.aiStatusBadge.style.color = '#34d399';
  }
}

// Build External Dictionary Presets in Modal
function buildDictPresetsUI() {
  DOM.dictPresetsContainer.innerHTML = '';
  EXTERNAL_DICTIONARY_PRESETS.forEach(preset => {
    const card = document.createElement('div');
    card.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    `;
    card.innerHTML = `
      <div>
        <div style="font-weight: 700; color: #fff; font-size: 0.82rem;">${preset.name}</div>
        <div style="font-size: 0.7rem; color: var(--text-dim);">${preset.desc} (${preset.path})</div>
      </div>
      <button class="btn btn-primary" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;">選用此庫</button>
    `;

    card.addEventListener('click', async () => {
      await switchDictionaryPreset(preset);
      DOM.dictModal.classList.remove('open');
    });

    DOM.dictPresetsContainer.appendChild(card);
  });
}

// Switch Dictionary to an External Preset
async function switchDictionaryPreset(preset) {
  try {
    updateAIStatusBadge(`LOADING ${preset.name}...`, 'calculating');
    const words = await loadExternalDictionary(preset.path);
    STATE.currentDictName = preset.name;
    setNewDictionary(words, preset.name);
  } catch (err) {
    alert(`載入外部字典失敗: ${err.message}`);
  }
}

// Set newly loaded dictionary
function setNewDictionary(words, name = '自訂外部字典') {
  const uniqueWords = Array.from(new Set(words));
  STATE.targetWords = uniqueWords;
  STATE.allowedWords = uniqueWords;
  STATE.currentDictName = name;
  
  DOM.dictCountBadge.textContent = `${uniqueWords.length} 詞`;
  DOM.activeDictNameDisplay.textContent = `${name} (${uniqueWords.length} 詞)`;
  
  solverWorker.postMessage({
    type: 'INIT_DICTIONARY',
    payload: {
      targetWords: uniqueWords,
      allowedWords: uniqueWords,
      precomputedOpeners: STATE.precomputedOpeners
    }
  });

  pickRandomTarget();
  resetGame();
}

// Build 6-Row Board UI
function buildBoardUI() {
  DOM.gameBoard.innerHTML = '';
  for (let r = 0; r < 6; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'wordle-row';
    rowEl.id = `board-row-${r}`;

    for (let c = 0; c < 5; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${r}-${c}`;
      tile.dataset.row = r;
      tile.dataset.col = c;
      
      tile.addEventListener('click', () => handleTileClick(r, c));
      rowEl.appendChild(tile);
    }

    const entropyPill = document.createElement('div');
    entropyPill.className = 'entropy-pill';
    entropyPill.id = `entropy-pill-${r}`;
    entropyPill.textContent = '- bit';
    
    // Clicking entropy pill checks row word definition
    entropyPill.addEventListener('click', () => {
      const word = STATE.boardRows[r].word;
      if (word && word.length === 5) {
        inspectWordDefinition(word);
      }
    });
    rowEl.appendChild(entropyPill);

    DOM.gameBoard.appendChild(rowEl);
  }
}

// Build QWERTY Keyboard for Handicap & Clues
function buildKeyboardUI() {
  const rows = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M']
  ];

  DOM.letterKeyboard.innerHTML = '';
  rows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';
    row.forEach(letter => {
      const keyBtn = document.createElement('button');
      keyBtn.className = 'key-btn';
      keyBtn.id = `key-${letter}`;
      keyBtn.textContent = letter;
      keyBtn.addEventListener('click', () => toggleLetterBan(letter));
      rowEl.appendChild(keyBtn);
    });
    DOM.letterKeyboard.appendChild(rowEl);
  });
}

// Toggle Letter Handicap Ban
function toggleLetterBan(letter) {
  const upper = letter.toUpperCase();
  if (STATE.bannedLetters.has(upper)) {
    STATE.bannedLetters.delete(upper);
  } else {
    STATE.bannedLetters.add(upper);
  }
  updateHandicapUI();
  
  if (STATE.currentStep === 0) {
    resetGame();
  } else {
    triggerEvaluation();
  }
}

function updateHandicapUI() {
  const bannedArr = Array.from(STATE.bannedLetters);
  DOM.bannedLettersDisplay.textContent = bannedArr.length > 0 ? bannedArr.join(', ') : '無';
  
  document.querySelectorAll('.key-btn').forEach(btn => {
    const char = btn.textContent.trim();
    if (STATE.bannedLetters.has(char)) {
      btn.classList.add('banned');
    } else {
      btn.classList.remove('banned');
    }
  });

  const validCount = STATE.targetWords.filter(w => {
    for (let i = 0; i < 5; i++) {
      if (STATE.bannedLetters.has(w[i].toUpperCase())) return false;
    }
    return true;
  }).length;
  DOM.validTargetCountDisplay.textContent = validCount;
}

// Pick Random Target Word
function pickRandomTarget() {
  if (!STATE.targetWords || STATE.targetWords.length === 0) return;
  
  const filtered = STATE.targetWords.filter(w => {
    for (let i = 0; i < 5; i++) {
      if (STATE.bannedLetters.has(w[i].toUpperCase())) return false;
    }
    return true;
  });

  const pool = filtered.length > 0 ? filtered : STATE.targetWords;
  STATE.secretWord = pool[Math.floor(Math.random() * pool.length)].toLowerCase();
  
  if (STATE.revealSecret) {
    DOM.targetWordInput.value = STATE.secretWord.toUpperCase();
  } else {
    DOM.targetWordInput.value = '*****';
  }
}

// Inspect Word Definition using Free Dictionary API
async function inspectWordDefinition(word) {
  const clean = word.trim().toLowerCase();
  DOM.wordDefinitionCard.innerHTML = `
    <div style="color: var(--accent-cyan); font-family: var(--font-mono); font-size: 0.8rem;">
      🔍 正在向 Free Dictionary API 查詢「${clean.toUpperCase()}」釋義...
    </div>
  `;

  const def = await fetchWordDefinition(clean);

  if (!def.found) {
    DOM.wordDefinitionCard.innerHTML = `
      <div style="font-weight: 700; color: #f87171; font-size: 0.85rem; font-family: var(--font-mono);">
        ${clean.toUpperCase()}
      </div>
      <div style="color: var(--text-dim); margin-top: 0.2rem; font-size: 0.72rem;">
        ${def.message || '未找到釋義'}
      </div>
    `;
    return;
  }

  let audioBtn = '';
  if (def.audio) {
    audioBtn = `
      <button id="btnPlayWordAudio" style="background: rgba(0,240,255,0.15); border: 1px solid var(--accent-cyan); border-radius: 4px; padding: 0.1rem 0.35rem; color: var(--accent-cyan); font-size: 0.7rem; cursor: pointer;">
        🔊 發音
      </button>
    `;
  }

  let meaningsHtml = '';
  def.meanings.forEach(m => {
    meaningsHtml += `
      <div style="margin-top: 0.35rem; padding-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.08);">
        <span style="font-style: italic; color: var(--accent-purple); font-weight: 700;">(${m.partOfSpeech})</span>
        <ul style="margin-left: 1.1rem; margin-top: 0.15rem; color: #cbd5e1;">
          ${m.definitions.map(d => `
            <li>
              <div>${d.definition}</div>
              ${d.example ? `<div style="color: var(--text-dim); font-size: 0.7rem; margin-top: 0.1rem;">例句: "${d.example}"</div>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  });

  DOM.wordDefinitionCard.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: baseline; gap: 0.5rem;">
        <span style="font-weight: 800; font-size: 0.95rem; font-family: var(--font-mono); color: var(--accent-cyan);">${def.word.toUpperCase()}</span>
        ${def.phonetic ? `<span style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.75rem;">/${def.phonetic}/</span>` : ''}
      </div>
      ${audioBtn}
    </div>
    ${meaningsHtml}
  `;

  if (def.audio) {
    const btn = document.getElementById('btnPlayWordAudio');
    if (btn) {
      btn.addEventListener('click', () => {
        const audio = new Audio(def.audio);
        audio.play().catch(e => console.warn('Audio play failed:', e));
      });
    }
  }
}

// Reset Game State
function resetGame() {
  pausePlayback();
  STATE.currentStep = 0;
  
  STATE.candidatePool = STATE.targetWords.filter(w => {
    for (let i = 0; i < 5; i++) {
      if (STATE.bannedLetters.has(w[i].toUpperCase())) return false;
    }
    return true;
  });

  STATE.boardRows = Array.from({ length: 6 }, () => ({
    word: '',
    feedback: [0, 0, 0, 0, 0],
    entropyGain: null
  }));

  STATE.letterStateMap = {};
  STATE.decayHistory = [{
    step: 0,
    count: STATE.candidatePool.length,
    entropy: Math.log2(STATE.candidatePool.length || 1)
  }];

  renderBoard();
  renderKeyboardClues();
  renderDecayChart();
  updateMetrics(STATE.candidatePool.length, Math.log2(STATE.candidatePool.length || 1), 0);
  DOM.stepCounterBadge.textContent = `第 0 / 6 步`;

  DOM.btnStep.disabled = false;
  DOM.btnAutoPlay.disabled = false;
  DOM.btnPause.disabled = true;

  triggerEvaluation();
}

// Trigger Web Worker calculation for current step
function triggerEvaluation() {
  if (STATE.currentStep >= STATE.maxSteps || STATE.candidatePool.length === 0) {
    return;
  }
  updateAIStatusBadge('AI ENGINE: CALCULATING', 'calculating');
  solverWorker.postMessage({
    type: 'RANK_GUESSES',
    payload: {
      candidates: STATE.candidatePool,
      bannedLetters: Array.from(STATE.bannedLetters),
      isFirstGuess: STATE.currentStep === 0
    }
  });
}

function handleRankResult(result) {
  const { rankings, executionTimeMs, currentEntropy } = result;
  STATE.latestRankings = rankings;
  
  updateAIStatusBadge('AI ENGINE: READY', 'ready');
  updateMetrics(STATE.candidatePool.length, currentEntropy, executionTimeMs);
  renderRankings(rankings);
}

// Render Top Candidates in Decision Board
function renderRankings(rankings) {
  DOM.rankingList.innerHTML = '';
  if (!rankings || rankings.length === 0) {
    DOM.rankingList.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:1rem;">無推薦詞彙 (請重置盤面或解封字母)</div>';
    return;
  }

  rankings.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = `ranking-item ${index === 0 ? 'top-pick' : ''}`;
    
    const bitVal = item.entropy.toFixed(3);
    const reduction = item.reductionPct ? `${item.reductionPct.toFixed(1)}% 消除率` : '';
    const poolTag = item.inPool ? '<span class="ranking-badge">候選詞</span>' : '<span style="font-size:0.65rem;color:var(--text-dim);border:1px solid #334155;padding:0.1rem 0.3rem;border-radius:3px;">試探詞</span>';

    el.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.4rem;">
        <span style="color: ${index === 0 ? 'var(--accent-cyan)' : 'var(--text-dim)'}; font-weight: 700; width: 16px;">${index + 1}.</span>
        <span class="ranking-word" title="點擊直接猜測此單字">${item.word.toUpperCase()}</span>
        ${poolTag}
      </div>
      <div style="display: flex; align-items: center; gap: 0.4rem;">
        <span class="ranking-entropy">${bitVal} bits</span>
        <button class="btn btn-define" data-word="${item.word}" style="padding: 0.1rem 0.35rem; font-size: 0.65rem; background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.3);">📖</button>
      </div>
    `;

    // Click candidate word to choose as guess
    el.querySelector('.ranking-word').addEventListener('click', () => {
      if (!STATE.isPlaying && STATE.currentStep < 6) {
        executeStepWithGuess(item.word.toLowerCase());
      }
    });

    // Click define button to inspect Free Dictionary API
    el.querySelector('.btn-define').addEventListener('click', (e) => {
      e.stopPropagation();
      inspectWordDefinition(item.word);
    });

    DOM.rankingList.appendChild(el);
  });
}

// Compute feedback array [c0..c4]
function computeFeedback(guess, secret) {
  const g = guess.toLowerCase().split('');
  const s = secret.toLowerCase().split('');
  const fb = [0, 0, 0, 0, 0];
  const sCounts = {};

  for (let i = 0; i < 5; i++) {
    if (g[i] === s[i]) {
      fb[i] = 2; // Green
    } else {
      sCounts[s[i]] = (sCounts[s[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (fb[i] !== 2) {
      if (sCounts[g[i]] && sCounts[g[i]] > 0) {
        fb[i] = 1; // Yellow
        sCounts[g[i]]--;
      }
    }
  }

  return fb;
}

// Execute single AI inference step
function executeStep() {
  if (STATE.currentStep >= STATE.maxSteps || STATE.candidatePool.length === 0) {
    pausePlayback();
    return;
  }

  // Pick best available guess from latest rankings that is valid, avoiding duplicate guesses
  const guessedWords = new Set(STATE.boardRows.slice(0, STATE.currentStep).map(r => r.word.toLowerCase()));
  let guess = '';
  
  if (STATE.latestRankings && STATE.latestRankings.length > 0) {
    const freshPick = STATE.latestRankings.find(r => !guessedWords.has(r.word.toLowerCase()));
    guess = freshPick ? freshPick.word.toLowerCase() : STATE.latestRankings[0].word.toLowerCase();
  } else if (STATE.candidatePool.length > 0) {
    const candPick = STATE.candidatePool.find(c => !guessedWords.has(c));
    guess = candPick || STATE.candidatePool[0];
  } else {
    guess = 'salet';
  }

  executeStepWithGuess(guess);
}

function executeStepWithGuess(guess) {
  const rowIdx = STATE.currentStep;
  const secret = STATE.secretWord.toLowerCase();
  const feedback = computeFeedback(guess, secret);

  const patternHash = feedback[0] + feedback[1] * 3 + feedback[2] * 9 + feedback[3] * 27 + feedback[4] * 81;

  // Filter candidates in worker
  solverWorker.postMessage({
    type: 'FILTER_CANDIDATES',
    payload: {
      candidates: STATE.candidatePool,
      guess,
      patternHash
    }
  });

  // Record board row
  STATE.boardRows[rowIdx] = {
    word: guess.toUpperCase(),
    feedback,
    entropyGain: null
  };

  // Inspect definition automatically for guessed word
  inspectWordDefinition(guess);

  // Update letter clues keyboard
  for (let i = 0; i < 5; i++) {
    const char = guess[i].toUpperCase();
    const status = feedback[i] === 2 ? 'correct' : (feedback[i] === 1 ? 'present' : 'absent');
    if (!STATE.letterStateMap[char] || status === 'correct' || (status === 'present' && STATE.letterStateMap[char] !== 'correct')) {
      STATE.letterStateMap[char] = status;
    }
  }

  STATE.currentStep++;
  DOM.stepCounterBadge.textContent = `第 ${STATE.currentStep} / 6 步`;

  renderBoard();
  renderKeyboardClues();

  // Check victory condition
  if (guess === secret || feedback.every(f => f === 2)) {
    pausePlayback();
    updateAIStatusBadge(`🎉 命中答案: ${guess.toUpperCase()} (${STATE.currentStep} 步)`, 'finished');
    DOM.btnStep.disabled = true;
    DOM.btnAutoPlay.disabled = true;
    return;
  }

  if (STATE.currentStep >= STATE.maxSteps) {
    pausePlayback();
    updateAIStatusBadge(`❌ 已達最大猜測次數 (答案: ${secret.toUpperCase()})`, 'finished');
    DOM.btnStep.disabled = true;
    DOM.btnAutoPlay.disabled = true;
  }
}

function handleFilterDone(filtered) {
  const prevCount = STATE.candidatePool.length;
  STATE.candidatePool = filtered;
  const newCount = filtered.length;
  
  const prevEntropy = Math.log2(prevCount || 1);
  const newEntropy = Math.log2(newCount || 1);
  const bitGain = Math.max(0, prevEntropy - newEntropy);

  if (STATE.currentStep > 0) {
    STATE.boardRows[STATE.currentStep - 1].entropyGain = bitGain;
    const pill = document.getElementById(`entropy-pill-${STATE.currentStep - 1}`);
    if (pill) {
      pill.textContent = `-${bitGain.toFixed(2)} bit`;
      pill.style.background = 'rgba(16, 185, 129, 0.15)';
      pill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }
  }

  STATE.decayHistory.push({
    step: STATE.currentStep,
    count: newCount,
    entropy: newEntropy
  });

  renderDecayChart();
  updateMetrics(newCount, newEntropy, 0);

  // If auto playing and not reached victory/limit, trigger evaluation and chain next step cleanly upon RANK_RESULT
  triggerEvaluation();
}

function handleRankResult(result) {
  const { rankings, executionTimeMs, currentEntropy } = result;
  STATE.latestRankings = rankings;
  
  updateAIStatusBadge('AI ENGINE: READY', 'ready');
  updateMetrics(STATE.candidatePool.length, currentEntropy, executionTimeMs);
  renderRankings(rankings);

  // If in AutoPlay mode and game still active, trigger next step after calculated delay
  if (STATE.isPlaying && STATE.currentStep < STATE.maxSteps && STATE.candidatePool.length > 0) {
    const delay = Math.max(250, 1000 / STATE.playSpeed);
    STATE.playTimer = setTimeout(() => {
      if (STATE.isPlaying) {
        executeStep();
      }
    }, delay);
  }
}

// Render Board UI from State
function renderBoard() {
  for (let r = 0; r < 6; r++) {
    const rowData = STATE.boardRows[r];
    const pill = document.getElementById(`entropy-pill-${r}`);

    if (rowData.entropyGain !== null) {
      pill.textContent = `-${rowData.entropyGain.toFixed(2)} bit`;
    } else {
      pill.textContent = '- bit';
      pill.style.background = 'rgba(0, 240, 255, 0.08)';
      pill.style.borderColor = 'rgba(0, 240, 255, 0.2)';
    }

    for (let c = 0; c < 5; c++) {
      const tile = document.getElementById(`tile-${r}-${c}`);
      const char = rowData.word[c] || '';
      tile.textContent = char;
      tile.className = 'tile';

      if (char) {
        tile.classList.add('filled');
        if (rowData.feedback[c] === 2) tile.classList.add('correct');
        else if (rowData.feedback[c] === 1) tile.classList.add('present');
        else if (rowData.feedback[c] === 0 && r < STATE.currentStep) tile.classList.add('absent');
      }
    }
  }
}

// Manual tile feedback click toggle for Sandbox Debug Mode
function handleTileClick(r, c) {
  if (r !== STATE.currentStep - 1 && r !== STATE.currentStep) return;
  const currentFb = STATE.boardRows[r].feedback[c];
  const nextFb = (currentFb + 1) % 3;
  STATE.boardRows[r].feedback[c] = nextFb;
  renderBoard();
}

function renderKeyboardClues() {
  document.querySelectorAll('.key-btn').forEach(btn => {
    const char = btn.textContent.trim();
    if (STATE.bannedLetters.has(char)) {
      btn.className = 'key-btn banned';
    } else if (STATE.letterStateMap[char]) {
      btn.className = `key-btn ${STATE.letterStateMap[char]}`;
    } else {
      btn.className = 'key-btn';
    }
  });
}

function updateMetrics(remaining, entropy, latency) {
  DOM.metricRemainingWords.textContent = remaining.toLocaleString();
  const initCount = STATE.decayHistory[0]?.count || (STATE.targetWords.length || 2315);
  const reduction = (((initCount - remaining) / (initCount || 1)) * 100).toFixed(1);
  DOM.metricReductionPct.textContent = `已收斂縮減 ${reduction}%`;
  DOM.metricEntropy.textContent = entropy.toFixed(2);
  DOM.metricLatency.textContent = latency.toFixed(1);
}

// Render dynamic candidate decay curve on HTML Canvas
function renderDecayChart() {
  const canvas = DOM.decayCanvas;
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 20, right: 30, bottom: 25, left: 45 };

  ctx.clearRect(0, 0, w, h);

  // Background grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (h - padding.top - padding.bottom) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }

  const history = STATE.decayHistory;
  if (!history || history.length === 0) return;

  const maxCount = history[0].count || (STATE.targetWords.length || 2315);
  const steps = 6;

  const getX = (step) => padding.left + (step / steps) * (w - padding.left - padding.right);
  const getY = (count) => padding.top + (1 - count / (maxCount || 1)) * (h - padding.top - padding.bottom);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
  grad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
  grad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].count));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(history[i].step), getY(history[i].count));
  }
  ctx.lineTo(getX(history[history.length - 1].step), h - padding.bottom);
  ctx.lineTo(getX(0), h - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2.5;
  ctx.moveTo(getX(0), getY(history[0].count));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(history[i].step), getY(history[i].count));
  }
  ctx.stroke();

  // Points
  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    const px = getX(pt.step);
    const py = getY(pt.count);

    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`${pt.count}`, px - 8, py - 8);
  }

  // Summary
  if (history.length > 1) {
    const last = history[history.length - 1];
    DOM.entropyReductionSummary.textContent = `${history[0].count} → ${last.count} 詞 (-${(history[0].entropy - last.entropy).toFixed(2)} bits)`;
  } else {
    DOM.entropyReductionSummary.textContent = '初始狀態';
  }
}

// Playback Handlers
function startAutoPlay() {
  STATE.isPlaying = true;
  DOM.btnAutoPlay.disabled = true;
  DOM.btnStep.disabled = true;
  DOM.btnPause.disabled = false;
  executeStep();
}

function pausePlayback() {
  STATE.isPlaying = false;
  if (STATE.playTimer) clearTimeout(STATE.playTimer);
  DOM.btnAutoPlay.disabled = false;
  DOM.btnStep.disabled = false;
  DOM.btnPause.disabled = true;
}

// Event Listeners Setup
function setupEventListeners() {
  DOM.btnStep.addEventListener('click', executeStep);
  DOM.btnAutoPlay.addEventListener('click', startAutoPlay);
  DOM.btnPause.addEventListener('click', pausePlayback);
  DOM.btnReset.addEventListener('click', () => {
    pickRandomTarget();
    resetGame();
  });

  DOM.speedSlider.addEventListener('input', (e) => {
    STATE.playSpeed = parseFloat(e.target.value);
    DOM.speedDisplay.textContent = `${STATE.playSpeed.toFixed(1)}x`;
  });

  DOM.btnRandomTarget.addEventListener('click', () => {
    pickRandomTarget();
    resetGame();
  });

  DOM.btnRevealTarget.addEventListener('click', () => {
    STATE.revealSecret = !STATE.revealSecret;
    if (STATE.revealSecret) {
      DOM.targetWordInput.value = STATE.secretWord.toUpperCase();
      DOM.btnRevealTarget.textContent = '🙈 隱藏';
    } else {
      DOM.targetWordInput.value = '*****';
      DOM.btnRevealTarget.textContent = '👁️ 偷看';
    }
  });

  DOM.btnDefineTarget.addEventListener('click', () => {
    if (STATE.secretWord) {
      inspectWordDefinition(STATE.secretWord);
    }
  });

  DOM.targetWordInput.addEventListener('change', (e) => {
    const val = e.target.value.trim().toLowerCase();
    if (val.length === 5 && /^[a-z]+$/.test(val)) {
      STATE.secretWord = val;
      resetGame();
    }
  });

  // Handicap presets
  DOM.btnClearBans.addEventListener('click', () => {
    STATE.bannedLetters.clear();
    updateHandicapUI();
    resetGame();
  });

  DOM.presetCasual.addEventListener('click', () => {
    STATE.bannedLetters.clear();
    updateHandicapUI();
    resetGame();
  });

  DOM.presetVowels.addEventListener('click', () => {
    STATE.bannedLetters = new Set(['E', 'A', 'I', 'O', 'U']);
    updateHandicapUI();
    resetGame();
  });

  DOM.presetConsonants.addEventListener('click', () => {
    STATE.bannedLetters = new Set(['R', 'S', 'T', 'L', 'N']);
    updateHandicapUI();
    resetGame();
  });

  DOM.presetRandom3.addEventListener('click', () => {
    STATE.bannedLetters.clear();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    while (STATE.bannedLetters.size < 3) {
      const idx = Math.floor(Math.random() * alphabet.length);
      STATE.bannedLetters.add(alphabet[idx]);
    }
    updateHandicapUI();
    resetGame();
  });

  // Modals
  DOM.btnPrivacyModal.addEventListener('click', () => DOM.privacyModal.classList.add('open'));
  DOM.btnClosePrivacyModal.addEventListener('click', () => DOM.privacyModal.classList.remove('open'));
  DOM.btnDictModal.addEventListener('click', () => DOM.dictModal.classList.add('open'));
  DOM.btnCloseDictModal.addEventListener('click', () => DOM.dictModal.classList.remove('open'));
  DOM.btnCloseBenchmarkModal.addEventListener('click', () => DOM.benchmarkModal.classList.remove('open'));

  // Custom Dictionary Loader
  DOM.btnApplyCustomDict.addEventListener('click', applyCustomDictionaryFromPaste);
  DOM.btnFetchDictUrl.addEventListener('click', fetchDictionaryFromUrl);
  DOM.dictFileInput.addEventListener('change', handleDictFileUpload);

  // Batch Simulation Benchmark
  DOM.btnBatchBenchmark.addEventListener('click', runBatchBenchmark);
}

function applyCustomDictionaryFromPaste() {
  const text = DOM.dictPasteInput.value.trim();
  if (!text) {
    alert('請輸入或貼上五字母單字庫！');
    return;
  }
  const words = parseWordList(text);
  if (words.length === 0) {
    alert('未找到任何合法的 5 字母英文單字！');
    return;
  }
  setNewDictionary(words, `自訂剪貼簿詞庫 (${words.length} 詞)`);
  DOM.dictModal.classList.remove('open');
}

async function fetchDictionaryFromUrl() {
  const url = DOM.dictUrlInput.value.trim();
  if (!url) {
    alert('請輸入字典 URL！');
    return;
  }
  try {
    DOM.btnFetchDictUrl.textContent = '載入中...';
    const words = await loadExternalDictionary(url);
    if (words.length === 0) {
      alert('載入成功，但未解析出 5 字母單字！');
      return;
    }
    setNewDictionary(words, `遠端 URL 外部詞庫 (${words.length} 詞)`);
    DOM.dictModal.classList.remove('open');
    alert(`成功自遠端載入 ${words.length} 個專用詞彙！`);
  } catch (err) {
    alert(`載入失敗: ${err.message}`);
  } finally {
    DOM.btnFetchDictUrl.textContent = '網路載入';
  }
}

function handleDictFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const text = evt.target.result;
    const words = parseWordList(text);
    if (words.length > 0) {
      setNewDictionary(words, `本機檔案: ${file.name} (${words.length} 詞)`);
      DOM.dictModal.classList.remove('open');
      alert(`成功自檔案載入 ${words.length} 個專用詞彙！`);
    } else {
      alert('未解析出有效的 5 字母單字！');
    }
  };
  reader.readAsText(file);
}

function runBatchBenchmark() {
  DOM.benchmarkModal.classList.add('open');
  DOM.benchmarkResultsContent.innerHTML = '⚡ 正在以 Web Worker 進行 50 局隨機香農熵蒙地卡羅模擬...';
  
  solverWorker.postMessage({
    type: 'BATCH_SIMULATE',
    payload: {
      sampleCount: 50,
      bannedLetters: Array.from(STATE.bannedLetters)
    }
  });
}

function handleSimulationResult(res) {
  const dist = res.distribution || [];
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0 };
  dist.forEach(d => {
    if (d <= 6) counts[d]++;
    else counts.fail++;
  });

  DOM.benchmarkResultsContent.innerHTML = `
    <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; margin-bottom: 0.75rem;">
      <div>🎯 測試局數: <strong>${res.totalTested} 局</strong></div>
      <div>🏆 勝率 (6 步內命中): <strong style="color: var(--accent-green); font-size: 1.1rem;">${res.winRate}%</strong></div>
      <div>⚡ 平均猜測步數: <strong style="color: var(--accent-cyan); font-size: 1.1rem;">${res.avgSteps} 步</strong> (理論最優 < 3.5 次)</div>
      <div>📚 當前字典: <strong>${STATE.currentDictName}</strong></div>
      <div>🚫 當前封印字母: <strong>${STATE.bannedLetters.size > 0 ? Array.from(STATE.bannedLetters).join(', ') : '無'}</strong></div>
    </div>
    
    <div style="font-weight: 700; margin-bottom: 0.4rem; color: var(--accent-blue);">步數分佈長條圖 (Guess Distribution):</div>
    ${[1, 2, 3, 4, 5, 6].map(step => {
      const cnt = counts[step] || 0;
      const pct = ((cnt / res.totalTested) * 100).toFixed(0);
      return `
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span style="width: 45px;">${step} 步:</span>
          <div style="flex: 1; background: rgba(255,255,255,0.06); height: 16px; border-radius: 4px; overflow: hidden;">
            <div style="width: ${pct}%; background: ${step <= 3 ? 'var(--accent-green)' : (step <= 4 ? 'var(--accent-cyan)' : 'var(--accent-yellow)')}; height: 100%;"></div>
          </div>
          <span style="width: 50px; text-align: right;">${cnt} 次 (${pct}%)</span>
        </div>
      `;
    }).join('')}
  `;
}

// Window resize handler for canvas
window.addEventListener('resize', () => {
  renderDecayChart();
});

// Start app
window.addEventListener('DOMContentLoaded', init);
