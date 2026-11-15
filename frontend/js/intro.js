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
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        const g = C.motion.gsap;
        const end = () => { video.pause(); video.removeAttribute("src"); video.load(); el.remove(); resolve(true); };
        if (!g) { el.style.transition = "opacity .5s"; el.style.opacity = "0"; setTimeout(end, 520); return; }
        g.timeline({ onComplete: end })
          .to(el, { opacity: 0, duration: 0.8, ease: "power2.inOut" }, 0.05);
      };
      const guard = setTimeout(finish, 13000);
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      el.addEventListener("click", finish);
      document.addEventListener("keydown", function k(e) { if (["Escape", "Enter", " "].includes(e.key)) { document.removeEventListener("keydown", k); finish(); } });
      video.playsInline = true;
      // Exactly the original video: with its sound when the browser allows it, otherwise muted.
      // The opening starts at second 2 of videoinicio3 (also set by the #t=2 media fragment).
      const START = 2;
      const start = () => {
        if (video.currentTime < START - 0.1) { try { video.currentTime = START; } catch (e) { /* not seekable yet */ } }
        video.muted = false;
        const p = video.play();
        if (p?.catch) p.catch(() => { video.muted = true; video.play().catch(() => setTimeout(finish, 300)); });
      };
      if (video.readyState >= 3) start(); else video.addEventListener("canplay", start, { once: true });
    });
  }

  C.intro = { play };
})();
