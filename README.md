# GazeSpeak — Eye Tracking Communication Keyboard

A frontend-only, browser-based **eye-tracking communication keyboard** for patients with limited mobility (e.g. ALS, locked-in syndrome, severe paralysis). It uses the device's **front camera** to track gaze in real time and lets the user "type" by **dwelling** (holding their gaze) on an on-screen key for a configurable amount of time (default 2 seconds).

Everything runs **100% client-side in the browser** — no video frame or gaze data is ever uploaded anywhere.

---

## 🎯 Why WebGazer.js

Calibration accuracy is the backbone of this app, so the eye-tracking engine was chosen deliberately:

- **[WebGazer.js](https://webgazer.cs.brown.edu/)** (Brown University HCI Lab) is the most mature, actively-used, MIT-licensed, purely browser-based (no server, no native app) webcam eye-tracking library available, and is the de-facto research/production standard for webcam gaze tracking on the open web.
- The app configures WebGazer for its **highest-accuracy pipeline**:
  - `setTracker('TFFacemesh')` — TensorFlow.js **FaceMesh**, a 468-point facial landmark model, WebGazer's most precise face/eye tracker (vs. the lighter-weight clmtrackr/TFFacemesh alternatives).
  - `setRegression('ridge')` — Ridge regression, WebGazer's most stable/accurate gaze-estimation regression model.
  - `applyKalmanFilter(true)` — a Kalman filter smooths frame-to-frame jitter in the raw gaze estimate.
- On top of WebGazer's own Kalman filter, `js/app.js` applies a second **exponential-moving-average (EMA) smoothing layer** (`smoothingAlpha`, user-adjustable in Settings) to further stabilize the point used for dwell selection — critical since even small jitter can cause mis-selection on a dense keyboard.
- A rigorous **9-point calibration + 5-point held-out accuracy validation** (see below) actually measures real pixel error against known targets and gives the caregiver/user a numeric accuracy score and actionable advice, rather than just "hoping" calibration worked.

## 🧭 Calibration & Accuracy Validation Flow

1. **Training (9 points):** Nine calibration dots are shown, in randomized order, across a 3×3 grid with safe margins from screen edges. At each dot, ~900ms of gaze samples are fed into WebGazer's regression model via `webgazer.recordScreenPosition()`.
2. **Validation (5 points, held-out):** Five *different* points (center + 4 corners) are shown. WebGazer's live prediction is sampled and averaged at each, and compared against the known true position to compute **real pixel error** — this is not just re-using training points, so the resulting score reflects genuine generalization accuracy.
3. **Score & Guidance:** Average error is mapped to a 0–100% accuracy score with a colored bar and specific advice (e.g. "improve lighting", "keep device still", "recalibrate") when accuracy is low.
4. Users can **recalibrate at any time** from the top bar or Settings — recommended whenever the device position, lighting, or the user's seating position changes.

## ⌨️ How Typing Works (Dwell Selection)

- A gaze cursor (dot) and a **circular dwell-progress ring** are rendered at the smoothed gaze position every animation frame.
- When the gaze lands on a key (`document.elementFromPoint`), a timer starts; the ring fills clockwise over the configured dwell time (0.8s–3.0s, default 2.0s).
- When the ring completes, the key is "pressed" — audio beep + vibration feedback + brief flash animation — and the timer disarms until the user looks away and back (prevents unwanted repeat-firing).
- The same `handleAction()` dispatcher is used for dwell selection **and** for real mouse/touch clicks, so the on-screen keyboard is also fully usable via touch, mouse, or assistive switch devices — this is the built-in **Pointer/Switch fallback mode** for when a camera isn't available or reliable.

## ✅ Currently Implemented Features

- **WebGazer-based webcam eye tracking** (TFFacemesh + ridge regression + Kalman filter), started with explicit camera permission.
- **9-point calibration wizard** with randomized point order + **5-point accuracy validation** producing a numeric accuracy score and guidance.
- **Large, high-contrast, dwell-controlled on-screen keyboard**: full QWERTY letters, numbers, punctuation, a symbols/emoji page, Shift, Backspace, Space, Enter.
- **Quick Phrases page**: 24 one-look common-need phrases (e.g. "I need help now", "Please call the nurse", "I am in pain", "Yes"/"No") for fast, high-priority communication.
- **Top message/output panel**: large readable typed-text box, always visible while typing, plus Speak / Delete-last-word / Clear-all controls.
- **Text-to-speech**: speaks the typed message or a selected quick phrase aloud (Web Speech API), with adjustable voice and speech rate.
- **Simple on-device word prediction**: prefix-matched suggestion chips above the keyboard, selectable by dwell/click to auto-complete the current word.
- **Adjustable dwell time, gaze smoothing strength, key size, high-contrast mode, gaze-dot visibility, sound/vibration feedback, camera preview toggle** — all in a Settings panel, persisted in `localStorage`.
- **Pointer/Switch fallback mode**: full keyboard usable via mouse/touch/switch input with the identical dwell-progress visual, for setup/testing or when camera tracking isn't viable.
- **Live tracking-health banner**: warns if the face is lost from view, and a status pill shows tracking/calibration state at all times.
- **Fully responsive layout** for phone (portrait/landscape) and tablet, with camera preview never bundled into visible video by default (privacy-first; can be toggled on in Settings for caregiver setup).

## 🗺️ App Structure / Entry Points

This is a single-page app; there are no separate routes/URLs — all functionality lives on `index.html` and is toggled via overlays:

| UI Area | Trigger |
|---|---|
| Welcome / onboarding overlay | Shown on load |
| Main keyboard + output panel | Default view once welcome/calibration is dismissed |
| Calibration overlay | "Calibrate" button, or automatically after "Start Eye Tracking" |
| Settings modal | "Settings" button (gear icon) |
| Help modal | "Help" button (question mark icon) |
| Quick Phrases page | "Quick Phrases" tab above the keyboard |

No query parameters or backend endpoints are used — this is a purely static, client-side app (plus optional camera + microphone-free Web Speech Synthesis API usage).

## 📁 File Structure

```
index.html            Main page: output panel, keyboard, all overlays (welcome, calibration, settings, help)
css/style.css         All styling: keyboard, dwell rings, overlays, responsive breakpoints, high-contrast theme
js/keyboard-data.js   Keyboard layouts (letters/symbols), quick phrases list, word-prediction dictionary
js/tts.js             Text-to-speech wrapper (Web Speech API)
js/calibration.js     9-point calibration + 5-point accuracy validation logic
js/app.js             WebGazer init, gaze smoothing, dwell selection engine, keyboard rendering, settings, actions
```

## 🔒 Data & Storage

- **No server-side storage or database is used.** This app has no backend.
- **User settings** (dwell time, smoothing, key size, toggles, voice, speech rate) are persisted locally via `localStorage` under the key `gazespeak_settings` — never transmitted anywhere.
- **Camera video and gaze data** are processed entirely in-browser by WebGazer.js/TensorFlow.js and are never uploaded or stored.
- **Typed message text** lives only in page memory (JS variable) for the current session; it is cleared on reload.

## 🚧 Not Yet Implemented / Suggested Next Steps

- **Persist message history** (e.g. save recent sentences) using the RESTful Table API, if cross-session message logs become a requirement.
- **Per-user calibration profiles**: currently calibration state lives only for the current session; storing multiple named calibration profiles (e.g. per device position) could help repeat users.
- **Blink/wink-based "click" alternative** to pure dwell, as an optional selection method for users who find dwell fatiguing (WebGazer does not include blink detection out of the box; would require an additional facial-landmark computation on the FaceMesh points already available).
- **Adjustable calibration point count** (e.g. 5/9/16-point) for users who want faster or more thorough calibration.
- **Multi-language keyboard layouts** and localized quick phrases.
- **Eye-tracking accuracy heat-map overlay** for caregivers to visually diagnose problem areas of the screen.
- **Auto dwell-time adaptation**: lengthen dwell automatically after repeated accidental selections; shorten it as accuracy improves.

## 🌐 Deployment

This is a static site (HTML/CSS/JS only, loading WebGazer.js and Font Awesome from CDN). To publish it live, use the **Publish tab** in the project UI — it will handle deployment and provide the live site URL.

## 📱 Usage Tips for Best Accuracy

1. Mount the phone/tablet steadily (a stand/clamp works far better than handheld) at eye level, ~30–40cm from the face.
2. Ensure even, front-facing lighting on the face — avoid strong backlighting (e.g. a bright window behind the user).
3. Keep the head as still as possible during calibration and typing; recalibrate after any repositioning.
4. Start with the default 2.0s dwell time and "Balanced" smoothing, then tune in Settings based on comfort and accuracy.
5. If camera tracking isn't reliable for a particular user, switch to **Pointer/Switch fallback mode** so the same large-key, dwell-progress interface can still be operated via mouse, touch, or an external switch/head-mouse device.
