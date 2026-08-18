/* ==========================================================================
   calibration.js
   Handles the 9-point calibration sweep (feeding WebGazer's ridge-regression
   model many samples per point) followed by a 5-point accuracy validation
   pass that measures real pixel error against known target locations.
   ========================================================================== */

const Calibration = (() => {

  const overlay          = document.getElementById('calibration-overlay');
  const dotWrap          = document.getElementById('calib-dot-wrap');
  const dot               = document.getElementById('calib-dot');
  const progressText      = document.getElementById('calib-progress-text');
  const subtitle          = document.getElementById('calib-subtitle');
  const title              = document.getElementById('calib-title');
  const resultBox          = document.getElementById('calib-result');
  const resultTitle        = document.getElementById('calib-result-title');
  const accuracyFill       = document.getElementById('calib-accuracy-fill');
  const accuracyText       = document.getElementById('calib-accuracy-text');
  const accuracyAdvice     = document.getElementById('calib-accuracy-advice');

  const SAFE_MARGIN_X = 0.07;  // fraction of width kept clear at edges
  const SAFE_MARGIN_Y = 0.10;  // fraction of height kept clear at edges

  const SAMPLE_MS_PER_POINT = 900;   // how long we feed samples to WebGazer per calibration point
  const SAMPLE_INTERVAL_MS  = 60;    // how often we call recordScreenPosition during that window
  const SETTLE_MS            = 550;   // pause after the dot arrives, before sampling starts
  const VALIDATE_SAMPLE_MS   = 700;   // how long we read predictions per validation point
  const VALIDATE_INTERVAL_MS = 60;

  let cancelled = false;
  let onCompleteCb = null;
  let onCancelCb = null;

  function shuffledPoints() {
    const w = window.innerWidth, h = window.innerHeight;
    const xs = [w * SAFE_MARGIN_X, w * 0.5, w * (1 - SAFE_MARGIN_X)];
    const ys = [h * SAFE_MARGIN_Y, h * 0.5, h * (1 - SAFE_MARGIN_Y)];
    const pts = [];
    for (const y of ys) for (const x of xs) pts.push({ x, y });
    // Fisher-Yates shuffle so training order isn't purely systematic
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    return pts;
  }

  function validationPoints() {
    const w = window.innerWidth, h = window.innerHeight;
    return [
      { x: w * 0.5, y: h * 0.5 },
      { x: w * SAFE_MARGIN_X, y: h * SAFE_MARGIN_Y },
      { x: w * (1 - SAFE_MARGIN_X), y: h * SAFE_MARGIN_Y },
      { x: w * SAFE_MARGIN_X, y: h * (1 - SAFE_MARGIN_Y) },
      { x: w * (1 - SAFE_MARGIN_X), y: h * (1 - SAFE_MARGIN_Y) }
    ];
  }

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  function placeDot(pt) {
    dot.style.left = pt.x + 'px';
    dot.style.top = pt.y + 'px';
  }

  async function runTrainingPoint(pt, index, total) {
    dot.classList.remove('shrinking');
    placeDot(pt);
    progressText.textContent = `Point ${index + 1} of ${total}`;
    await sleep(SETTLE_MS);
    if (cancelled) return;

    dot.classList.add('shrinking');
    const cycles = Math.floor(SAMPLE_MS_PER_POINT / SAMPLE_INTERVAL_MS);
    for (let i = 0; i < cycles; i++) {
      if (cancelled) return;
      if (window.webgazer && webgazer.isReady && webgazer.isReady()) {
        try { webgazer.recordScreenPosition(pt.x, pt.y, 'click'); } catch (e) { /* ignore transient errors */ }
      }
      await sleep(SAMPLE_INTERVAL_MS);
    }
  }

  async function runValidationPoint(pt) {
    placeDot(pt);
    dot.classList.remove('shrinking');
    await sleep(SETTLE_MS);
    dot.classList.add('shrinking');
    if (cancelled) return null;

    const samples = [];
    const cycles = Math.floor(VALIDATE_SAMPLE_MS / VALIDATE_INTERVAL_MS);
    for (let i = 0; i < cycles; i++) {
      if (cancelled) return null;
      try {
        const pred = window.webgazer ? webgazer.getCurrentPrediction() : null;
        if (pred && isFinite(pred.x) && isFinite(pred.y)) samples.push(pred);
      } catch (e) { /* ignore */ }
      await sleep(VALIDATE_INTERVAL_MS);
    }
    if (!samples.length) return null;

    const avgX = samples.reduce((s, p) => s + p.x, 0) / samples.length;
    const avgY = samples.reduce((s, p) => s + p.y, 0) / samples.length;
    const dist = Math.hypot(avgX - pt.x, avgY - pt.y);
    return dist;
  }

  function scoreFromErrors(errors) {
    const valid = errors.filter(e => e !== null);
    if (!valid.length) return { percent: 0, avgError: Infinity };
    const avgError = valid.reduce((s, e) => s + e, 0) / valid.length;
    // Map average pixel error to a 0-100% score.
    // ~40px or better -> ~100%, ~300px or worse -> ~0%.
    const GOOD_PX = 40;
    const BAD_PX = 320;
    let percent = 100 * (1 - (avgError - GOOD_PX) / (BAD_PX - GOOD_PX));
    percent = Math.max(2, Math.min(100, percent));
    return { percent: Math.round(percent), avgError: Math.round(avgError) };
  }

  function showResult(score) {
    resultBox.classList.remove('hidden');
    dotWrap.style.visibility = 'hidden';
    progressText.textContent = '';

    accuracyFill.style.width = score.percent + '%';
    accuracyText.textContent = `Estimated accuracy: ${score.percent}%  (avg. error ≈ ${isFinite(score.avgError) ? score.avgError + 'px' : 'n/a'})`;

    let advice, resultTitleText;
    if (score.percent >= 75) {
      resultTitleText = 'Calibration Complete — Great Accuracy!';
      advice = 'You should be able to type comfortably. Keep your head steady and re-calibrate if you change position.';
    } else if (score.percent >= 45) {
      resultTitleText = 'Calibration Complete — Fair Accuracy';
      advice = 'Typing should work, but larger keys or a longer dwell time may help. Improve lighting and hold your device steady, then consider recalibrating.';
    } else {
      resultTitleText = 'Accuracy is Low';
      advice = 'Try improving lighting on your face, centering your eyes in the camera, keeping the device still, and calibrating again for best results.';
    }
    resultTitle.textContent = resultTitleText;
    accuracyAdvice.textContent = advice;
  }

  async function run({ onComplete, onCancel } = {}) {
    cancelled = false;
    onCompleteCb = onComplete || null;
    onCancelCb = onCancel || null;

    overlay.classList.remove('hidden');
    resultBox.classList.add('hidden');
    dotWrap.style.visibility = 'visible';
    title.textContent = 'Calibration';
    subtitle.textContent = 'Keep your head still and follow the dot with your eyes only.';

    // Pause WebGazer's own click/move listeners' influence isn't an issue; we drive data directly.
    const trainPts = shuffledPoints();
    for (let i = 0; i < trainPts.length; i++) {
      await runTrainingPoint(trainPts[i], i, trainPts.length);
      if (cancelled) { finishCancelled(); return; }
    }

    // Validation phase
    subtitle.textContent = 'Now checking accuracy — keep looking at the dot.';
    title.textContent = 'Validating...';
    const valPts = validationPoints();
    const errors = [];
    for (let i = 0; i < valPts.length; i++) {
      progressText.textContent = `Checking ${i + 1} of ${valPts.length}`;
      const err = await runValidationPoint(valPts[i]);
      if (cancelled) { finishCancelled(); return; }
      errors.push(err);
    }

    const score = scoreFromErrors(errors);
    showResult(score);
    if (onCompleteCb) onCompleteCb(score);
  }

  function finishCancelled() {
    overlay.classList.add('hidden');
    if (onCancelCb) onCancelCb();
  }

  function cancel() {
    cancelled = true;
    overlay.classList.add('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  return { run, cancel, hideOverlay };
})();
