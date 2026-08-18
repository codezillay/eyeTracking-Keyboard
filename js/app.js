/* ==========================================================================
   app.js — GazeSpeak main application logic
   - Initializes WebGazer.js (TFFacemesh tracker + ridge regression + Kalman
     filter) for on-device webcam eye tracking.
   - Applies an additional exponential-moving-average smoothing layer on top
     of WebGazer's own Kalman-filtered output for extra stability.
   - Runs a dwell-time selection engine over any ".dwell-target/.key/
     .phrase-key/.prediction-chip" element.
   - Renders the on-screen keyboard, quick phrases, word predictions, and
     wires up all settings / calibration / TTS / pointer-fallback behavior.
   ========================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  const DEFAULT_SETTINGS = {
    dwellMs: 2000,
    smoothingAlpha: 0.25,
    keySize: 1,
    showGazeDot: true,
    soundFeedback: true,
    vibration: true,
    autoSpeakPhrases: true,
    highContrast: false,
    showCameraPreview: false,
    speechRate: 1,
    voiceIndex: 0
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem('gazespeak_settings');
      return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS);
    } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings() {
    localStorage.setItem('gazespeak_settings', JSON.stringify(state.settings));
  }

  const state = {
    trackingActive: false,
    calibrated: false,
    pointerMode: false,
    shiftOn: false,
    currentPage: 'letters',
    text: '',
    settings: loadSettings(),
    lastGazeTime: 0,
    smoothed: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    dwell: {
      target: null,
      startTime: 0,
      armed: true // becomes false right after a selection until gaze leaves the target
    },
    lastFrameTime: performance.now()
  };

  /* ---------------------------------------------------------------------
   * DOM refs
   * ------------------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const outputText = $('#output-text');
  const keyboardEl = $('#keyboard');
  const phrasesPageEl = $('#phrases-page');
  const predictionBar = $('#prediction-bar');
  const gazeDot = $('#gaze-dot');
  const dwellRing = $('#dwell-ring');
  const ringProgress = document.querySelector('.ring-progress');
  const RING_CIRC = 2 * Math.PI * 52;

  const trackingStatusEl = $('#tracking-status');
  const calibStatusEl = $('#calib-status');
  const trackingLostBanner = $('#tracking-lost-banner');

  const welcomeOverlay = $('#welcome-overlay');
  const settingsModal = $('#settings-modal');
  const helpModal = $('#help-modal');

  /* ---------------------------------------------------------------------
   * Audio feedback (simple beep via WebAudio, no external asset needed)
   * ------------------------------------------------------------------- */
  let audioCtx = null;
  function playBeep() {
    if (!state.settings.soundFeedback) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.16);
    } catch (e) { /* ignore audio errors */ }
  }
  function vibrate(ms) {
    if (state.settings.vibration && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  /* ---------------------------------------------------------------------
   * Keyboard rendering
   * ------------------------------------------------------------------- */
  function renderKeyboard(layoutName) {
    const layout = KEYBOARD_LAYOUTS[layoutName];
    keyboardEl.innerHTML = '';
    layout.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'key-row';
      row.forEach(keyDef => {
        const btn = document.createElement('button');
        btn.className = 'key dwell-target' + (keyDef.cls ? ' ' + keyDef.cls : '') + (keyDef.wide ? ' wide' : '');
        btn.dataset.action = keyDef.action || 'type-char';
        if (keyDef.value !== undefined) btn.dataset.value = keyDef.value;
        btn.innerHTML = `<span class="key-label">${displayLabel(keyDef)}</span><div class="key-fill"></div>`;
        rowEl.appendChild(btn);
      });
      keyboardEl.appendChild(rowEl);
    });
    applyShiftDisplay();
  }

  function displayLabel(keyDef) {
    if (keyDef.value !== undefined && keyDef.value.length === 1 && /[a-z]/i.test(keyDef.value)) {
      return state.shiftOn ? keyDef.value.toUpperCase() : keyDef.value.toLowerCase();
    }
    return keyDef.label;
  }

  function applyShiftDisplay() {
    $$('#keyboard .key[data-value]').forEach(btn => {
      const v = btn.dataset.value;
      if (v && v.length === 1 && /[a-z]/i.test(v)) {
        btn.querySelector('.key-label').textContent = state.shiftOn ? v.toUpperCase() : v.toLowerCase();
      }
    });
  }

  function renderPhrases() {
    phrasesPageEl.innerHTML = '';
    QUICK_PHRASES.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'phrase-key dwell-target';
      btn.dataset.action = 'select-phrase';
      btn.dataset.phrase = p.text;
      btn.innerHTML = `<i class="fa-solid ${p.icon}"></i><span>${p.text}</span>`;
      phrasesPageEl.appendChild(btn);
    });
  }

  function switchPage(page) {
    state.currentPage = page;
    $$('.tab-btn').forEach(t => t.classList.toggle('active', t.dataset.page === page));
    $$('.page').forEach(p => p.classList.remove('active'));
    if (page === 'letters') keyboardEl.classList.add('active');
    if (page === 'phrases') phrasesPageEl.classList.add('active');
  }

  /* ---------------------------------------------------------------------
   * Text output & word prediction
   * ------------------------------------------------------------------- */
  function updateOutput() {
    outputText.value = state.text;
    outputText.scrollTop = outputText.scrollHeight;
    updatePredictions();
  }

  function typeChar(ch) {
    if (state.shiftOn && /[a-z]/i.test(ch)) ch = ch.toUpperCase();
    state.text += ch;
    if (state.shiftOn && ch !== ' ') { state.shiftOn = false; applyShiftDisplay(); updateShiftKeyVisual(); }
    updateOutput();
  }

  function backspace() {
    state.text = state.text.slice(0, -1);
    updateOutput();
  }

  function clearWord() {
    state.text = state.text.replace(/\s*\S+\s*$/, '');
    updateOutput();
  }

  function clearAll() {
    state.text = '';
    updateOutput();
  }

  function toggleShift() {
    state.shiftOn = !state.shiftOn;
    applyShiftDisplay();
    updateShiftKeyVisual();
  }
  function updateShiftKeyVisual() {
    const shiftBtn = document.querySelector('#keyboard .key[data-action="shift"]');
    if (shiftBtn) shiftBtn.classList.toggle('action-key', state.shiftOn);
  }

  function currentWordFragment() {
    const m = state.text.match(/(\S+)$/);
    return m ? m[1].toLowerCase() : '';
  }

  function updatePredictions() {
    const frag = currentWordFragment();
    predictionBar.innerHTML = '';
    if (!frag) return;
    const matches = WORD_DICTIONARY.filter(w => w.toLowerCase().startsWith(frag)).slice(0, 5);
    matches.forEach(word => {
      const chip = document.createElement('button');
      chip.className = 'prediction-chip dwell-target';
      chip.dataset.action = 'insert-prediction';
      chip.dataset.word = word;
      chip.textContent = word;
      predictionBar.appendChild(chip);
    });
  }

  function insertPrediction(word) {
    state.text = state.text.replace(/\S+$/, word) + ' ';
    updateOutput();
  }

  /* ---------------------------------------------------------------------
   * Action dispatch (shared by dwell selection AND real click/touch, so
   * pointer/switch fallback mode works identically)
   * ------------------------------------------------------------------- */
  function handleAction(el) {
    const action = el.dataset.action;
    if (!action) return;

    flashSelected(el);
    playBeep();
    vibrate(35);

    switch (action) {
      case 'type-char': typeChar(el.dataset.value); break;
      case 'backspace': backspace(); break;
      case 'shift': toggleShift(); break;
      case 'symbols': renderKeyboard('symbols'); break;
      case 'letters': renderKeyboard('letters'); break;
      case 'enter': typeChar('\n'); break;
      case 'insert-prediction': insertPrediction(el.dataset.word); break;
      case 'select-phrase':
        state.text = el.dataset.phrase;
        updateOutput();
        if (state.settings.autoSpeakPhrases) TTS.speak(el.dataset.phrase);
        break;
      case 'speak': TTS.speak(state.text); break;
      case 'clear-word': clearWord(); break;
      case 'clear-text': clearAll(); break;
      case 'switch-page': switchPage(el.dataset.page); break;
      case 'start-tracking': startTracking(); break;
      case 'toggle-pointer-mode': togglePointerMode(); break;
      case 'open-calibration': openCalibration(); break;
      case 'skip-calibration': Calibration.cancel(); break;
      case 'finish-calibration': finishCalibration(); break;
      case 'open-settings': openSettings(); break;
      case 'close-settings': closeSettings(); break;
      case 'open-help': openHelp(); break;
      case 'close-help': closeHelp(); break;
      case 'voice-prev': cycleVoice(-1); break;
      case 'voice-next': cycleVoice(1); break;
      default: break;
    }
  }

  function flashSelected(el) {
    el.classList.add('just-selected');
    setTimeout(() => el.classList.remove('just-selected'), 350);
  }

  // Wire native click (covers mouse, touch, switch-access, keyboard-enter on buttons)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    // Settings chip/toggle buttons have their own dedicated handling below;
    // avoid double firing by letting those specific handlers manage state,
    // then still routing through handleAction for anything else.
    if (el.dataset.dwell || el.dataset.smoothing || el.dataset.keysize || el.dataset.rate || el.dataset.toggle) return;
    handleAction(el);
  });

  /* ---------------------------------------------------------------------
   * Settings panel wiring
   * ------------------------------------------------------------------- */
  function applySettingsToUI() {
    document.documentElement.style.setProperty('--key-size', state.settings.keySize);
    document.body.classList.toggle('high-contrast', state.settings.highContrast);
    document.body.classList.toggle('show-camera-preview', state.settings.showCameraPreview);
    gazeDot.classList.toggle('visible', state.settings.showGazeDot && state.trackingActive && !state.pointerMode);

    setActiveChip('#dwell-time-options', 'dwell', state.settings.dwellMs);
    setActiveChip('#smoothing-options', 'smoothing', state.settings.smoothingAlpha);
    setActiveChip('#keysize-options', 'keysize', state.settings.keySize);
    setActiveChip('#rate-options', 'rate', state.settings.speechRate);

    setToggleUI('#toggle-gaze-dot', state.settings.showGazeDot);
    setToggleUI('#toggle-sound', state.settings.soundFeedback);
    setToggleUI('#toggle-vibration', state.settings.vibration);
    setToggleUI('#toggle-autospeak', state.settings.autoSpeakPhrases);
    setToggleUI('#toggle-contrast', state.settings.highContrast);
    setToggleUI('#toggle-camera-preview', state.settings.showCameraPreview);

    TTS.setRate(state.settings.speechRate);
    TTS.setVoiceIndex(state.settings.voiceIndex);
    $('#voice-name-display').textContent = TTS.getSelectedVoiceName();
  }

  function setActiveChip(containerSel, dataAttr, value) {
    $$(`${containerSel} .chip-btn`).forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset[dataAttr]) === parseFloat(value));
    });
  }
  function setToggleUI(sel, isOn) {
    const el = $(sel);
    if (el) el.classList.toggle('active', !!isOn);
  }

  document.addEventListener('click', (e) => {
    const dwellBtn = e.target.closest('[data-dwell]');
    if (dwellBtn) { state.settings.dwellMs = parseInt(dwellBtn.dataset.dwell, 10); saveSettings(); applySettingsToUI(); handleAction(dwellBtn.closest('[data-action]') || dwellBtn); return; }

    const smoothBtn = e.target.closest('[data-smoothing]');
    if (smoothBtn) { state.settings.smoothingAlpha = parseFloat(smoothBtn.dataset.smoothing); saveSettings(); applySettingsToUI(); return; }

    const sizeBtn = e.target.closest('[data-keysize]');
    if (sizeBtn) { state.settings.keySize = parseFloat(sizeBtn.dataset.keysize); saveSettings(); applySettingsToUI(); return; }

    const rateBtn = e.target.closest('[data-rate]');
    if (rateBtn) { state.settings.speechRate = parseFloat(rateBtn.dataset.rate); saveSettings(); applySettingsToUI(); return; }

    const toggleBtn = e.target.closest('[data-toggle]');
    if (toggleBtn) {
      const key = toggleBtn.dataset.toggle;
      state.settings[key] = !state.settings[key];
      saveSettings();
      applySettingsToUI();
      return;
    }
  });

  function cycleVoice(dir) {
    const list = TTS.getVoices();
    if (!list.length) return;
    const next = (TTS.getSelectedVoiceIndex() + dir + list.length) % list.length;
    state.settings.voiceIndex = next;
    saveSettings();
    applySettingsToUI();
  }

  function openSettings() { settingsModal.classList.remove('hidden'); }
  function closeSettings() { settingsModal.classList.add('hidden'); }
  function openHelp() { helpModal.classList.remove('hidden'); }
  function closeHelp() { helpModal.classList.add('hidden'); }

  /* ---------------------------------------------------------------------
   * WebGazer integration
   * ------------------------------------------------------------------- */
  function setTrackingStatus(text, level) {
    trackingStatusEl.innerHTML = `<i class="fa-solid fa-circle"></i> ${text}`;
    trackingStatusEl.className = 'status-pill ' + (level === 'on' ? 'status-on' : level === 'warn' ? 'status-warn' : 'status-off');
  }
  function setCalibStatus(text, level) {
    calibStatusEl.innerHTML = `<i class="fa-solid fa-bullseye"></i> ${text}`;
    calibStatusEl.className = 'status-pill ' + (level === 'on' ? 'status-on' : level === 'warn' ? 'status-warn' : 'status-off');
  }

  let trackingLostTimer = null;

  async function startTracking() {
    if (typeof webgazer === 'undefined') {
      alert('Eye tracking library failed to load. Please check your internet connection and reload the page.');
      return;
    }
    welcomeOverlay.classList.add('hidden');
    setTrackingStatus('Starting camera…', 'warn');

    try {
      // Configure WebGazer for maximum accuracy:
      // - TFFacemesh: WebGazer's most precise face-landmark tracker (468-point mesh)
      // - ridge regression: WebGazer's most accurate/stable regression model
      // - Kalman filter: smooths frame-to-frame jitter from the regression output
      webgazer.setTracker('TFFacemesh');
      webgazer.setRegression('ridge');
      webgazer.applyKalmanFilter(true);
      webgazer.showVideo(false);
      webgazer.showFaceOverlay(false);
      webgazer.showFaceFeedbackBox(false);
      webgazer.showPredictionPoints(false);

      webgazer.setGazeListener((data, timestamp) => {
        state.lastGazeTime = performance.now();
        if (!data) return;
        onRawGaze(data.x, data.y);
      });

      await webgazer.begin();
      webgazer.resume();

      state.trackingActive = true;
      setTrackingStatus('Tracking Active', 'on');
      $('#calibrate-btn').disabled = false;
      $('#start-btn').innerHTML = '<i class="fa-solid fa-video-slash"></i><span>Stop</span>';
      $('#start-btn').dataset.action = 'stop-tracking';

      if (state.settings.showGazeDot) gazeDot.classList.add('visible');
      dwellRing.classList.add('visible');

      startTrackingWatchdog();
      requestAnimationFrame(gazeLoop);

      // Immediately invite the user to calibrate — accuracy depends on it.
      openCalibration();
    } catch (err) {
      console.error(err);
      setTrackingStatus('Camera Error', 'off');
      alert('Could not access the camera. Please allow camera permission and ensure no other app is using it, then try again.');
    }
  }

  // Allow the Start button to also stop tracking (toggle), wired via delegated listener above
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action="stop-tracking"]');
    if (el) stopTracking();
  });

  function stopTracking() {
    if (window.webgazer) {
      try { webgazer.pause(); } catch (e) {}
    }
    state.trackingActive = false;
    setTrackingStatus('Tracking Off', 'off');
    gazeDot.classList.remove('visible');
    dwellRing.classList.remove('visible');
    $('#start-btn').innerHTML = '<i class="fa-solid fa-power-off"></i><span>Start</span>';
    $('#start-btn').dataset.action = 'start-tracking';
    if (trackingLostTimer) clearTimeout(trackingLostTimer);
    trackingLostBanner.classList.add('hidden');
  }

  function startTrackingWatchdog() {
    setInterval(() => {
      if (!state.trackingActive || state.pointerMode) return;
      const silent = performance.now() - state.lastGazeTime;
      if (silent > 900) {
        trackingLostBanner.classList.remove('hidden');
        setTrackingStatus('Face Not Found', 'warn');
      } else {
        trackingLostBanner.classList.add('hidden');
        setTrackingStatus('Tracking Active', 'on');
      }
    }, 400);
  }

  // Raw gaze -> smoothing layer (EMA on top of WebGazer's internal Kalman filter)
  function onRawGaze(x, y) {
    const alpha = state.settings.smoothingAlpha;
    state.smoothed.x += alpha * (x - state.smoothed.x);
    state.smoothed.y += alpha * (y - state.smoothed.y);
  }

  /* ---------------------------------------------------------------------
   * Pointer / switch fallback mode (no camera needed)
   * ------------------------------------------------------------------- */
  function togglePointerMode() {
    state.pointerMode = !state.pointerMode;
    welcomeOverlay.classList.add('hidden');
    const btn = $('#pointer-mode-btn');
    btn.classList.toggle('action-key', state.pointerMode);
    if (state.pointerMode) {
      gazeDot.classList.remove('visible');
      dwellRing.classList.remove('visible');
      setTrackingStatus('Pointer Mode', 'warn');
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('touchmove', onPointerTouchMove, { passive: true });
    } else {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('touchmove', onPointerTouchMove);
      setTrackingStatus(state.trackingActive ? 'Tracking Active' : 'Tracking Off', state.trackingActive ? 'on' : 'off');
    }
  }
  function onPointerMove(e) { state.smoothed.x = e.clientX; state.smoothed.y = e.clientY; }
  function onPointerTouchMove(e) {
    if (e.touches && e.touches[0]) { state.smoothed.x = e.touches[0].clientX; state.smoothed.y = e.touches[0].clientY; }
  }

  /* ---------------------------------------------------------------------
   * Dwell selection engine
   * ------------------------------------------------------------------- */
  const DWELL_SELECTOR = '.dwell-target, .key, .phrase-key, .prediction-chip';

  function gazeLoop(now) {
    const dt = now - state.lastFrameTime;
    state.lastFrameTime = now;

    if (state.trackingActive || state.pointerMode) {
      updateGazeVisuals();
      updateDwell(dt);
    }
    requestAnimationFrame(gazeLoop);
  }

  function updateGazeVisuals() {
    const { x, y } = state.smoothed;
    if (state.settings.showGazeDot && !state.pointerMode) {
      gazeDot.style.left = x + 'px';
      gazeDot.style.top = y + 'px';
    }
  }

  function elementUnderGaze() {
    const { x, y } = state.smoothed;
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    // If an overlay is open, only allow dwell targets inside the topmost visible overlay
    const topOverlay = getTopVisibleOverlay();
    if (topOverlay && !topOverlay.contains(el)) return null;
    const target = el.closest(DWELL_SELECTOR);
    if (!target || target.disabled) return null;
    return target;
  }

  function getTopVisibleOverlay() {
    const overlays = ['#calibration-overlay', '#settings-modal', '#help-modal', '#welcome-overlay'];
    for (const sel of overlays) {
      const el = $(sel);
      if (el && !el.classList.contains('hidden')) return el;
    }
    return null;
  }

  function updateDwell(dt) {
    const target = elementUnderGaze();
    const d = state.dwell;

    if (target !== d.target) {
      // Left previous target — clear its visuals
      if (d.target) {
        d.target.classList.remove('gaze-hover', 'gaze-dwelling');
        const fillEl = d.target.querySelector('.key-fill');
        if (fillEl) fillEl.style.height = '0%';
      }
      d.target = target;
      d.startTime = performance.now();
      d.armed = true; // arriving on a new element always (re)arms
      positionRing(target);
    }

    if (!target) {
      dwellRing.classList.toggle('visible', false);
      return;
    }

    target.classList.add('gaze-hover');
    dwellRing.classList.toggle('visible', state.trackingActive || state.pointerMode);
    positionRing(target);

    if (!d.armed) return; // just selected here; wait for gaze to leave before re-arming

    const elapsed = performance.now() - d.startTime;
    const dwellMs = state.settings.dwellMs;
    const progress = Math.min(1, elapsed / dwellMs);

    // Update ring
    ringProgress.style.strokeDashoffset = String(RING_CIRC * (1 - progress));
    // Update in-key fill (useful for very large phrase keys)
    const fillEl = target.querySelector('.key-fill');
    if (fillEl) fillEl.style.height = (progress * 100) + '%';

    if (progress >= 0.65) target.classList.add('gaze-dwelling');

    if (progress >= 1) {
      d.armed = false;
      target.classList.remove('gaze-hover', 'gaze-dwelling');
      if (fillEl) fillEl.style.height = '0%';
      ringProgress.style.strokeDashoffset = String(RING_CIRC);
      handleAction(target);
    }
  }

  function positionRing(target) {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dwellRing.style.left = cx + 'px';
    dwellRing.style.top = cy + 'px';
    // Scale ring to roughly match key size (min dimension), clamp reasonable bounds
    const size = Math.max(60, Math.min(140, Math.min(rect.width, rect.height) + 20));
    dwellRing.setAttribute('width', size);
    dwellRing.setAttribute('height', size);
  }

  /* ---------------------------------------------------------------------
   * Calibration flow
   * ------------------------------------------------------------------- */
  function openCalibration() {
    if (!state.trackingActive) { alert('Please start eye tracking first.'); return; }
    settingsModal.classList.add('hidden');
    Calibration.run({
      onComplete: (score) => {
        state.calibrated = true;
        setCalibStatus(`Calibrated (${score.percent}%)`, score.percent >= 60 ? 'on' : 'warn');
      },
      onCancel: () => {}
    });
  }

  function finishCalibration() {
    Calibration.hideOverlay();
  }

  /* ---------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------- */
  function init() {
    renderKeyboard('letters');
    renderPhrases();
    switchPage('letters');
    applySettingsToUI();
    updateOutput();

    // Give the voice list a moment to populate (async in most browsers)
    setTimeout(applySettingsToUI, 400);
    setTimeout(applySettingsToUI, 1200);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
