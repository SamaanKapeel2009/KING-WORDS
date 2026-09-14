/* =========================================================
   quiz.js — Vocabulary quiz engine for KING WORDS
   Question source: saved vocabulary + difficult words.
   ========================================================= */

class KWQuiz {
  constructor(pool) {
    // Deduplicate by word, keep only entries that have a usable meaning.
    const map = new Map();
    pool.forEach((entry) => {
      if (entry.word && entry.meaning && entry.meaning !== "—") {
        map.set(entry.word.toLowerCase(), entry);
      }
    });
    this.pool = KWQuiz._shuffle(Array.from(map.values()));
    this.index = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
  }

  static _shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  get total() {
    return this.pool.length;
  }

  get currentQuestion() {
    return this.pool[this.index] || null;
  }

  get isFinished() {
    return this.index >= this.pool.length;
  }

  /**
   * Checks the user's answer against the current word.
   * @param {string} answer
   * @returns {{isCorrect: boolean, correctWord: string}}
   */
  checkAnswer(answer) {
    const question = this.currentQuestion;
    const correctWord = question ? question.word : "";
    const isCorrect =
      answer.trim().toLowerCase() === correctWord.trim().toLowerCase();

    if (isCorrect) this.correctCount += 1;
    else this.wrongCount += 1;

    return { isCorrect, correctWord };
  }

  advance() {
    this.index += 1;
  }

  get accuracy() {
    const answered = this.correctCount + this.wrongCount;
    if (!answered) return 0;
    return Math.round((this.correctCount / answered) * 100);
  }

  getSummary() {
    return {
      score: this.correctCount,
      total: this.total,
      correct: this.correctCount,
      wrong: this.wrongCount,
      accuracy: this.accuracy,
    };
  }
}

/* =========================================================
   KWCustomQuiz — new in v2. Built from a user-chosen word
   selection (e.g. from the My Vocabulary page's checkboxes,
   or the Weak Words review list), with three question types,
   a difficulty setting that controls the type mix, and an
   optional Exam Mode. Entirely separate from KWQuiz above —
   the original "Random Quiz" on the Quiz page is untouched
   and keeps working exactly as before.
   ========================================================= */

const KW_QUESTION_TYPES = {
  EN2AR: "en2ar", // English word shown -> type the Arabic meaning
  AR2EN: "ar2en", // Arabic meaning shown -> type the English word (same as the classic quiz)
  LISTEN: "listen", // Word is spoken -> type the English word
};

class KWCustomQuiz {
  /**
   * @param {Array<{word:string, meaning:string}>} pool
   * @param {{difficulty?: 'easy'|'medium'|'hard', examMode?: boolean}} options
   */
  constructor(pool, options = {}) {
    const map = new Map();
    pool.forEach((entry) => {
      if (entry.word && entry.meaning && entry.meaning !== "—") {
        map.set(entry.word.toLowerCase(), entry);
      }
    });
    const uniquePool = KWQuiz._shuffle(Array.from(map.values()));

    this.difficulty = options.difficulty || "medium";
    this.examMode = !!options.examMode;

    // Difficulty controls the MIX of question types, not just a label:
    //  - Easy: mostly the easiest direction (hearing/recognizing the
    //    English word), a little AR->EN.
    //  - Medium: an even mix of all three types.
    //  - Hard: weighted towards EN->AR (recalling the Arabic meaning
    //    from memory, no hints) and Listen->Write.
    const typeWeights = {
      easy: [KW_QUESTION_TYPES.LISTEN, KW_QUESTION_TYPES.LISTEN, KW_QUESTION_TYPES.AR2EN],
      medium: [KW_QUESTION_TYPES.EN2AR, KW_QUESTION_TYPES.AR2EN, KW_QUESTION_TYPES.LISTEN],
      hard: [KW_QUESTION_TYPES.EN2AR, KW_QUESTION_TYPES.EN2AR, KW_QUESTION_TYPES.LISTEN],
    };
    const weights = typeWeights[this.difficulty] || typeWeights.medium;

    this.pool = uniquePool.map((entry, i) => ({
      ...entry,
      type: weights[i % weights.length],
    }));

    this.index = 0;
    this.correctCount = 0;
    this.wrongCount = 0;
    this.wrongEntries = []; // full entries the user got wrong, for "Review Mistakes"
  }

  get total() {
    return this.pool.length;
  }

  get currentQuestion() {
    return this.pool[this.index] || null;
  }

  get isFinished() {
    return this.index >= this.pool.length;
  }

  /**
   * @param {string} answer
   * @returns {{isCorrect: boolean, correctAnswer: string, question: object}}
   */
  checkAnswer(answer) {
    const question = this.currentQuestion;
    const trimmed = answer.trim().toLowerCase();
    let correctAnswer, isCorrect;

    if (question.type === KW_QUESTION_TYPES.EN2AR) {
      correctAnswer = question.meaning;
      // Arabic answers: compare with surrounding whitespace normalized,
      // exact diacritics aside (kept simple — no fuzzy matching).
      isCorrect = trimmed === question.meaning.trim().toLowerCase();
    } else {
      // AR2EN and LISTEN both expect the English word typed back.
      correctAnswer = question.word;
      isCorrect = trimmed === question.word.trim().toLowerCase();
    }

    if (isCorrect) {
      this.correctCount += 1;
    } else {
      this.wrongCount += 1;
      this.wrongEntries.push(question);
    }

    return { isCorrect, correctAnswer, question };
  }

  advance() {
    this.index += 1;
  }

  get accuracy() {
    const answered = this.correctCount + this.wrongCount;
    if (!answered) return 0;
    return Math.round((this.correctCount / answered) * 100);
  }

  getSummary() {
    return {
      score: this.correctCount,
      total: this.total,
      correct: this.correctCount,
      wrong: this.wrongCount,
      accuracy: this.accuracy,
      wrongEntries: this.wrongEntries,
      difficulty: this.difficulty,
      examMode: this.examMode,
    };
  }
}
