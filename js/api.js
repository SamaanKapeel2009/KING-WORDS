/* =========================================================
   api.js — Dictionary & translation data source for KING WORDS
   =========================================================

   Frontend-only: both calls below go straight from the browser to
   the external services — no backend/server involved.

   1) Free Dictionary API  -> English definitions + phonetics + audio.
      https://api.dictionaryapi.dev (free, no signup, CORS-friendly)
   2) MyMemory Translation -> Arabic meaning + sentence translation.
      https://api.mymemory.translated.net (free, no signup, CORS-friendly)

   If either API ever requires a key, add it below in KW_API_CONFIG —
   the rest of the code keeps working unchanged.
   ========================================================= */

const KW_API_CONFIG = {
  dictionaryBaseUrl: "https://api.dictionaryapi.dev/api/v2/entries/en/",
  // Fallback used ONLY when dictionaryapi.dev itself fails to respond
  // (e.g. HTTP 5xx/522, timeout, network error) — never for a normal
  // "word not found" (404), which stays a real 404. Free, no signup,
  // CORS-friendly, keyless. Provides definitions only — no phonetic
  // symbol, no audio, no example sentence, so those fields fall back
  // to the same "not available" placeholders the UI already handles.
  datamuseBaseUrl: "https://api.datamuse.com/words",
  // Used ONLY to fill in a real example sentence when neither
  // dictionaryapi.dev nor the Datamuse fallback has one for a word.
  // This is Wikimedia's own official REST API for Wiktionary — free,
  // keyless, CORS-enabled for public GET requests, and returns real
  // sentences written by Wiktionary's human contributors (never
  // AI-generated).
  wiktionaryDefinitionBaseUrl: "https://en.wiktionary.org/api/rest_v1/page/definition/",
  translationBaseUrl: "https://api.mymemory.translated.net/get",
  // Optional: add your own key/email here if you upgrade to a paid
  // or rate-limit-extended plan for either service.
  translationApiKey: "", // e.g. an email address for MyMemory's higher free quota
};

class KWApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "KWApiError";
  }
}

const KWApi = {

  /**
   * Fetches full word data: definitions, phonetics, audio URL and
   * an Arabic translation of the primary meaning.
   * @param {string} word
   * @returns {Promise<object>}
   */
  async fetchWordData(word) {
    const cleanWord = KWApi._sanitize(word);
    if (!cleanWord) {
      throw new KWApiError("Please enter a word to search.");
    }

    // fetch() to an https:// API is blocked by every modern browser when
    // the page itself was opened as a local file (double-clicked, "file://"
    // in the address bar) — this is a browser security rule, not something
    // this app or the dictionary API can work around. Give a distinct,
    // actionable message instead of the generic connection error so this
    // very common setup mistake is obvious immediately.
    if (window.location.protocol === "file:") {
      throw new KWApiError(
        "This page was opened directly as a file, which browsers block from reaching external services. Please run it through Live Server (VS Code) or a hosted URL (e.g. GitHub Pages) instead."
      );
    }

    const dictionaryData = await KWApi._fetchDictionary(cleanWord);
    const primaryMeaning = KWApi._extractPrimaryDefinition(dictionaryData);
    const arabicMeaning = await KWApi._fetchTranslation(
      cleanWord,
      "Arabic translation is not available."
    );

    // Prefer the example already bundled with the Free Dictionary API
    // response (or the Datamuse fallback, which never has one). If none
    // was found, try one real, human-written example sentence from
    // Wiktionary. If Wiktionary also has nothing, generate one
    // deterministically from the word's own real definition — never
    // AI, just a fixed template filled with real fetched data — so the
    // "not available" message is essentially never shown.
    let exampleSentence = KWApi._extractExample(dictionaryData);
    if (!exampleSentence) {
      exampleSentence = await KWApi._tryWiktionaryExample(cleanWord);
    }
    if (!exampleSentence && primaryMeaning.definition) {
      exampleSentence = KWApi._generateFallbackExample(
        dictionaryData.word || cleanWord,
        primaryMeaning.definition
      );
    }
    const sentenceTranslation = exampleSentence
      ? await KWApi._fetchTranslation(
          exampleSentence,
          "Arabic translation is not available."
        )
      : null;

    return {
      word: dictionaryData.word || cleanWord,
      phonetic: KWApi._extractPhonetic(dictionaryData),
      audioUrl: KWApi._extractAudio(dictionaryData),
      partOfSpeech: primaryMeaning.partOfSpeech,
      definition: primaryMeaning.definition,
      arabicMeaning,
      // Example sentence support. Only null in the rare case a word has
      // no definition text at all to build a fallback from — the UI
      // shows a friendly fallback message in that one edge case.
      exampleSentence,
      sentenceTranslation: exampleSentence
        ? sentenceTranslation
        : "Example sentence is not available for this word.",
    };
  },

  /**
   * Deterministic last-resort example sentence, built only from the
   * word itself and its own real dictionary definition (already
   * fetched — never invented). Not AI, not random — the same word +
   * definition always produces the same sentence.
   */
  _generateFallbackExample(word, definition) {
    const clean = String(definition || "").trim().replace(/\.$/, "");
    if (!clean) return null;
    const lower = clean.charAt(0).toLowerCase() + clean.slice(1);
    return `In this context, "${word}" refers to ${lower}.`;
  },

  /** Basic input sanitization: trim, strip anything but letters/spaces/hyphens. */
  _sanitize(word) {
    return String(word || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z\s-]/g, "");
  },

  async _fetchDictionary(word) {
    let response;
    try {
      response = await fetch(KW_API_CONFIG.dictionaryBaseUrl + encodeURIComponent(word));
    } catch (networkError) {
      // fetch() itself only throws for network-level failures (offline,
      // DNS, CORS block, etc.) — dictionaryapi.dev is unreachable, not
      // just returning an error page. Try the fallback before giving up.
      console.error("KING WORDS: dictionary fetch failed —", networkError);
      return await KWApi._fetchDictionaryFallbackOrThrow(word);
    }

    // A real 404 means dictionaryapi.dev is up and simply has no entry
    // for this word — that's a spelling issue, not a service outage, so
    // it must NOT trigger the fallback (Datamuse would just be asked to
    // solve the same "not a word" case, which isn't what it's for).
    if (response.status === 404) {
      throw new KWApiError(
        "Unable to find this word. Please check the spelling and try again."
      );
    }

    // Any other non-OK status (500, 522, etc.) means the service itself
    // is having a problem — this IS an outage, so try the fallback.
    if (!response.ok) {
      console.error(
        `KING WORDS: dictionary API returned HTTP ${response.status} ${response.statusText}`
      );
      return await KWApi._fetchDictionaryFallbackOrThrow(word);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      // 200 OK but an unparseable body is still effectively an outage.
      console.error("KING WORDS: dictionary API returned invalid JSON —", parseError);
      return await KWApi._fetchDictionaryFallbackOrThrow(word);
    }

    if (!Array.isArray(data) || !data.length) {
      throw new KWApiError(
        "Unable to find this word. Please check the spelling and try again."
      );
    }
    return data[0];
  },

  /**
   * Called only when dictionaryapi.dev itself is failing (network error,
   * 5xx/522, or a broken response) — never for a normal 404. Tries the
   * Datamuse fallback; if that also fails or has nothing for this word,
   * throws the exact same friendly outage message the app already shows,
   * so behavior when both sources fail is unchanged from before.
   */
  async _fetchDictionaryFallbackOrThrow(word) {
    const fallbackEntry = await KWApi._tryDatamuseFallback(word);
    if (fallbackEntry) {
      console.warn(
        `KING WORDS: dictionaryapi.dev is unavailable — used Datamuse fallback for "${word}".`
      );
      return fallbackEntry;
    }
    throw new KWApiError(
      "Unable to connect to the dictionary service. Please try again."
    );
  },

  /** Datamuse part-of-speech codes -> the same full words dictionaryapi.dev uses. */
  _DATAMUSE_POS_MAP: {
    n: "noun",
    v: "verb",
    adj: "adjective",
    adv: "adverb",
    prep: "preposition",
    conj: "conjunction",
    pron: "pronoun",
    interj: "interjection",
    u: "",
  },

  /**
   * Attempts to fetch a definition from Datamuse and reshape it into the
   * exact same object shape `_extractPhonetic`, `_extractAudio`,
   * `_extractPrimaryDefinition` and `_extractExample` already expect from
   * dictionaryapi.dev (a `{ word, phonetic, phonetics, meanings }`
   * object) — so nothing downstream (including app.js) needs to change.
   *
   * Datamuse has no phonetic symbol, no audio, and no example sentences,
   * so those simply come back empty/null here, exactly like a
   * dictionaryapi.dev entry that happens to lack them — a case the UI
   * already displays gracefully ("—" / "not available").
   *
   * Never throws — returns null on any failure so the caller falls back
   * to the standard outage message instead of a different kind of crash.
   */
  async _tryDatamuseFallback(word) {
    try {
      const url = `${KW_API_CONFIG.datamuseBaseUrl}?sp=${encodeURIComponent(word)}&md=d&max=1`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const results = await response.json();
      if (!Array.isArray(results) || !results.length) return null;

      // Prefer an exact word match if present, otherwise the top result.
      const match =
        results.find((r) => r.word && r.word.toLowerCase() === word.toLowerCase()) ||
        results[0];
      if (!match || !Array.isArray(match.defs) || !match.defs.length) return null;

      // Each entry in `defs` looks like "n\tSome definition text.".
      const meanings = match.defs
        .map((raw) => {
          const tabIndex = raw.indexOf("\t");
          if (tabIndex === -1) return null;
          const code = raw.slice(0, tabIndex).trim();
          const definitionText = raw.slice(tabIndex + 1).trim();
          if (!definitionText) return null;
          return {
            partOfSpeech: KWApi._DATAMUSE_POS_MAP[code] ?? code,
            definitions: [{ definition: definitionText, example: null }],
          };
        })
        .filter(Boolean);

      if (!meanings.length) return null;

      return {
        word: match.word || word,
        phonetic: null,
        phonetics: [],
        meanings,
      };
    } catch (e) {
      console.error("KING WORDS: Datamuse fallback request failed —", e);
      return null;
    }
  },

  /**
   * Translates arbitrary English text (a word or a whole sentence) to
   * Arabic. Never throws — translation is always a nice-to-have layered
   * on top of the core dictionary lookup, so failures fall back to a
   * clear, human-readable message instead of breaking the word card.
   *
   * Tries MyMemory first, then falls back automatically to Lingva
   * Translate (a free, no-key, CORS-friendly Google Translate front-end)
   * if MyMemory doesn't return a usable result — e.g. its free daily
   * quota is exhausted. Both are plain frontend fetch() calls; no
   * backend involved.
   */
  async _fetchTranslation(text, fallbackMessage) {
    const viaMyMemory = await KWApi._tryMyMemory(text);
    if (viaMyMemory) return viaMyMemory;

    const viaLingva = await KWApi._tryLingva(text);
    if (viaLingva) return viaLingva;

    return fallbackMessage;
  },

  /** Attempts MyMemory. Returns the translated text on success, or null on any failure. */
  async _tryMyMemory(text) {
    try {
      const key = KW_API_CONFIG.translationApiKey
        ? `&de=${encodeURIComponent(KW_API_CONFIG.translationApiKey)}`
        : "";
      // MyMemory's free tier caps queries at 500 bytes — truncate long
      // example sentences so they don't get silently rejected.
      const safeText = text.length > 480 ? text.slice(0, 480) : text;
      const url = `${KW_API_CONFIG.translationBaseUrl}?q=${encodeURIComponent(safeText)}&langpair=en|ar${key}`;

      const response = await fetch(url);
      const httpStatus = response.status;

      let data = null;
      let parseError = null;
      try {
        data = await response.json();
      } catch (e) {
        parseError = e.message;
      }

      // IMPORTANT: MyMemory almost always responds with HTTP 200 even
      // when the actual translation failed (daily quota used up, bad
      // language pair, etc.) — the real outcome is in the BODY-level
      // "responseStatus" field, not the HTTP status. When it fails,
      // "translatedText" is often a non-empty English warning string
      // (e.g. "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE
      // TRANSLATIONS FOR TODAY..."), which older code accepted as if
      // it were a real Arabic translation.
      const bodyStatus = data ? Number(data.responseStatus) : null;
      const translated = data && data.responseData && data.responseData.translatedText;
      const looksLikeWarning =
        typeof translated === "string" && /mymemory warning|invalid|error/i.test(translated);

      // --- Temporary diagnostic: exactly what came back, every time ---
      console.log(
        `%cKING WORDS diagnostic — MyMemory ("${text.slice(0, 40)}${text.length > 40 ? "…" : ""}")`,
        "color:#22D3EE;font-weight:bold;"
      );
      console.log("  HTTP status:", httpStatus);
      console.log("  responseStatus (body):", data ? data.responseStatus : "(no JSON body)");
      console.log("  translatedText:", translated ?? "(none)");
      console.log(
        "  error / details:",
        parseError || (data && data.responseDetails) || (!response.ok ? response.statusText : "(none)")
      );
      // --- end diagnostic ---

      if (!response.ok || !data || bodyStatus !== 200 || !translated || !translated.trim() || looksLikeWarning) {
        return null; // caller will try the fallback provider
      }

      return translated.trim();
    } catch (e) {
      console.log("%cKING WORDS diagnostic — MyMemory request threw:", "color:#EF4444;font-weight:bold;", e);
      return null;
    }
  },

  /**
   * Fallback provider: Lingva Translate, a free, no-signup, CORS-enabled
   * front-end for Google Translate. Public instances are community-run
   * (may occasionally be slow or unavailable), so we try two of them in
   * sequence before giving up.
   */
  async _tryLingva(text) {
    const instances = ["https://translate.plausibility.cloud", "https://lingva.ml"];
    const safeText = text.length > 480 ? text.slice(0, 480) : text;

    for (const instance of instances) {
      try {
        const url = `${instance}/api/v1/en/ar/${encodeURIComponent(safeText)}`;
        const response = await fetch(url);
        const httpStatus = response.status;

        let data = null;
        try {
          data = await response.json();
        } catch (e) {
          // ignore — handled by the check below
        }

        const translated = data && data.translation;

        console.log(
          `%cKING WORDS diagnostic — Lingva fallback (${instance})`,
          "color:#3B82F6;font-weight:bold;"
        );
        console.log("  HTTP status:", httpStatus);
        console.log("  translation:", translated ?? "(none)");
        console.log("  error / details:", (data && data.error) || (!response.ok ? response.statusText : "(none)"));

        if (response.ok && translated && translated.trim()) {
          return translated.trim();
        }
      } catch (e) {
        console.log(
          `%cKING WORDS diagnostic — Lingva (${instance}) request threw:`,
          "color:#EF4444;font-weight:bold;",
          e
        );
      }
    }

    return null; // both instances failed — caller shows the fallback message
  },

  /**
   * Looks for one real example sentence for `word` on Wiktionary — used
   * only when neither dictionaryapi.dev nor the Datamuse fallback had
   * one. Real, human-written Wiktionary usage examples only; this never
   * generates or invents a sentence.
   *
   * Never throws — an example sentence is always a nice-to-have, so any
   * failure here (network, CORS, word not on Wiktionary, no examples in
   * any sense) simply returns null and the UI shows the existing
   * "Example sentence is not available" message, exactly as before this
   * source existed.
   */
  async _tryWiktionaryExample(word) {
    try {
      const url = `${KW_API_CONFIG.wiktionaryDefinitionBaseUrl}${encodeURIComponent(word)}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      // Only the "en" (English) block is relevant — this app only deals
      // with English vocabulary.
      const entries = data && Array.isArray(data.en) ? data.en : null;
      if (!entries) return null;

      for (const entry of entries) {
        for (const def of entry.definitions || []) {
          const examples = def.examples;
          if (Array.isArray(examples) && examples.length) {
            const cleaned = KWApi._stripHtml(examples[0]).trim();
            if (cleaned) return cleaned;
          }
        }
      }
      return null;
    } catch (e) {
      console.error("KING WORDS: Wiktionary example fetch failed —", e);
      return null;
    }
  },

  /** Strips any stray HTML tags Wiktionary's API sometimes leaves in example text. */
  _stripHtml(text) {
    return String(text || "").replace(/<[^>]*>/g, "");
  },

  /** Finds the first usable example sentence across all meanings/definitions. */
  _extractExample(entry) {
    const meanings = entry.meanings || [];
    for (const meaning of meanings) {
      for (const def of meaning.definitions || []) {
        if (def.example && def.example.trim()) return def.example.trim();
      }
    }
    return null;
  },

  _extractPhonetic(entry) {
    if (entry.phonetic) return entry.phonetic;
    const withText = (entry.phonetics || []).find((p) => p.text);
    return withText ? withText.text : "—";
  },

  _extractAudio(entry) {
    const withAudio = (entry.phonetics || []).find((p) => p.audio);
    return withAudio ? withAudio.audio : null;
  },

  _extractPrimaryDefinition(entry) {
    const meanings = entry.meanings || [];
    if (!meanings.length) {
      return { partOfSpeech: "", definition: "No definition available." };
    }
    const first = meanings[0];
    const def = (first.definitions || [])[0];
    return {
      partOfSpeech: first.partOfSpeech || "",
      definition: def ? def.definition : "No definition available.",
    };
  },
};
