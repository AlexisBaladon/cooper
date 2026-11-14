/* Cooper · opening animation. The intro video has a white background, so it is drawn through
 * a WebGL shader that turns white into real transparency (works in every browser, both themes).
 * When it ends, the mark lands in the sidebar and the interface assembles itself. */
(function () {
  "use strict";
  const C = window.Cooper;

  function keyer(canvas, video, dark) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!gl) return null;
    const vs = "attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
    const fs = `precision mediump float;varying vec2 v;uniform sampler2D tex;uniform float dk;
      void main(){
        vec3 c=texture2D(tex,v).rgb;
        float d=1.-min(c.r,min(c.g,c.b));            // distance from white
        float a=smoothstep(.035,.16,d);
        vec3 col=a>0.001?clamp((c-(1.-a))/a,0.,1.):c; // remove the white fringe
        float lum=dot(col,vec3(.2126,.7152,.0722));
        col=mix(col,vec3(.9,.95,.91),dk*smoothstep(.36,.16,lum)); // dark text turns light on dark mode
        gl_FragColor=vec4(col*a,a);
      }`;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1f(gl.getUniformLocation(pr, "dk"), dark ? 1 : 0);
    return () => {
      const w = canvas.clientWidth * Math.min(2, devicePixelRatio || 1), h = canvas.clientHeight * Math.min(2, devicePixelRatio || 1);
      if (canvas.width !== Math.round(w)) { canvas.width = Math.round(w); canvas.height = Math.round(h); gl.viewport(0, 0, canvas.width, canvas.height); }
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); } catch (_) { return; }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }

  function play() {
    const el = document.getElementById("intro");
    const enabled = C.storage.get("cooper-intro", true);
    if (!el || !enabled || C.reducedMotion()) { el?.remove(); return Promise.resolve(false); }
    const canvas = el.querySelector("canvas"), video = el.querySelector("video"), skip = el.querySelector(".intro-skip");
    const dark = C.theme.effective() === "dark";
    const draw = keyer(canvas, video, dark);
    if (!draw) { el.remove(); return Promise.resolve(false); }
    return new Promise((resolve) => {
      let raf = 0, done = false;
      const loop = () => { raf = requestAnimationFrame(loop); if (video.readyState >= 2) draw(); };
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        const g = C.motion.gsap;
        const target = [...document.querySelectorAll(".sb-logo img, .mobile-logo img")].find((i) => i.offsetWidth > 0 && getComputedStyle(i).display !== "none");
        const tr = target?.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
        const end = () => { cancelAnimationFrame(raf); video.pause(); el.remove(); resolve(true); };
        if (!g || !tr || !tr.width) { el.style.transition = "opacity .4s"; el.style.opacity = "0"; setTimeout(end, 420); return; }
        // The logo sits in the middle ~45% of the video frame: aim that area at the sidebar logo.
        const logoW = cr.width * 0.42, scale = tr.width / logoW;
        const dx = tr.left + tr.width / 2 - (cr.left + cr.width / 2), dy = tr.top + tr.height / 2 - (cr.top + cr.height / 2);
        g.timeline({ onComplete: end })
          .to(skip, { opacity: 0, duration: 0.2 }, 0)
          .to(canvas, { x: dx, y: dy, scale, duration: 0.95, ease: "expo.inOut" }, 0)
          .to(el, { backgroundColor: "rgba(0,0,0,0)", duration: 0.7, ease: "power2.out" }, 0.25)
          .to(canvas, { opacity: 0, duration: 0.3 }, 0.8);
      };
      const guard = setTimeout(finish, 7000);
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      skip.addEventListener("click", finish);
      el.addEventListener("click", (e) => { if (e.target !== skip) finish(); });
      document.addEventListener("keydown", function k(e) { if (["Escape", "Enter", " "].includes(e.key)) { document.removeEventListener("keydown", k); finish(); } });
      video.muted = true;
      const p = video.play();
      if (p?.catch) p.catch(() => setTimeout(finish, 200));
      loop();
      C.motion.gsap?.fromTo(skip, { opacity: 0 }, { opacity: 1, delay: 1, duration: 0.6 });
    });
  }

  C.intro = { play };
})();
