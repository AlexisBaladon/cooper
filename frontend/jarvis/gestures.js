// Control con las manos, con MediaPipe (detector de manos, corre entero en el navegador:
// el video de la cámara no sale de la máquina).
//
// Este módulo solo convierte la cámara en eventos; qué hace cada uno lo decide la página:
//   onCursor(x, y, pinching)      la mano principal, en píxeles de pantalla (null si no hay mano)
//   onPinchStart(x, y)            cerró pulgar e índice
//   onPinchMove(x, y, dx, dy)     se mueve con el pellizco cerrado
//   onPinchEnd(x, y, tap)         soltó; tap = fue corto y casi sin moverse (un "clic")
//   onZoom(factor)                dos manos con pellizco: se separan (>1) o se juntan (<1)
//   onStatus(text)                para el HUD
//
// La librería y el modelo (~8 MB) se bajan recién al encender las manos.

const VERSION = "1.2.3";
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Pellizco = distancia pulgar–índice relativa al tamaño de la mano. Dos umbrales (cerrar y
// abrir) para que no parpadee, y un margen de tiempo antes de dar el pellizco por soltado.
const PINCH_ON = 0.32, PINCH_OFF = 0.5, RELEASE_MS = 140;
const TAP_MS = 450, TAP_PX = 28;
// Zona de la imagen que se estira a toda la pantalla: no hace falta llevar la mano al borde.
const ZONE = { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.75 };
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* Filtro "One Euro": suaviza mucho cuando la mano está quieta y poco cuando se mueve rápido. */
function oneEuro(minCutoff = 1.4, beta = 0.02) {
  let x = null, dx = 0, last = 0;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return (value, now) => {
    if (x === null || now - last > 400) { x = value; dx = 0; last = now; return value; }
    const dt = Math.max(0.001, (now - last) / 1000);
    last = now;
    dx += alpha(1, dt) * ((value - x) / dt - dx);
    x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
    return x;
  };
}

export function createGestures({ preview, onCursor, onPinchStart, onPinchMove, onPinchEnd, onZoom, onStatus }) {
  const video = document.createElement("video");
  video.playsInline = true; video.muted = true;
  const ctx = preview.getContext("2d");
  let landmarker = null, stream = null, running = false, loading = false, frameId = 0;
  let frames = 0, fpsAt = 0, fps = 0;
  const hands = {};                                      // por etiqueta ("Left" / "Right"): estado de cada mano
  let primary = null, zoomDist = 0;

  function handState(label) {
    return hands[label] ||= { fx: oneEuro(), fy: oneEuro(), pinch: false, openSince: 0, x: 0, y: 0, seen: 0,
      downAt: 0, downX: 0, downY: 0, travel: 0 };
  }

  async function load() {
    onStatus("LOADING");
    const { FilesetResolver, HandLandmarker } = await import(`${LIB}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${LIB}/wasm`);
    const make = (delegate) => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numHands: 2,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
    });
    try { landmarker = await make("GPU"); } catch (e) { landmarker = await make("CPU"); }
  }

  function draw(result) {
    const w = preview.width, h = preview.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w, 0); ctx.scale(-1, 1);               // espejo: mover la mano a la derecha va a la derecha
    ctx.globalAlpha = 0.35;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(79,216,255,0.35)"; ctx.lineWidth = 1;
    ctx.strokeRect(ZONE.x0 * w, ZONE.y0 * h, (ZONE.x1 - ZONE.x0) * w, (ZONE.y1 - ZONE.y0) * h);
    (result.landmarks || []).forEach((lm, i) => {
      const label = labelOf(result, i), pinching = hands[label]?.pinch;
      ctx.strokeStyle = pinching ? "#3dffc2" : "#4fd8ff"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of BONES) { ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); }
      ctx.stroke();
      ctx.fillStyle = pinching ? "#3dffc2" : "#eaffff";
      for (const k of [4, 8]) { ctx.beginPath(); ctx.arc(lm[k].x * w, lm[k].y * h, pinching ? 5 : 3, 0, 6.3); ctx.fill(); }
    });
    ctx.restore();
  }

  const labelOf = (result, i) => {
    const h = (result.handednesses || result.handedness || [])[i];
    return (h && h[0] && h[0].categoryName) || `hand${i}`;
  };

  function process(result, now) {
    const seen = [];
    (result.landmarks || []).forEach((lm, i) => {
      const s = handState(labelOf(result, i));
      const size = dist(lm[0], lm[9]) || 1e-6, ratio = dist(lm[4], lm[8]) / size;
      // Posición: el nudillo del dedo medio, que casi no se mueve al pellizcar (las puntas sí).
      const nx = clamp01((1 - lm[9].x - ZONE.x0) / (ZONE.x1 - ZONE.x0)), ny = clamp01((lm[9].y - ZONE.y0) / (ZONE.y1 - ZONE.y0));
      s.px = s.x; s.py = s.y;
      s.x = s.fx(nx * innerWidth, now); s.y = s.fy(ny * innerHeight, now);
      if (now - s.seen > 400) { s.px = s.x; s.py = s.y; s.pinch = false; }
      s.seen = now;
      s.was = s.pinch;
      if (!s.pinch && ratio < PINCH_ON) { s.pinch = true; s.openSince = 0; }
      else if (s.pinch && ratio > PINCH_OFF) {
        s.openSince ||= now;
        if (now - s.openSince > RELEASE_MS) s.pinch = false;
      } else if (s.pinch) s.openSince = 0;
      seen.push(s);
    });
    // Manos que dejaron de verse: se da el pellizco por soltado.
    for (const s of Object.values(hands)) if (!seen.includes(s) && s.pinch && now - s.seen > 300) { s.was = true; s.pinch = false; seen.push(s); s.lost = true; }

    const live = seen.filter((s) => !s.lost);
    if (!live.includes(primary)) primary = live[0] || null;
    const pinching = live.filter((s) => s.pinch);

    if (pinching.length === 2) {                         // dos manos: acercar o alejar
      const d = Math.hypot(pinching[0].x - pinching[1].x, pinching[0].y - pinching[1].y);
      if (zoomDist > 40 && d > 40) onZoom(d / zoomDist);
      else if (primary && primary.dragging) { primary.dragging = false; onPinchEnd(primary.x, primary.y, false); }
      zoomDist = d;
    } else {
      zoomDist = 0;
      const s = primary;
      if (s) {
        if (s.pinch && !s.dragging) {
          s.dragging = true; s.downAt = now; s.downX = s.x; s.downY = s.y; s.travel = 0;
          onPinchStart(s.x, s.y);
        } else if (s.pinch && s.dragging) {
          s.travel = Math.max(s.travel, Math.hypot(s.x - s.downX, s.y - s.downY));
          onPinchMove(s.x, s.y, s.x - s.px, s.y - s.py);
        } else if (!s.pinch && s.dragging) {
          s.dragging = false;
          onPinchEnd(s.x, s.y, now - s.downAt < TAP_MS && s.travel < TAP_PX);
        }
      }
    }
    for (const s of seen) if (s.lost) { s.lost = false; if (s.dragging) { s.dragging = false; onPinchEnd(s.x, s.y, false); } }
    if (primary) onCursor(primary.x, primary.y, primary.pinch); else onCursor(null);

    frames++;
    if (now - fpsAt > 1000) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; }
    onStatus(live.length ? `ON · ${fps} FPS` : `NO HAND · ${fps} FPS`);
  }

  function loop() {
    if (!running) return;
    if (video.readyState >= 2) {
      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      process(result, now);
      draw(result);
    }
    frameId = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  }

  const api = {
    get on() { return running; },
    async start() {
      if (running || loading) return;
      loading = true;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera needs http://localhost or https");
        if (!landmarker) await load();
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
        video.srcObject = stream;
        await video.play();
        running = true; fpsAt = performance.now(); frames = 0;
        preview.hidden = false;
        loop();
      } catch (e) {
        onStatus(e.name === "NotAllowedError" ? "CAMERA BLOCKED" : "ERROR");
        console.warn("gestures:", e);
        api.stop(true);
      } finally {
        loading = false;
      }
    },
    stop(keepStatus = false) {
      running = false;
      if (video.cancelVideoFrameCallback && frameId) video.cancelVideoFrameCallback(frameId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null; video.srcObject = null;
      for (const k of Object.keys(hands)) delete hands[k];
      primary = null; zoomDist = 0;
      preview.hidden = true;
      onCursor(null);
      if (!keepStatus) onStatus("OFF");
    },
    toggle() { return running ? api.stop() : api.start(); },
    // Para pruebas sin cámara: recibe un resultado con la forma del de MediaPipe
    // ({ landmarks: [[21 puntos]], handednesses: [[{ categoryName }]] }) y lo procesa igual.
    feed(result, now = performance.now()) { process(result, now); },
  };
  return api;
}
