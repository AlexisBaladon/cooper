/* Cooper · opening animation. videoinicio2 plays full screen at its native 1080p resolution,
 * with its own motion. When it ends (or the farmer skips it) the frame dissolves into the
 * living background and the interface assembles itself. */
(function () {
  "use strict";
  const C = window.Cooper;

  function play() {
    const el = document.getElementById("intro");
    const enabled = C.storage.get("cooper-intro", true);
    if (!el || !enabled || C.reducedMotion()) { el?.remove(); return Promise.resolve(false); }
    const video = el.querySelector("video"), skip = el.querySelector(".intro-skip");
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
          .to(skip, { opacity: 0, duration: 0.2 }, 0)
          .to(video, { scale: 1.12, filter: "blur(14px) brightness(1.15)", duration: 1.1, ease: "power2.in" }, 0)
          .to(el, { opacity: 0, duration: 0.7, ease: "power2.out" }, 0.45);
      };
      const guard = setTimeout(finish, 9000);
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      skip.addEventListener("click", (e) => { e.stopPropagation(); finish(); });
      el.addEventListener("click", finish);
      document.addEventListener("keydown", function k(e) { if (["Escape", "Enter", " "].includes(e.key)) { document.removeEventListener("keydown", k); finish(); } });
      video.muted = true;
      video.playsInline = true;
      const start = () => {
        const p = video.play();
        if (p?.catch) p.catch(() => setTimeout(finish, 300));
        C.motion.gsap?.fromTo(video, { opacity: 0 }, { opacity: 1, duration: 0.5 });
        C.motion.gsap?.fromTo(skip, { opacity: 0 }, { opacity: 1, delay: 1.2, duration: 0.6 });
      };
      if (video.readyState >= 3) start(); else video.addEventListener("canplay", start, { once: true });
    });
  }

  C.intro = { play };
})();
