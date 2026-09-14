/* =========================================================
   speech.js — Pronunciation via the Web Speech API
   ========================================================= */

const KW_SPEECH_RATE = {
  normal: 0.9,
  slow: 0.55,
};

const KWSpeech = {

  isSupported() {
    return "speechSynthesis" in window;
  },

  _pickEnglishVoice() {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang === "en-US") ||
      voices.find((v) => v.lang && v.lang.startsWith("en")) ||
      null
    );
  },

  /**
   * Speaks a word.
   * @param {string} word
   * @param {"normal"|"slow"} speed
   * @param {{onStart?: Function, onEnd?: Function}} callbacks
   */
  speak(word, speed = "normal", callbacks = {}) {
    if (!this.isSupported()) {
      if (callbacks.onError) {
        callbacks.onError("Your browser does not support voice pronunciation.");
      }
      return;
    }

    // Cancel anything currently playing so buttons never queue up.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = KW_SPEECH_RATE[speed] || KW_SPEECH_RATE.normal;

    const voice = this._pickEnglishVoice();
    if (voice) utterance.voice = voice;

    if (callbacks.onStart) utterance.onstart = callbacks.onStart;
    if (callbacks.onEnd) {
      utterance.onend = callbacks.onEnd;
      utterance.onerror = callbacks.onEnd;
    }

    window.speechSynthesis.speak(utterance);
  },

  stop() {
    if (this.isSupported()) window.speechSynthesis.cancel();
  },
};

// Some browsers load voice lists asynchronously; warm the cache early.
if (KWSpeech.isSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
