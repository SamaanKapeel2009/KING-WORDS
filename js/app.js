/* =========================================================
   app.js — KING WORDS main controller
   Wires together storage, api, speech and quiz modules with
   the DOM: navigation, search, word cards, lists, stats.
   ========================================================= */

(function () {
  "use strict";

  const DAILY_GOAL_TARGET = 10;
  const VOCAB_PROGRESS_TARGET = 100; // words, for the progress bar visual

  /* ---------------- Element refs ---------------- */
  const els = {
    navLinks: document.getElementById("navLinks"),
    hamburger: document.getElementById("hamburger"),
    themeToggle: document.getElementById("themeToggle"),
    themeIcon: document.getElementById("themeIcon"),
    toast: document.getElementById("toast"),

    searchForm: document.getElementById("searchForm"),
    wordInput: document.getElementById("wordInput"),
    resultArea: document.getElementById("resultArea"),

    statLearned: document.getElementById("statLearned"),
    statDifficult: document.getElementById("statDifficult"),
    statQuizScore: document.getElementById("statQuizScore"),
    statStreak: document.getElementById("statStreak"),
    progressBarFill: document.getElementById("progressBarFill"),
    progressPercentLabel: document.getElementById("progressPercentLabel"),
    goalBarFill: document.getElementById("goalBarFill"),
    goalLabel: document.getElementById("goalLabel"),

    difficultSearch: document.getElementById("difficultSearch"),
    difficultList: document.getElementById("difficultList"),
    difficultEmpty: document.getElementById("difficultEmpty"),

    sentenceSearch: document.getElementById("sentenceSearch"),
    sentenceList: document.getElementById("sentenceList"),
    sentenceEmpty: document.getElementById("sentenceEmpty"),

    vocabTotal: document.getElementById("vocabTotal"),
    vocabDifficult: document.getElementById("vocabDifficult"),
    vocabLearned: document.getElementById("vocabLearned"),
    vocabTableBody: document.getElementById("vocabTableBody"),
    vocabEmpty: document.getElementById("vocabEmpty"),

    quizIntro: document.getElementById("quizIntro"),
    quizAvailableCount: document.getElementById("quizAvailableCount"),
    startQuizBtn: document.getElementById("startQuizBtn"),
    quizQuestion: document.getElementById("quizQuestion"),
    quizProgress: document.getElementById("quizProgress"),
    quizMeaning: document.getElementById("quizMeaning"),
    quizForm: document.getElementById("quizForm"),
    quizInput: document.getElementById("quizInput"),
    quizFeedback: document.getElementById("quizFeedback"),
    quizNextBtn: document.getElementById("quizNextBtn"),
    quizComplete: document.getElementById("quizComplete"),
    quizScoreText: document.getElementById("quizScoreText"),
    quizCorrectCount: document.getElementById("quizCorrectCount"),
    quizWrongCount: document.getElementById("quizWrongCount"),
    quizAccuracy: document.getElementById("quizAccuracy"),
    retryQuizBtn: document.getElementById("retryQuizBtn"),
    quizEmpty: document.getElementById("quizEmpty"),
  };

  let activeQuiz = null;

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  /* ---------------- Navigation ---------------- */
  function goToPage(pageName) {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("is-active"));
    const target = document.getElementById(`page-${pageName}`);
    if (target) target.classList.add("is-active");

    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === pageName);
    });

    els.navLinks.classList.remove("is-open");
    els.hamburger.classList.remove("is-open");
    els.hamburger.setAttribute("aria-expanded", "false");

    window.scrollTo({ top: 0, behavior: "smooth" });

    if (pageName === "difficult") renderDifficultWords();
    if (pageName === "sentences") renderDifficultSentences();
    if (pageName === "vocabulary") renderVocabularyPage();
    if (pageName === "quiz") resetQuizIntro();
    refreshDashboard();
  }

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => goToPage(btn.dataset.nav));
  });

  els.hamburger.addEventListener("click", () => {
    const isOpen = els.navLinks.classList.toggle("is-open");
    els.hamburger.classList.toggle("is-open", isOpen);
    els.hamburger.setAttribute("aria-expanded", String(isOpen));
  });

  /* ---------------- Theme ---------------- */
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    els.themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
    els.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
  }

  function initTheme() {
    const prefs = KWStorage.getPreferences();
    applyTheme(prefs.theme === "light" ? "light" : "dark");
  }

  els.themeToggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    KWStorage.savePreference("theme", next);
  });

  /* ---------------- Word Search ---------------- */
  els.searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const word = els.wordInput.value.trim();

    if (!word) {
      renderState("error", "Please enter a word to search.");
      return;
    }

    renderState("loading");

    try {
      const data = await KWApi.fetchWordData(word);
      data.paragraph = buildWordParagraph(data);
      data.paragraph.translation = await KWApi._fetchTranslation(
        data.paragraph.text,
        "الترجمة العربية غير متاحة لهذه الفقرة."
      );
      KWStorage.logWord({
        word: data.word,
        meaning: data.arabicMeaning,
        phonetic: data.phonetic,
      });
      KWStorage.incrementDailyGoal();
      renderWordCard(data);
      refreshDashboard();
    } catch (err) {
      renderState("error", err.message || "Unable to find this word. Please check the spelling and try again.");
    }
  });

  /**
   * Builds a short, word-specific paragraph anchored to the word's own
   * real dictionary definition (and example sentence, when available) —
   * deterministic templating, never AI-generated or random. For a word
   * like "psychiatry" this naturally stays on-topic because the
   * definition/example plugged in ARE about psychiatry; the surrounding
   * sentences are just fixed connective wrapper text.
   */
  function buildWordParagraph(data) {
    const word = data.word;
    const title = `Understanding "${word}"`;
    const sentences = [`The word "${word}" is an important English word to know.`];

    if (data.definition) {
      const clean = data.definition.trim().replace(/\.$/, "");
      const lower = clean.charAt(0).toLowerCase() + clean.slice(1);
      sentences.push(`In simple terms, it means ${lower}.`);
    }
    if (data.exampleSentence) {
      sentences.push(`For example: ${data.exampleSentence}`);
    }
    sentences.push(
      `Learning how to use words like "${word}" in real sentences can help you understand and speak English more naturally.`
    );

    return { title, text: sentences.join(" ") };
  }

  function renderState(kind, message) {
    if (kind === "loading") {
      els.resultArea.innerHTML = `
        <div class="state-box">
          <div class="spinner" aria-hidden="true"></div>
          <p>Looking up the word…</p>
        </div>`;
    } else if (kind === "error") {
      els.resultArea.innerHTML = `
        <div class="state-box state-box--error" role="alert">
          <p>⚠️ ${escapeHtml(message)}</p>
        </div>`;
    } else {
      els.resultArea.innerHTML = "";
    }
  }

  function renderWordCard(data) {
    const isSaved = KWStorage.isDifficult(data.word);
    const isSentenceSaved = data.exampleSentence
      ? KWStorage.isSentenceSaved(data.word, data.exampleSentence)
      : false;
    const isParagraphSaved = data.paragraph
      ? KWStorage.isParagraphSaved(data.paragraph.text)
      : false;

    els.resultArea.innerHTML = `
      <div class="word-card ${isSaved ? "is-saved" : ""}" id="wordCard">
        <div class="word-card__head">
          <span class="word-card__word">${escapeHtml(data.word)}</span>
          ${data.partOfSpeech ? `<span class="word-card__pos">${escapeHtml(data.partOfSpeech)}</span>` : ""}
        </div>

        <div class="word-card__row">
          <div class="word-card__label">🇬🇧 Pronunciation</div>
          <div class="word-card__phonetic">${escapeHtml(data.phonetic || "—")}</div>
        </div>

        ${data.definition ? `
        <div class="word-card__row">
          <div class="word-card__label">Definition</div>
          <div class="word-card__definition">${escapeHtml(data.definition)}</div>
        </div>` : ""}

        <div class="word-card__row">
          <div class="word-card__label">🇦🇪 المعنى</div>
          <div class="word-card__arabic">${escapeHtml(data.arabicMeaning || "—")}</div>
        </div>

        <div class="word-card__actions">
          <button class="btn btn--ghost" id="listenBtn" type="button">🔊 Listen</button>
          <button class="btn btn--ghost" id="slowBtn" type="button">🐢 Slow</button>
          <button class="btn ${isSaved ? "btn--primary" : "btn--ghost"} save-btn" id="saveBtn" type="button" aria-pressed="${isSaved}">
            ${isSaved ? "⭐ Saved" : "⭐ Save Word"}
          </button>
        </div>

        <div class="word-card__divider" aria-hidden="true"></div>

        <h3 class="word-card__section-title">📖 Example Sentence</h3>
        <div class="word-card__row">
          <div class="word-card__sentence ${data.exampleSentence ? "" : "word-card__sentence--muted"}">
            ${data.exampleSentence ? escapeHtml(data.exampleSentence) : "Example sentence is not available for this word."}
          </div>
        </div>

        ${data.exampleSentence ? `
        <div class="word-card__row">
          <div class="word-card__arabic word-card__arabic--sentence">${escapeHtml(data.sentenceTranslation)}</div>
        </div>` : ""}

        ${data.exampleSentence ? `
        <div class="word-card__actions">
          <button class="btn btn--ghost" id="listenSentenceBtn" type="button">🔊 Listen</button>
          <button class="btn btn--ghost" id="slowSentenceBtn" type="button">🐢 Slow</button>
          <button class="btn ${isSentenceSaved ? "btn--primary" : "btn--ghost"} save-sentence-btn" id="saveSentenceBtn" type="button" aria-pressed="${isSentenceSaved}">
            ${isSentenceSaved ? "⭐ Sentence Saved" : "⭐ Save Sentence"}
          </button>
        </div>` : ""}

        ${data.paragraph ? `
        <div class="word-card__divider" aria-hidden="true"></div>

        <h3 class="word-card__section-title">📖 Paragraph / Context</h3>
        <div class="word-card__row">
          <div class="word-card__sentence">${escapeHtml(data.paragraph.text)}</div>
        </div>
        <div class="word-card__row">
          <div class="word-card__arabic word-card__arabic--sentence">${escapeHtml(data.paragraph.translation || "—")}</div>
        </div>
        <div class="word-card__actions">
          <button class="btn btn--ghost" id="listenParagraphBtn" type="button">🔊 Listen</button>
          <button class="btn btn--ghost" id="slowParagraphBtn" type="button">🐢 Slow</button>
          <button class="btn ${isParagraphSaved ? "btn--primary" : "btn--ghost"} save-paragraph-btn" id="saveParagraphBtn" type="button" aria-pressed="${isParagraphSaved}">
            ${isParagraphSaved ? "⭐ Saved" : "⭐ Save"}
          </button>
        </div>` : ""}
      </div>
    `;

    const card = document.getElementById("wordCard");
    const listenBtn = document.getElementById("listenBtn");
    const slowBtn = document.getElementById("slowBtn");
    const saveBtn = document.getElementById("saveBtn");

    function speakFrom(btn, speed) {
      if (!KWSpeech.isSupported()) {
        showToast("Your browser does not support voice pronunciation.");
        return;
      }
      btn.classList.add("is-playing");
      btn.disabled = true;
      KWSpeech.speak(data.word, speed, {
        onEnd: () => {
          btn.classList.remove("is-playing");
          btn.disabled = false;
        },
      });
    }

    listenBtn.addEventListener("click", () => speakFrom(listenBtn, "normal"));
    slowBtn.addEventListener("click", () => speakFrom(slowBtn, "slow"));

    saveBtn.addEventListener("click", () => {
      if (KWStorage.isDifficult(data.word)) {
        showToast(`"${data.word}" is already in your saved words.`);
        return;
      }
      KWStorage.saveDifficultWord({
        word: data.word,
        meaning: data.arabicMeaning,
        phonetic: data.phonetic,
        audioUrl: data.audioUrl,
      });
      card.classList.add("is-saved");
      saveBtn.classList.remove("btn--ghost");
      saveBtn.classList.add("btn--primary");
      saveBtn.textContent = "⭐ Saved";
      saveBtn.setAttribute("aria-pressed", "true");
      showToast(`"${data.word}" saved to Difficult Words.`);
      refreshDashboard();
    });

    // Example sentence controls (only present when an example exists).
    if (data.exampleSentence) {
      const listenSentenceBtn = document.getElementById("listenSentenceBtn");
      const slowSentenceBtn = document.getElementById("slowSentenceBtn");
      const saveSentenceBtn = document.getElementById("saveSentenceBtn");

      function speakSentenceFrom(btn, speed) {
        if (!KWSpeech.isSupported()) {
          showToast("Your browser does not support voice pronunciation.");
          return;
        }
        btn.classList.add("is-playing");
        btn.disabled = true;
        KWSpeech.speak(data.exampleSentence, speed, {
          onEnd: () => {
            btn.classList.remove("is-playing");
            btn.disabled = false;
          },
        });
      }

      listenSentenceBtn.addEventListener("click", () => speakSentenceFrom(listenSentenceBtn, "normal"));
      slowSentenceBtn.addEventListener("click", () => speakSentenceFrom(slowSentenceBtn, "slow"));

      saveSentenceBtn.addEventListener("click", () => {
        if (KWStorage.isSentenceSaved(data.word, data.exampleSentence)) {
          showToast("This sentence is already saved.");
          return;
        }
        KWStorage.saveDifficultSentence({
          word: data.word,
          sentence: data.exampleSentence,
          translation: data.sentenceTranslation,
        });
        saveSentenceBtn.classList.remove("btn--ghost");
        saveSentenceBtn.classList.add("btn--primary");
        saveSentenceBtn.textContent = "⭐ Sentence Saved";
        saveSentenceBtn.setAttribute("aria-pressed", "true");
        showToast("Sentence saved to Difficult Sentences.");
      });
    }

    // Paragraph / Context controls (always present — buildWordParagraph
    // always returns a value once word data exists).
    if (data.paragraph) {
      const listenParagraphBtn = document.getElementById("listenParagraphBtn");
      const slowParagraphBtn = document.getElementById("slowParagraphBtn");
      const saveParagraphBtn = document.getElementById("saveParagraphBtn");

      function speakParagraphFrom(btn, speed) {
        if (!KWSpeech.isSupported()) {
          showToast("Your browser does not support voice pronunciation.");
          return;
        }
        btn.classList.add("is-playing");
        btn.disabled = true;
        KWSpeech.speak(data.paragraph.text, speed, {
          onEnd: () => {
            btn.classList.remove("is-playing");
            btn.disabled = false;
          },
        });
      }

      listenParagraphBtn.addEventListener("click", () => speakParagraphFrom(listenParagraphBtn, "normal"));
      slowParagraphBtn.addEventListener("click", () => speakParagraphFrom(slowParagraphBtn, "slow"));

      saveParagraphBtn.addEventListener("click", () => {
        if (KWStorage.isParagraphSaved(data.paragraph.text)) {
          showToast("This paragraph is already saved.");
          return;
        }
        // Reuses the same saved-paragraphs storage already built for the
        // "My Vocabulary -> Reading Passage" feature — no new storage.
        KWStorage.saveParagraph({
          title: data.paragraph.title,
          text: data.paragraph.text,
          translation: data.paragraph.translation,
          words: [data.word],
        });
        saveParagraphBtn.classList.remove("btn--ghost");
        saveParagraphBtn.classList.add("btn--primary");
        saveParagraphBtn.textContent = "⭐ Saved";
        saveParagraphBtn.setAttribute("aria-pressed", "true");
        showToast("Paragraph saved.");
      });
    }
  }

  /* ---------------- Difficult Words Page ---------------- */
  function renderDifficultWords(filter = "") {
    const words = KWStorage.getDifficultWords().filter((w) =>
      w.word.toLowerCase().includes(filter.trim().toLowerCase())
    );

    els.difficultList.innerHTML = "";
    els.difficultEmpty.hidden = words.length > 0;

    words.forEach((entry) => {
      const card = document.createElement("div");
      card.className = "mini-card";
      card.innerHTML = `
        <div class="mini-card__word">${escapeHtml(entry.word)}</div>
        <div class="mini-card__phonetic">${escapeHtml(entry.phonetic || "—")}</div>
        <div class="mini-card__meaning">${escapeHtml(entry.meaning || "—")}</div>
        <div class="mini-card__actions">
          <button class="btn btn--icon listen-btn" type="button">🔊 Listen</button>
          <button class="btn btn--icon slow-btn" type="button">🐢 Slow</button>
          <button class="btn btn--icon btn--danger delete-btn" type="button">🗑️ Delete</button>
        </div>
      `;

      const listenBtn = card.querySelector(".listen-btn");
      const slowBtn = card.querySelector(".slow-btn");
      const deleteBtn = card.querySelector(".delete-btn");

      function speak(btn, speed) {
        if (!KWSpeech.isSupported()) {
          showToast("Your browser does not support voice pronunciation.");
          return;
        }
        btn.classList.add("is-playing");
        btn.disabled = true;
        KWSpeech.speak(entry.word, speed, {
          onEnd: () => {
            btn.classList.remove("is-playing");
            btn.disabled = false;
          },
        });
      }

      listenBtn.addEventListener("click", () => speak(listenBtn, "normal"));
      slowBtn.addEventListener("click", () => speak(slowBtn, "slow"));
      deleteBtn.addEventListener("click", () => {
        KWStorage.deleteDifficultWord(entry.word);
        showToast(`"${entry.word}" removed.`);
        renderDifficultWords(els.difficultSearch.value);
        refreshDashboard();
      });

      els.difficultList.appendChild(card);
    });
  }

  els.difficultSearch.addEventListener("input", (e) => {
    renderDifficultWords(e.target.value);
  });

  /* ---------------- Difficult Sentences Page ---------------- */
  function renderDifficultSentences(filter = "") {
    const term = filter.trim().toLowerCase();
    const sentences = KWStorage.getDifficultSentences().filter(
      (s) =>
        s.word.toLowerCase().includes(term) ||
        s.sentence.toLowerCase().includes(term)
    );

    els.sentenceList.innerHTML = "";
    els.sentenceEmpty.hidden = sentences.length > 0;

    sentences.forEach((entry) => {
      const card = document.createElement("div");
      card.className = "mini-card";
      card.innerHTML = `
        <div class="mini-card__word">${escapeHtml(entry.word)}</div>
        <div class="mini-card__sentence-text">"${escapeHtml(entry.sentence)}"</div>
        <div class="mini-card__meaning">${escapeHtml(entry.translation || "—")}</div>
        <div class="mini-card__actions">
          <button class="btn btn--icon listen-btn" type="button">🔊 Listen</button>
          <button class="btn btn--icon slow-btn" type="button">🐢 Slow</button>
          <button class="btn btn--icon btn--danger delete-btn" type="button">🗑️ Delete</button>
        </div>
      `;

      const listenBtn = card.querySelector(".listen-btn");
      const slowBtn = card.querySelector(".slow-btn");
      const deleteBtn = card.querySelector(".delete-btn");

      function speak(btn, speed) {
        if (!KWSpeech.isSupported()) {
          showToast("Your browser does not support voice pronunciation.");
          return;
        }
        btn.classList.add("is-playing");
        btn.disabled = true;
        KWSpeech.speak(entry.sentence, speed, {
          onEnd: () => {
            btn.classList.remove("is-playing");
            btn.disabled = false;
          },
        });
      }

      listenBtn.addEventListener("click", () => speak(listenBtn, "normal"));
      slowBtn.addEventListener("click", () => speak(slowBtn, "slow"));
      deleteBtn.addEventListener("click", () => {
        KWStorage.deleteDifficultSentence(entry.id);
        showToast("Sentence removed.");
        renderDifficultSentences(els.sentenceSearch.value);
      });

      els.sentenceList.appendChild(card);
    });
  }

  els.sentenceSearch.addEventListener("input", (e) => {
    renderDifficultSentences(e.target.value);
  });

  /* ---------------- My Vocabulary Page ---------------- */
  function renderVocabularyPage() {
    const vocab = KWStorage.getVocabulary();
    const difficultCount = KWStorage.getDifficultWords().length;
    const learnedCount = vocab.filter((w) => w.timesReviewed >= 3).length;

    els.vocabTotal.textContent = vocab.length;
    els.vocabDifficult.textContent = difficultCount;
    els.vocabLearned.textContent = learnedCount;

    els.vocabTableBody.innerHTML = "";
    els.vocabEmpty.hidden = vocab.length > 0;

    vocab.forEach((entry) => {
      const row = document.createElement("tr");
      const date = new Date(entry.dateLearned);
      row.innerHTML = `
        <td class="vocab-table__check-cell">
          <input type="checkbox" class="vocab-row-check" data-word="${escapeHtml(entry.word)}" aria-label="Select ${escapeHtml(entry.word)}">
        </td>
        <td>${escapeHtml(entry.word)}</td>
        <td>${escapeHtml(entry.meaning || "—")}</td>
        <td>${escapeHtml(entry.phonetic || "—")}</td>
        <td>${date.toLocaleDateString()}</td>
        <td>${entry.timesReviewed}</td>
      `;
      els.vocabTableBody.appendChild(row);
    });

    // v2: let study.js know the table was just re-rendered so it can
    // re-wire checkbox listeners and refresh the selection toolbar.
    document.dispatchEvent(new CustomEvent("kw:vocabulary-rendered"));
  }

  /* ---------------- Quiz Page ---------------- */
  function getQuizPool() {
    const difficult = KWStorage.getDifficultWords();
    const vocab = KWStorage.getVocabulary();
    return [...difficult, ...vocab];
  }

  function resetQuizIntro() {
    const pool = getQuizPool();
    const uniqueCount = new Set(pool.map((w) => w.word.toLowerCase())).size;

    els.quizIntro.hidden = false;
    els.quizQuestion.hidden = true;
    els.quizComplete.hidden = true;
    els.quizEmpty.hidden = uniqueCount >= 2;
    els.quizIntro.hidden = uniqueCount < 2;

    els.quizAvailableCount.textContent = `لديك ${uniqueCount} كلمة جاهزة للاختبار.`;

    // v2: when arriving at the Quiz page via the navbar (a normal visit,
    // not a "Test Selected Words" / "Review Weak Words" hand-off), make
    // sure the custom quiz panel from js/study.js is hidden so the two
    // flows never show at once. Guarded so this file still works fine
    // even if study.js/its DOM isn't present.
    const customPanel = document.getElementById("customQuizPanel");
    if (customPanel) customPanel.hidden = true;
  }

  els.startQuizBtn.addEventListener("click", startQuiz);
  els.retryQuizBtn.addEventListener("click", startQuiz);

  function startQuiz() {
    activeQuiz = new KWQuiz(getQuizPool());

    if (activeQuiz.total < 2) {
      resetQuizIntro();
      return;
    }

    els.quizIntro.hidden = true;
    els.quizComplete.hidden = true;
    els.quizQuestion.hidden = false;
    showQuizQuestion();
  }

  function showQuizQuestion() {
    const q = activeQuiz.currentQuestion;
    if (!q) {
      finishQuiz();
      return;
    }
    els.quizProgress.textContent = `Question ${activeQuiz.index + 1} / ${activeQuiz.total}`;
    els.quizMeaning.textContent = q.meaning;
    els.quizInput.value = "";
    els.quizInput.disabled = false;
    els.quizFeedback.hidden = true;
    els.quizNextBtn.hidden = true;
    els.quizForm.querySelector("button[type=submit]").disabled = false;
    els.quizInput.focus();
  }

  els.quizForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeQuiz || els.quizInput.disabled) return;

    const { isCorrect, correctWord } = activeQuiz.checkAnswer(els.quizInput.value);

    els.quizInput.disabled = true;
    els.quizForm.querySelector("button[type=submit]").disabled = true;
    els.quizFeedback.hidden = false;
    els.quizNextBtn.hidden = false;

    if (isCorrect) {
      KWStorage.incrementReview(correctWord);
      els.quizFeedback.className = "quiz-feedback is-correct";
      els.quizFeedback.innerHTML = `🟢 Correct!`;
    } else {
      els.quizFeedback.className = "quiz-feedback is-wrong";
      els.quizFeedback.innerHTML = `🔴 Not quite. Try again.<small>The correct word was: <strong dir="ltr">${escapeHtml(correctWord)}</strong></small>`;
    }
  });

  els.quizNextBtn.addEventListener("click", () => {
    activeQuiz.advance();
    if (activeQuiz.isFinished) {
      finishQuiz();
    } else {
      showQuizQuestion();
    }
  });

  function finishQuiz() {
    const summary = activeQuiz.getSummary();
    KWStorage.saveQuizResult(summary);

    els.quizQuestion.hidden = true;
    els.quizComplete.hidden = false;

    els.quizScoreText.textContent = `${summary.correct} / ${summary.total}`;
    els.quizCorrectCount.textContent = summary.correct;
    els.quizWrongCount.textContent = summary.wrong;
    els.quizAccuracy.textContent = `${summary.accuracy}%`;

    refreshDashboard();
  }

  /* ---------------- Dashboard ---------------- */
  function refreshDashboard() {
    const vocab = KWStorage.getVocabulary();
    const difficult = KWStorage.getDifficultWords();
    const lastAccuracy = KWStorage.getLastQuizAccuracy();
    const streak = KWStorage.getStreak();

    if (els.statLearned) els.statLearned.textContent = vocab.length;
    if (els.statDifficult) els.statDifficult.textContent = difficult.length;
    if (els.statQuizScore) els.statQuizScore.textContent = lastAccuracy === null ? "—" : `${lastAccuracy}%`;
    if (els.statStreak) els.statStreak.textContent = streak.count;

    const progressPercent = Math.min(100, Math.round((vocab.length / VOCAB_PROGRESS_TARGET) * 100));
    if (els.progressBarFill) els.progressBarFill.style.width = `${progressPercent}%`;
    if (els.progressPercentLabel) els.progressPercentLabel.textContent = `${progressPercent}%`;

    const goalCount = Math.min(streak.dailyGoalCount || 0, DAILY_GOAL_TARGET);
    const goalPercent = Math.round((goalCount / DAILY_GOAL_TARGET) * 100);
    if (els.goalBarFill) els.goalBarFill.style.width = `${goalPercent}%`;
    if (els.goalLabel) els.goalLabel.textContent = `${goalCount} / ${DAILY_GOAL_TARGET} Words`;
  }

  /* ---------------- Utilities ---------------- */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }

  /* ---------------- Init ---------------- */
  function init() {
    initTheme();
    KWStorage.touchStreak();
    refreshDashboard();
    goToPage("home");
  }

  document.addEventListener("DOMContentLoaded", init);

  // v2: minimal shared surface for js/study.js (checkbox toolbar on My
  // Vocabulary, custom quiz, weak words, reading passages). Nothing
  // above this line changes behavior — this only *exposes* existing
  // internal helpers so the new file doesn't duplicate them.
  window.KWApp = {
    showToast,
    escapeHtml,
    goToPage,
    refreshDashboard,
    renderVocabularyPage,
  };
})();
