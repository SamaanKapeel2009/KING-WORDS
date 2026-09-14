/* =========================================================
   study.js — KING WORDS v2 additions
   Adds (without touching the original quiz/search/save flows):
     - My Vocabulary: checkbox multi-select + toolbar
       (Delete / Custom Quiz / Reading Passage)
     - Custom quiz engine wiring: 3 question types, difficulty,
       Exam Mode, results + "Review Mistakes"
     - Weak Words tracking + review
     - Reading passage generator (template-based, NOT AI) built
       from selected words, with Listen/Slow, Arabic translation
       (reusing the existing MyMemory -> Lingva pipeline), saving,
       and a reading-comprehension quiz built from the passage
       itself.
   Relies on window.KWApp (exposed by app.js) for shared helpers,
   and on KWStorage / KWSpeech / KWApi / KWQuiz / KWCustomQuiz.
   ========================================================= */

(function () {
  "use strict";

  const { showToast, escapeHtml, goToPage, refreshDashboard, renderVocabularyPage } = window.KWApp;

  /* =========================================================
     1. My Vocabulary — checkbox selection + toolbar
     ========================================================= */
  const selectedWords = new Set();

  function updateVocabToolbar() {
    const toolbar = document.getElementById("vocabToolbar");
    const countLabel = document.getElementById("vocabSelectedCount");
    const n = selectedWords.size;
    toolbar.hidden = n === 0;
    countLabel.textContent = `${n} محددة`;
  }

  function wireVocabCheckboxes() {
    selectedWords.clear();
    updateVocabToolbar();

    const headCheck = document.getElementById("vocabHeadCheck");
    headCheck.checked = false;

    const rowChecks = Array.from(document.querySelectorAll(".vocab-row-check"));
    rowChecks.forEach((cb) => {
      cb.checked = false;
      cb.addEventListener("change", () => {
        if (cb.checked) selectedWords.add(cb.dataset.word);
        else selectedWords.delete(cb.dataset.word);
        headCheck.checked = rowChecks.length > 0 && rowChecks.every((c) => c.checked);
        updateVocabToolbar();
      });
    });

    headCheck.onchange = () => {
      rowChecks.forEach((cb) => {
        cb.checked = headCheck.checked;
        if (headCheck.checked) selectedWords.add(cb.dataset.word);
        else selectedWords.delete(cb.dataset.word);
      });
      updateVocabToolbar();
    };
  }

  // app.js dispatches this every time the vocabulary table is (re)rendered.
  document.addEventListener("kw:vocabulary-rendered", wireVocabCheckboxes);

  document.getElementById("vocabDeleteBtn").addEventListener("click", () => {
    if (!selectedWords.size) return;
    const words = Array.from(selectedWords);
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف ${words.length} كلمة من قائمتك؟ لا يمكن التراجع عن هذا الإجراء.`
    );
    if (!confirmed) return;

    KWStorage.deleteVocabularyWords(words);
    showToast(`تم حذف ${words.length} كلمة.`);
    selectedWords.clear();
    renderVocabularyPage();
    refreshDashboard();
  });

  document.getElementById("vocabQuizBtn").addEventListener("click", () => {
    if (selectedWords.size < 2) {
      showToast("حدد كلمتين على الأقل لبدء الاختبار.");
      return;
    }
    const vocab = KWStorage.getVocabulary();
    const pool = vocab.filter((w) => selectedWords.has(w.word));
    goToPage("quiz");
    renderWeakWords();
    startCustomQuizSetup(pool, `اختبار مخصص — ${pool.length} كلمة محددة`);
  });

  document.getElementById("vocabParagraphBtn").addEventListener("click", () => {
    if (!selectedWords.size) {
      showToast("حدد كلمة واحدة على الأقل لإنشاء قطعة قراءة.");
      return;
    }
    const vocab = KWStorage.getVocabulary();
    const words = vocab.filter((w) => selectedWords.has(w.word));
    generateReadingPassage(words);
    goToPage("reading");
  });

  /* =========================================================
     2. Weak Words
     ========================================================= */
  function renderWeakWords() {
    const card = document.getElementById("weakWordsCard");
    const list = document.getElementById("weakWordsList");
    const weak = KWStorage.getWeakWords();

    card.hidden = weak.length === 0;
    list.innerHTML = "";
    weak.forEach((w) => {
      const chip = document.createElement("span");
      chip.className = "weak-word-chip";
      chip.textContent = `${w.word} ×${w.missCount}`;
      list.appendChild(chip);
    });
  }

  document.getElementById("reviewWeakWordsBtn").addEventListener("click", () => {
    const weak = KWStorage.getWeakWords();
    if (weak.length < 2) {
      showToast("تحتاج كلمتين ضعيفتين على الأقل لبدء المراجعة.");
      return;
    }
    const pool = weak.map((w) => ({ word: w.word, meaning: w.meaning }));
    startCustomQuizSetup(pool, `مراجعة الكلمات الضعيفة — ${pool.length} كلمة`);
  });

  // Refresh the weak-words panel every time the Quiz nav link is used too
  // (covers the normal "click the navbar" path, in addition to the
  // programmatic goToPage("quiz") calls above).
  document.querySelectorAll('[data-nav="quiz"]').forEach((btn) => {
    btn.addEventListener("click", renderWeakWords);
  });

  /* =========================================================
     3. Custom Quiz (types + difficulty + Exam Mode)
     ========================================================= */
  let activeCustomQuiz = null;
  let pendingPool = [];
  let pendingDifficulty = "easy";

  function startCustomQuizSetup(pool, label) {
    pendingPool = pool;

    document.getElementById("quizIntro").hidden = true;
    document.getElementById("quizQuestion").hidden = true;
    document.getElementById("quizComplete").hidden = true;
    document.getElementById("quizEmpty").hidden = true;
    document.getElementById("weakWordsCard").hidden = true;

    const panel = document.getElementById("customQuizPanel");
    panel.hidden = false;
    document.getElementById("customQuizSetup").hidden = false;
    document.getElementById("customQuizQuestion").hidden = true;
    document.getElementById("customQuizComplete").hidden = true;
    document.getElementById("customQuizSourceLabel").textContent = label;

    // Reset setup controls to defaults each time.
    pendingDifficulty = "easy";
    document.querySelectorAll(".difficulty-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.difficulty === "easy")
    );
    document.getElementById("examModeToggle").checked = false;
  }

  document.querySelectorAll(".difficulty-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".difficulty-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      pendingDifficulty = btn.dataset.difficulty;
    });
  });

  document.getElementById("customQuizStartBtn").addEventListener("click", () => {
    if (pendingPool.length < 2) {
      showToast("تحتاج كلمتين على الأقل لبدء الاختبار.");
      return;
    }
    const examMode = document.getElementById("examModeToggle").checked;
    activeCustomQuiz = new KWCustomQuiz(pendingPool, { difficulty: pendingDifficulty, examMode });

    document.getElementById("customQuizSetup").hidden = true;
    document.getElementById("customQuizQuestion").hidden = false;
    showCustomQuestion();
  });

  function speakWord(word, speed) {
    if (!KWSpeech.isSupported()) {
      showToast("Your browser does not support voice pronunciation.");
      return;
    }
    KWSpeech.speak(word, speed || "normal", {});
  }

  function showCustomQuestion() {
    const q = activeCustomQuiz.currentQuestion;
    if (!q) {
      finishCustomQuiz();
      return;
    }

    document.getElementById("customQuizProgress").textContent =
      `Question ${activeCustomQuiz.index + 1} / ${activeCustomQuiz.total}`;

    const promptLabel = document.getElementById("customQuizPrompt");
    const promptText = document.getElementById("customQuizPromptText");
    const replayBtn = document.getElementById("customQuizReplayBtn");
    const input = document.getElementById("customQuizInput");

    input.value = "";
    input.disabled = false;
    document.getElementById("customQuizFeedback").hidden = true;
    document.getElementById("customQuizNextBtn").hidden = true;
    document.getElementById("customQuizForm").querySelector("button[type=submit]").disabled = false;

    if (q.type === "en2ar") {
      promptLabel.textContent = "🇬🇧 What does this word mean in Arabic?";
      promptText.textContent = q.word;
      promptText.dir = "ltr";
      replayBtn.hidden = true;
      input.placeholder = "اكتب المعنى بالعربية...";
      input.dir = "rtl";
    } else if (q.type === "ar2en") {
      promptLabel.textContent = "🇦🇪 ما معنى هذه الكلمة؟";
      promptText.textContent = q.meaning;
      promptText.dir = "rtl";
      replayBtn.hidden = true;
      input.placeholder = "Type the English word...";
      input.dir = "ltr";
    } else {
      // listen
      promptLabel.textContent = "🔊 Listen, then type the word you heard";
      promptText.textContent = "🎧 …";
      promptText.dir = "ltr";
      replayBtn.hidden = false;
      input.placeholder = "Type the word you heard...";
      input.dir = "ltr";
      speakWord(q.word, "normal");
    }

    input.focus();
  }

  document.getElementById("customQuizReplayBtn").addEventListener("click", () => {
    const q = activeCustomQuiz && activeCustomQuiz.currentQuestion;
    if (q) speakWord(q.word, "normal");
  });

  document.getElementById("customQuizForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeCustomQuiz) return;
    const input = document.getElementById("customQuizInput");
    if (input.disabled) return;

    const { isCorrect, correctAnswer, question } = activeCustomQuiz.checkAnswer(input.value);
    input.disabled = true;
    document.getElementById("customQuizForm").querySelector("button[type=submit]").disabled = true;

    if (isCorrect) {
      KWStorage.recordCorrectAnswer(question.word);
    } else {
      KWStorage.recordWrongAnswer(question.word, question.meaning);
    }

    if (activeCustomQuiz.examMode) {
      // Exam Mode: no per-question feedback — advance immediately,
      // the result only appears at the very end.
      activeCustomQuiz.advance();
      if (activeCustomQuiz.isFinished) finishCustomQuiz();
      else showCustomQuestion();
      return;
    }

    const feedback = document.getElementById("customQuizFeedback");
    feedback.hidden = false;
    document.getElementById("customQuizNextBtn").hidden = false;

    if (isCorrect) {
      feedback.className = "quiz-feedback is-correct";
      feedback.innerHTML = "🟢 Correct!";
    } else {
      feedback.className = "quiz-feedback is-wrong";
      feedback.innerHTML = `🔴 Not quite.<small>Correct answer: <strong>${escapeHtml(correctAnswer)}</strong></small>`;
    }
  });

  document.getElementById("customQuizNextBtn").addEventListener("click", () => {
    activeCustomQuiz.advance();
    if (activeCustomQuiz.isFinished) finishCustomQuiz();
    else showCustomQuestion();
  });

  let lastWrongEntries = [];

  function finishCustomQuiz() {
    const summary = activeCustomQuiz.getSummary();
    lastWrongEntries = summary.wrongEntries;

    document.getElementById("customQuizQuestion").hidden = true;
    document.getElementById("customQuizComplete").hidden = false;

    document.getElementById("customQuizScoreText").textContent = `${summary.correct} / ${summary.total}`;
    document.getElementById("customQuizCorrectCount").textContent = summary.correct;
    document.getElementById("customQuizWrongCount").textContent = summary.wrong;
    document.getElementById("customQuizAccuracy").textContent = `${summary.accuracy}%`;

    const reviewSection = document.getElementById("customQuizReviewSection");
    const wrongList = document.getElementById("customQuizWrongList");
    wrongList.innerHTML = "";

    if (summary.wrongEntries.length) {
      reviewSection.hidden = false;
      summary.wrongEntries.forEach((w) => {
        const li = document.createElement("li");
        li.textContent = `${w.word} — ${w.meaning}`;
        wrongList.appendChild(li);
      });
    } else {
      reviewSection.hidden = true;
    }

    renderWeakWords();
    refreshDashboard();
  }

  document.getElementById("reviewMistakesBtn").addEventListener("click", () => {
    if (lastWrongEntries.length < 2) {
      showToast("تحتاج كلمتين خاطئتين على الأقل لإعادة الاختبار.");
      return;
    }
    startCustomQuizSetup(lastWrongEntries, `مراجعة الأخطاء — ${lastWrongEntries.length} كلمة`);
  });

  document.getElementById("customQuizRetryBtn").addEventListener("click", () => {
    startCustomQuizSetup(pendingPool, document.getElementById("customQuizSourceLabel").textContent);
  });

  document.getElementById("customQuizBackBtn").addEventListener("click", () => {
    document.getElementById("customQuizPanel").hidden = true;
    goToPage("vocabulary");
  });

  /* =========================================================
     4. Reading Passage generator (template-based — NOT AI)
     ========================================================= */

  // Small, hand-written sentence templates grouped by a rough guessed
  // part of speech. Deterministic and reproducible — the same word
  // always slots into the same kind of sentence, so nothing here is
  // randomly invented text; it is real English scaffolding filled
  // with the user's own saved words.
  const READING_TEMPLATES = {
    verb: [
      (w) => `This passage often refers to the idea of "${w}".`,
      (w) => `People think about "${w}" in many everyday situations.`,
      (w) => `The word "${w}" is used here to describe something happening.`,
    ],
    adjective: [
      (w) => `This situation can be described as quite ${w}.`,
      (w) => `Some people find this topic very ${w} to think about.`,
      (w) => `The result of this story was ${w} for everyone involved.`,
    ],
    generic: [
      (w) => `Another important idea here is ${w}.`,
      (w) => `This part of the passage is closely connected to ${w}.`,
      (w) => `We can also think about ${w} when we discuss this topic.`,
      (w) => `In everyday life, ${w} is something people notice often.`,
      (w) => `A good example of this idea is ${w}.`,
    ],
  };

  function guessPartOfSpeech(word) {
    // Lightweight suffix heuristic — the vocabulary log does not store
    // a part of speech, so this only picks a plausible template family;
    // it is not a grammar engine and defaults safely to "generic".
    const w = word.toLowerCase();
    if (/(ing|ize|ise|fy)$/.test(w)) return "verb";
    if (/(ful|ous|ive|able|ible|less)$/.test(w)) return "adjective";
    return "generic";
  }

  function generateReadingPassage(words) {
    const list = words.slice(0, 12); // keep the passage a reasonable length
    const title =
      list.length === 1
        ? `A Short Passage About "${list[0].word}"`
        : "New Words in Everyday Life";

    const intro =
      "Today we will read a short passage that uses some new English words. " +
      "Try to notice how each word is used in a real sentence.";

    const bodySentences = list.map((entry, i) => {
      const pos = guessPartOfSpeech(entry.word);
      const bank = READING_TEMPLATES[pos] && READING_TEMPLATES[pos].length
        ? READING_TEMPLATES[pos]
        : READING_TEMPLATES.generic;
      return bank[i % bank.length](entry.word);
    });

    const closing =
      list.length > 1
        ? `As you can see, all these words — ${list.map((w) => w.word).join(", ")} — can appear naturally in everyday English.`
        : `As you can see, the word "${list[0].word}" can appear naturally in everyday English.`;

    const text = [intro, ...bodySentences, closing].join(" ");

    window.__kwCurrentPassage = {
      title,
      text,
      words: list.map((w) => w.word),
      sentences: bodySentences,
      translation: null,
    };
    renderReadingPassage();
  }

  function renderReadingPassage() {
    const passage = window.__kwCurrentPassage;
    document.getElementById("readingEmpty").hidden = !!passage;
    document.getElementById("readingQuizQuestion").hidden = true;
    document.getElementById("readingQuizComplete").hidden = true;

    const card = document.getElementById("readingPassageCard");
    card.hidden = !passage;
    if (!passage) return;

    document.getElementById("readingTitle").textContent = passage.title;
    document.getElementById("readingText").textContent = passage.text;
    document.getElementById("readingTranslation").textContent = "...جارٍ الترجمة";

    // Reuses the EXISTING translation pipeline (MyMemory -> Lingva) from
    // js/api.js, completely unchanged — this never bypasses or
    // duplicates it.
    KWApi._fetchTranslation(passage.text, "الترجمة العربية غير متاحة لهذه القطعة.")
      .then((translation) => {
        passage.translation = translation;
        document.getElementById("readingTranslation").textContent =
          translation || "الترجمة العربية غير متاحة لهذه القطعة.";
      })
      .catch(() => {
        document.getElementById("readingTranslation").textContent =
          "الترجمة العربية غير متاحة لهذه القطعة.";
      });
  }

  document.getElementById("readingListenBtn").addEventListener("click", () => {
    const p = window.__kwCurrentPassage;
    if (p) speakWord(p.text, "normal");
  });
  document.getElementById("readingSlowBtn").addEventListener("click", () => {
    const p = window.__kwCurrentPassage;
    if (p) speakWord(p.text, "slow");
  });

  document.getElementById("readingSaveBtn").addEventListener("click", () => {
    const p = window.__kwCurrentPassage;
    if (!p) return;
    KWStorage.saveParagraph({
      title: p.title,
      text: p.text,
      translation: p.translation,
      words: p.words,
    });
    showToast("تم حفظ القطعة في قطع القراءة المحفوظة.");
  });

  /* ---------------- Reading comprehension quiz ---------------- */
  document.querySelectorAll(".qcount-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".qcount-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
  });

  function buildComprehensionQuestions(passage, requestedCount) {
    const questions = [];

    passage.sentences.forEach((sentence, i) => {
      const correctWord = passage.words[i];
      const re = new RegExp(correctWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const blanked = sentence.replace(re, "ـــــــ");
      const distractors = KWQuiz._shuffle(passage.words.filter((w) => w !== correctWord)).slice(0, 3);
      const options = KWQuiz._shuffle([correctWord, ...distractors]);

      if (options.length >= 2) {
        questions.push({
          prompt: `Which word completes this sentence: "${blanked}"`,
          options,
          correct: correctWord,
        });
      }
    });

    // One general "main idea" question so the quiz also checks overall
    // understanding, not just word-spotting.
    const distractorTitles = ["A Trip to the Moon", "How to Cook Rice", "The History of Football"];
    questions.push({
      prompt: "What is this passage mainly about?",
      options: KWQuiz._shuffle([passage.title, ...distractorTitles]),
      correct: passage.title,
    });

    return KWQuiz._shuffle(questions).slice(0, Math.min(requestedCount, questions.length));
  }

  let activeReadingQuiz = null;

  document.getElementById("readingStartQuizBtn").addEventListener("click", () => {
    const passage = window.__kwCurrentPassage;
    if (!passage) return;

    const activeCountBtn = document.querySelector(".qcount-btn.is-active");
    const requested = activeCountBtn ? parseInt(activeCountBtn.dataset.count, 10) : 5;
    const questions = buildComprehensionQuestions(passage, requested);

    if (!questions.length) {
      showToast("تحتاج كلمة واحدة على الأقل في القطعة لإنشاء اختبار.");
      return;
    }
    if (questions.length < requested) {
      showToast(`تم إنشاء ${questions.length} سؤالًا فقط بناءً على عدد الكلمات المتاحة في القطعة.`);
    }

    activeReadingQuiz = { questions, index: 0, correct: 0, wrong: 0, wrongList: [] };
    document.getElementById("readingPassageCard").hidden = true;
    document.getElementById("readingQuizComplete").hidden = true;
    document.getElementById("readingQuizQuestion").hidden = false;
    showReadingQuestion();
  });

  function showReadingQuestion() {
    const rq = activeReadingQuiz;
    const q = rq.questions[rq.index];
    if (!q) {
      finishReadingQuiz();
      return;
    }

    document.getElementById("readingQuizProgress").textContent = `Question ${rq.index + 1} / ${rq.questions.length}`;
    document.getElementById("readingQuizQuestionText").textContent = q.prompt;
    document.getElementById("readingQuizFeedback").hidden = true;
    document.getElementById("readingQuizNextBtn").hidden = true;

    const optionsEl = document.getElementById("readingQuizOptions");
    optionsEl.innerHTML = "";
    q.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--ghost reading-quiz__option";
      btn.textContent = opt;
      btn.addEventListener("click", () => selectReadingAnswer(opt, btn));
      optionsEl.appendChild(btn);
    });
  }

  function selectReadingAnswer(answer, btnEl) {
    const rq = activeReadingQuiz;
    const q = rq.questions[rq.index];
    const isCorrect = answer === q.correct;

    document.querySelectorAll(".reading-quiz__option").forEach((b) => (b.disabled = true));
    btnEl.classList.add(isCorrect ? "is-correct-option" : "is-wrong-option");

    if (isCorrect) {
      rq.correct += 1;
    } else {
      rq.wrong += 1;
      rq.wrongList.push({ prompt: q.prompt, correct: q.correct, given: answer });
    }

    const feedback = document.getElementById("readingQuizFeedback");
    feedback.hidden = false;
    feedback.className = isCorrect ? "quiz-feedback is-correct" : "quiz-feedback is-wrong";
    feedback.innerHTML = isCorrect
      ? "🟢 Correct!"
      : `🔴 Correct answer: <strong>${escapeHtml(q.correct)}</strong>`;

    document.getElementById("readingQuizNextBtn").hidden = false;
  }

  document.getElementById("readingQuizNextBtn").addEventListener("click", () => {
    activeReadingQuiz.index += 1;
    showReadingQuestion();
  });

  function finishReadingQuiz() {
    const rq = activeReadingQuiz;
    document.getElementById("readingQuizQuestion").hidden = true;
    document.getElementById("readingQuizComplete").hidden = false;

    const total = rq.questions.length;
    const pct = total ? Math.round((rq.correct / total) * 100) : 0;
    document.getElementById("readingQuizScoreText").textContent = `${rq.correct} / ${total}`;
    document.getElementById("readingQuizPercentText").textContent = `${pct}%`;

    const reviewSection = document.getElementById("readingQuizReviewSection");
    const list = document.getElementById("readingQuizReviewList");
    list.innerHTML = "";
    if (rq.wrongList.length) {
      reviewSection.hidden = false;
      rq.wrongList.forEach((w) => {
        const li = document.createElement("li");
        li.textContent = `${w.prompt} — Correct: ${w.correct} (Your answer: ${w.given})`;
        list.appendChild(li);
      });
    } else {
      reviewSection.hidden = true;
    }
  }

  document.getElementById("readingBackBtn").addEventListener("click", () => {
    document.getElementById("readingQuizComplete").hidden = true;
    document.getElementById("readingPassageCard").hidden = false;
  });

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", renderWeakWords);
})();
