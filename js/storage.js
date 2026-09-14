/* =========================================================
   storage.js — LocalStorage layer for KING WORDS
   Handles: saved (difficult) words, saved (difficult) sentences,
   vocabulary log, quiz results, learning streak, and user
   preferences. Frontend-only — everything persists in the
   browser's localStorage, no backend/server involved.
   ========================================================= */

const KW_STORAGE_KEYS = {
  DIFFICULT: "kw_difficult_words",
  SENTENCES: "kw_difficult_sentences",
  VOCABULARY: "kw_vocabulary",
  QUIZ_RESULTS: "kw_quiz_results",
  STREAK: "kw_streak",
  PREFS: "kw_preferences",
  // New in v2 — additive keys only, nothing above this line changed,
  // so existing saved data from earlier versions keeps working as-is.
  WEAK_WORDS: "kw_weak_words",
  PARAGRAPHS: "kw_saved_paragraphs",
};

/** Small unique id helper for entries that need one locally (sentences). */
function kwUid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Returns true if localStorage is available in this browser. */
function kwStorageAvailable() {
  try {
    const testKey = "__kw_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

const KW_HAS_STORAGE = kwStorageAvailable();

function kwRead(key, fallback) {
  if (!KW_HAS_STORAGE) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("KING WORDS: failed to read", key, e);
    return fallback;
  }
}

function kwWrite(key, value) {
  if (!KW_HAS_STORAGE) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("KING WORDS: failed to write", key, e);
    return false;
  }
}

const KWStorage = {

  /* ---------------- Difficult Words ---------------- */
  getDifficultWords() {
    return kwRead(KW_STORAGE_KEYS.DIFFICULT, []);
  },

  isDifficult(word) {
    return this.getDifficultWords().some(
      (w) => w.word.toLowerCase() === word.toLowerCase()
    );
  },

  saveDifficultWord(entry) {
    const list = this.getDifficultWords();
    if (this.isDifficult(entry.word)) return list;
    const record = {
      word: entry.word,
      meaning: entry.meaning,
      phonetic: entry.phonetic, // pronunciation (IPA)
      audioUrl: entry.audioUrl || null,
      dateAdded: new Date().toISOString(),
      reviewCount: 1,
    };
    list.unshift(record);
    kwWrite(KW_STORAGE_KEYS.DIFFICULT, list);
    return list;
  },

  deleteDifficultWord(word) {
    const list = this.getDifficultWords().filter(
      (w) => w.word.toLowerCase() !== word.toLowerCase()
    );
    kwWrite(KW_STORAGE_KEYS.DIFFICULT, list);
    return list;
  },

  incrementDifficultWordReview(word) {
    const list = this.getDifficultWords();
    const idx = list.findIndex((w) => w.word.toLowerCase() === word.toLowerCase());
    if (idx >= 0) {
      list[idx].reviewCount = (list[idx].reviewCount || 0) + 1;
      kwWrite(KW_STORAGE_KEYS.DIFFICULT, list);
    }
    return list;
  },

  /* ---------------- Difficult Sentences ---------------- */
  getDifficultSentences() {
    return kwRead(KW_STORAGE_KEYS.SENTENCES, []);
  },

  isSentenceSaved(word, sentence) {
    return this.getDifficultSentences().some(
      (s) =>
        s.word.toLowerCase() === word.toLowerCase() &&
        s.sentence.toLowerCase() === sentence.toLowerCase()
    );
  },

  saveDifficultSentence(entry) {
    if (this.isSentenceSaved(entry.word, entry.sentence)) {
      return this.getDifficultSentences();
    }
    const list = this.getDifficultSentences();
    const record = {
      id: kwUid(),
      word: entry.word,
      sentence: entry.sentence,
      translation: entry.translation,
      dateAdded: new Date().toISOString(),
      reviewCount: 1,
    };
    list.unshift(record);
    kwWrite(KW_STORAGE_KEYS.SENTENCES, list);
    return list;
  },

  deleteDifficultSentence(id) {
    const list = this.getDifficultSentences().filter((s) => s.id !== id);
    kwWrite(KW_STORAGE_KEYS.SENTENCES, list);
    return list;
  },

  /* ---------------- Vocabulary Log ---------------- */
  getVocabulary() {
    return kwRead(KW_STORAGE_KEYS.VOCABULARY, []);
  },

  /** Adds a new word to the vocabulary log, or increments its review count if it exists. */
  logWord(entry) {
    const list = this.getVocabulary();
    const idx = list.findIndex(
      (w) => w.word.toLowerCase() === entry.word.toLowerCase()
    );
    if (idx >= 0) {
      list[idx].timesReviewed += 1;
      list[idx].meaning = entry.meaning || list[idx].meaning;
      list[idx].phonetic = entry.phonetic || list[idx].phonetic;
    } else {
      list.unshift({
        word: entry.word,
        meaning: entry.meaning,
        phonetic: entry.phonetic,
        dateLearned: new Date().toISOString(),
        timesReviewed: 1,
      });
    }
    kwWrite(KW_STORAGE_KEYS.VOCABULARY, list);
    return list;
  },

  incrementReview(word) {
    const list = this.getVocabulary();
    const idx = list.findIndex(
      (w) => w.word.toLowerCase() === word.toLowerCase()
    );
    if (idx >= 0) {
      list[idx].timesReviewed += 1;
      kwWrite(KW_STORAGE_KEYS.VOCABULARY, list);
    }
    return list;
  },

  /* ---------------- Quiz Results ---------------- */
  getQuizResults() {
    return kwRead(KW_STORAGE_KEYS.QUIZ_RESULTS, []);
  },

  saveQuizResult(result) {
    const list = this.getQuizResults();
    list.unshift({ ...result, date: new Date().toISOString() });
    kwWrite(KW_STORAGE_KEYS.QUIZ_RESULTS, list.slice(0, 50));
    return list;
  },

  getLastQuizAccuracy() {
    const list = this.getQuizResults();
    return list.length ? list[0].accuracy : null;
  },

  /* ---------------- Learning Streak ---------------- */
  getStreak() {
    return kwRead(KW_STORAGE_KEYS.STREAK, { count: 0, lastVisit: null, dailyGoalDate: null, dailyGoalCount: 0 });
  },

  /** Call once per session load; updates the streak count based on calendar days. */
  touchStreak() {
    const streak = this.getStreak();
    const today = new Date().toDateString();

    if (streak.lastVisit === today) {
      return streak; // already counted today
    }

    if (streak.lastVisit) {
      const last = new Date(streak.lastVisit);
      const diffDays = Math.round((new Date(today) - last) / 86400000);
      streak.count = diffDays === 1 ? streak.count + 1 : 1;
    } else {
      streak.count = 1;
    }

    streak.lastVisit = today;

    // Reset the daily goal counter on a new day
    if (streak.dailyGoalDate !== today) {
      streak.dailyGoalDate = today;
      streak.dailyGoalCount = 0;
    }

    kwWrite(KW_STORAGE_KEYS.STREAK, streak);
    return streak;
  },

  incrementDailyGoal() {
    const streak = this.getStreak();
    const today = new Date().toDateString();
    if (streak.dailyGoalDate !== today) {
      streak.dailyGoalDate = today;
      streak.dailyGoalCount = 0;
    }
    streak.dailyGoalCount += 1;
    kwWrite(KW_STORAGE_KEYS.STREAK, streak);
    return streak;
  },

  /* ---------------- Preferences ---------------- */
  getPreferences() {
    return kwRead(KW_STORAGE_KEYS.PREFS, { theme: "dark" });
  },

  savePreference(key, value) {
    const prefs = this.getPreferences();
    prefs[key] = value;
    kwWrite(KW_STORAGE_KEYS.PREFS, prefs);
    return prefs;
  },

  /* ---------------- Vocabulary: bulk delete (for checkbox selection) ---------------- */
  deleteVocabularyWords(words) {
    const lower = new Set(words.map((w) => w.toLowerCase()));
    const list = this.getVocabulary().filter((w) => !lower.has(w.word.toLowerCase()));
    kwWrite(KW_STORAGE_KEYS.VOCABULARY, list);
    return list;
  },

  /* ---------------- Weak Words (repeated quiz mistakes) ---------------- */
  getWeakWords() {
    return kwRead(KW_STORAGE_KEYS.WEAK_WORDS, []);
  },

  /** Called whenever a quiz answer is wrong. Tracks a miss count per word. */
  recordWrongAnswer(word, meaning) {
    const list = this.getWeakWords();
    const idx = list.findIndex((w) => w.word.toLowerCase() === word.toLowerCase());
    if (idx >= 0) {
      list[idx].missCount += 1;
      list[idx].lastMissed = new Date().toISOString();
      if (meaning) list[idx].meaning = meaning;
    } else {
      list.unshift({ word, meaning: meaning || "", missCount: 1, lastMissed: new Date().toISOString() });
    }
    kwWrite(KW_STORAGE_KEYS.WEAK_WORDS, list);
    return list;
  },

  /** Called when a previously-weak word is answered correctly — softens its count. */
  recordCorrectAnswer(word) {
    const list = this.getWeakWords();
    const idx = list.findIndex((w) => w.word.toLowerCase() === word.toLowerCase());
    if (idx >= 0) {
      list[idx].missCount = Math.max(0, list[idx].missCount - 1);
      if (list[idx].missCount === 0) list.splice(idx, 1);
      kwWrite(KW_STORAGE_KEYS.WEAK_WORDS, list);
    }
    return list;
  },

  clearWeakWord(word) {
    const list = this.getWeakWords().filter((w) => w.word.toLowerCase() !== word.toLowerCase());
    kwWrite(KW_STORAGE_KEYS.WEAK_WORDS, list);
    return list;
  },

  /* ---------------- Saved Reading Paragraphs ---------------- */
  getParagraphs() {
    return kwRead(KW_STORAGE_KEYS.PARAGRAPHS, []);
  },

  isParagraphSaved(text) {
    return this.getParagraphs().some((p) => p.text === text);
  },

  saveParagraph(entry) {
    const list = this.getParagraphs();
    const record = {
      id: kwUid(),
      title: entry.title,
      text: entry.text,
      translation: entry.translation || null,
      words: entry.words || [],
      dateAdded: new Date().toISOString(),
    };
    list.unshift(record);
    kwWrite(KW_STORAGE_KEYS.PARAGRAPHS, list);
    return list;
  },

  deleteParagraph(id) {
    const list = this.getParagraphs().filter((p) => p.id !== id);
    kwWrite(KW_STORAGE_KEYS.PARAGRAPHS, list);
    return list;
  },
};
