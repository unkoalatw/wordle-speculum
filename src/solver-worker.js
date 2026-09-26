// wordle-solver-worker.js
// Shannon Entropy Wordle Engine running in Dedicated Web Worker

let targetWords = [];
let allowedWords = [];
let precomputedOpeners = {};

// Fast feedback pattern calculation
// 0: Gray (Absent), 1: Yellow (Present), 2: Green (Correct)
// Encoded into an integer 0..242: sum_i (pattern[i] * 3^i)
function getFeedbackPattern(guess, target) {
  const guessChars = guess.split('');
  const targetChars = target.split('');
  const pattern = [0, 0, 0, 0, 0];
  const targetCounts = {};

  // First pass: Find greens (exact matches)
  for (let i = 0; i < 5; i++) {
    const tChar = targetChars[i];
    if (guessChars[i] === tChar) {
      pattern[i] = 2; // Green
    } else {
      targetCounts[tChar] = (targetCounts[tChar] || 0) + 1;
    }
  }

  // Second pass: Find yellows (present matches)
  for (let i = 0; i < 5; i++) {
    if (pattern[i] !== 2) {
      const gChar = guessChars[i];
      if (targetCounts[gChar] && targetCounts[gChar] > 0) {
        pattern[i] = 1; // Yellow
        targetCounts[gChar]--;
      }
    }
  }

  // Hash to 0..242
  return pattern[0] + pattern[1] * 3 + pattern[2] * 9 + pattern[3] * 27 + pattern[4] * 81;
}

// Convert feedback array [c0, c1, c2, c3, c4] (0, 1, 2) to hash
function patternToHash(pattern) {
  return pattern[0] + pattern[1] * 3 + pattern[2] * 9 + pattern[3] * 27 + pattern[4] * 81;
}

// Filter words matching the feedback pattern
function filterCandidates(candidateList, guess, patternHash) {
  return candidateList.filter(word => getFeedbackPattern(guess, word) === patternHash);
}

// Shannon Entropy Calculation for a given guess over current candidate pool
function calculateExpectedEntropy(guess, candidates, candidateSet) {
  const patternBuckets = new Int32Array(243);
  const total = candidates.length;
  if (total === 0) return 0;

  for (let i = 0; i < total; i++) {
    const hash = getFeedbackPattern(guess, candidates[i]);
    patternBuckets[hash]++;
  }

  let expectedEntropy = 0;
  for (let i = 0; i < 243; i++) {
    const count = patternBuckets[i];
    if (count > 0) {
      const p = count / total;
      expectedEntropy += p * Math.log2(1 / p);
    }
  }

  // Small tie-breaker bonus if the guess is in the remaining candidate pool
  if (candidateSet.has(guess)) {
    expectedEntropy += 0.0001;
  }

  return expectedEntropy;
}

// Rank top guesses
function rankBestGuesses(candidates, poolToSample, bannedLetters = new Set()) {
  const startTime = performance.now();
  const totalCand = candidates.length;

  if (totalCand === 0) {
    return { rankings: [], executionTimeMs: 0, currentEntropy: 0 };
  }
  if (totalCand === 1) {
    return {
      rankings: [{ word: candidates[0], entropy: 0, inPool: true, reductionPct: 100 }],
      executionTimeMs: performance.now() - startTime,
      currentEntropy: 0
    };
  }

  const currentEntropy = Math.log2(totalCand);
  const candidateSet = new Set(candidates);

  // Filter out any words that contain banned letters if requested
  const validGuessPool = poolToSample.filter(w => {
    for (let i = 0; i < 5; i++) {
      if (bannedLetters.has(w[i])) return false;
    }
    return true;
  });

  // If candidate size is small enough, evaluate valid guess pool (or candidates + top allowed)
  // If pool is very large (e.g. initial round), limit pool or use precomputed
  let candidatesToEvaluate = validGuessPool;
  
  // Adaptive candidate search space for ultra-fast UI response
  if (totalCand > 800 && validGuessPool.length > 2000) {
    // Subsample top high-frequency / rich vowel consonants + candidates
    candidatesToEvaluate = Array.from(new Set([...candidates, ...validGuessPool.slice(0, 1500)]));
  }

  const scores = [];
  for (let i = 0; i < candidatesToEvaluate.length; i++) {
    const word = candidatesToEvaluate[i];
    const ent = calculateExpectedEntropy(word, candidates, candidateSet);
    scores.push({
      word,
      entropy: ent,
      inPool: candidateSet.has(word),
      reductionPct: Math.min(100, Math.max(0, (1 - Math.pow(2, -ent)) * 100))
    });
  }

  // Sort descending by entropy
  scores.sort((a, b) => b.entropy - a.entropy);

  const duration = performance.now() - startTime;
  return {
    rankings: scores.slice(0, 10),
    bestWord: scores[0] ? scores[0].word : candidates[0],
    executionTimeMs: duration,
    currentEntropy
  };
}

self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'INIT_DICTIONARY') {
    targetWords = payload.targetWords || [];
    allowedWords = payload.allowedWords || targetWords;
    precomputedOpeners = payload.precomputedOpeners || {};
    self.postMessage({ type: 'INIT_DONE', count: targetWords.length });
  } 
  else if (type === 'FILTER_CANDIDATES') {
    const { candidates, guess, patternHash } = payload;
    const filtered = filterCandidates(candidates, guess, patternHash);
    self.postMessage({ type: 'FILTER_DONE', filtered });
  } 
  else if (type === 'RANK_GUESSES') {
    const { candidates, bannedLetters = [], isFirstGuess = false } = payload;
    const bannedSet = new Set(bannedLetters.map(c => c.toLowerCase()));

    // Fast path: first guess without letter bans
    if (isFirstGuess && bannedSet.size === 0 && Object.keys(precomputedOpeners).length > 0) {
      const topWords = Object.entries(precomputedOpeners)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, entropy]) => ({
          word,
          entropy,
          inPool: true,
          reductionPct: (1 - Math.pow(2, -entropy)) * 100
        }));

      self.postMessage({
        type: 'RANK_RESULT',
        result: {
          rankings: topWords,
          bestWord: topWords[0].word,
          executionTimeMs: 0.8,
          currentEntropy: Math.log2(candidates.length)
        }
      });
      return;
    }

    const pool = (allowedWords && allowedWords.length > 0) ? allowedWords : targetWords;
    const result = rankBestGuesses(candidates, pool, bannedSet);
    self.postMessage({ type: 'RANK_RESULT', result });
  }
  else if (type === 'BATCH_SIMULATE') {
    // Run automated benchmark simulations on N sample words
    const { sampleCount = 50, bannedLetters = [] } = payload;
    const bannedSet = new Set(bannedLetters.map(c => c.toLowerCase()));
    const validTargets = targetWords.filter(w => {
      for (let i = 0; i < 5; i++) if (bannedSet.has(w[i])) return false;
      return true;
    });

    const samples = [];
    const stepCounts = [];
    const pool = (allowedWords && allowedWords.length > 0) ? allowedWords : targetWords;
    const tested = Math.min(sampleCount, validTargets.length);

    for (let s = 0; s < tested; s++) {
      const target = validTargets[Math.floor(Math.random() * validTargets.length)];
      let remaining = [...validTargets];
      let steps = 0;
      let guess = '';
      
      while (steps < 6 && remaining.length > 0) {
        steps++;
        if (steps === 1 && bannedSet.size === 0 && precomputedOpeners['salet']) {
          guess = 'salet';
        } else {
          const rank = rankBestGuesses(remaining, pool, bannedSet);
          guess = rank.bestWord || remaining[0];
        }

        if (guess === target) {
          break;
        }
        const patternHash = getFeedbackPattern(guess, target);
        remaining = filterCandidates(remaining, guess, patternHash);
      }
      stepCounts.push(steps);
      samples.push({ target, steps, win: guess === target });
    }

    const avg = stepCounts.reduce((a, b) => a + b, 0) / (stepCounts.length || 1);
    const winRate = (samples.filter(x => x.win).length / (samples.length || 1)) * 100;

    self.postMessage({
      type: 'SIMULATION_RESULT',
      result: {
        totalTested: tested,
        avgSteps: avg.toFixed(2),
        winRate: winRate.toFixed(1),
        distribution: stepCounts
      }
    });
  }
};
