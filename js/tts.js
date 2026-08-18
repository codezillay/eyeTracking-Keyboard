/* ==========================================================================
   tts.js — Text-to-speech wrapper around the Web Speech API (SpeechSynthesis)
   ========================================================================== */

const TTS = (() => {
  let voices = [];
  let selectedVoiceIndex = 0;
  let rate = 1;

  function loadVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    return voices;
  }

  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speak(text) {
    if (!text || !text.trim()) return;
    if (!('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis not supported in this browser.');
      return;
    }
    window.speechSynthesis.cancel(); // stop any current speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    if (voices.length && voices[selectedVoiceIndex]) {
      utterance.voice = voices[selectedVoiceIndex];
    }
    window.speechSynthesis.speak(utterance);
  }

  function setRate(r) { rate = r; }

  function getVoices() { return voices.length ? voices : loadVoices(); }

  function setVoiceIndex(i) {
    const list = getVoices();
    if (!list.length) return;
    selectedVoiceIndex = ((i % list.length) + list.length) % list.length;
  }

  function getSelectedVoiceIndex() { return selectedVoiceIndex; }

  function getSelectedVoiceName() {
    const list = getVoices();
    return list.length && list[selectedVoiceIndex] ? list[selectedVoiceIndex].name : 'Default';
  }

  return { speak, setRate, getVoices, setVoiceIndex, getSelectedVoiceIndex, getSelectedVoiceName };
})();
