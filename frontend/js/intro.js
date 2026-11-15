/* Cooper · opening animation. videoinicio3 plays full screen at its native 1080p resolution,
 * with its own motion. When it ends (or the farmer skips it) the frame dissolves into the
 * living background and the interface assembles itself. */
(function () {
  "use strict";
  const C = window.Cooper;

  function play() {
    const el = document.getElementById("intro");
    const enabled = C.storage.get("cooper-intro", true);
    if (!el || !enabled || C.reducedMotion()) { el?.remove(); return Promise.resolve(false); }
    const video = el.querySelector("video");
    return new Promise((resolve) => {
      let done = false;
      const finish = (skipped) => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        const g = C.motion.gsap;
        const end = () => { video.pause(); video.removeAttribute("src"); video.load(); el.remove(); resolve(true); };
        const fade = skipped === true ? 0.25 : 0.6; // a skip leaves at once
        if (!g) { el.style.transition = `opacity ${fade}s`; el.style.opacity = "0"; setTimeout(end, fade * 1000 + 20); return; }
        g.timeline({ onComplete: end })
          .to(el, { opacity: 0, duration: fade, ease: "power2.inOut" }, 0);
      };
      const guard = setTimeout(finish, 8000);
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      // One click or tap anywhere (or the button, Escape, Enter, Space) skips the opening.
      const skip = () => finish(true);
      el.addEventListener("pointerdown", skip);
      el.addEventListener("click", skip);
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "intro-skip"; btn.textContent = C.t("Skip intro");
      el.appendChild(btn);
      document.addEventListener("keydown", function k(e) { if (["Escape", "Enter", " "].includes(e.key)) { document.removeEventListener("keydown", k); finish(true); } });
      video.playsInline = true;
      // Exactly the original video: with its sound when the browser allows it, otherwise muted.
      // The opening starts at second 2 of videoinicio3 (also set by the #t=2 media fragment).
      const START = 2;
      const SPEED = 2; // the opening plays faster than the original video
      const start = () => {
        if (video.currentTime < START - 0.1) { try { video.currentTime = START; } catch (e) { /* not seekable yet */ } }
        video.playbackRate = SPEED;
        video.muted = false;
        const p = video.play();
        if (p?.catch) p.catch(() => { video.muted = true; video.playbackRate = SPEED; video.play().catch(() => setTimeout(finish, 300)); });
      };
      if (video.readyState >= 3) start(); else video.addEventListener("canplay", start, { once: true });
    });
  }

  C.intro = { play };
})();
