/* Cooper · voice. Asks the server for the spoken audio of a sentence (ElevenLabs, /api/voice).
 * Used by "Explain it simply" and by full-screen Jarvis. When the server has no voice (no key,
 * no credit, no connection) get() answers null and the caller speaks with the browser's voice. */
(function () {
  "use strict";
  const LANGS = ["en", "es", "pt"];
  const MAX_CHARS = 1000, MAX_PARALLEL = 2, MAX_SAVED = 150, GIVE_UP_AFTER = 3;
  const base = new URL(".", document.currentScript.src); // works from /jarvis/ too
  const saved = new Map(); // "lang|text" → Promise<blob URL | null>
  const waiting = [];
  let running = 0, failures = 0, off = false;

  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();

  async function request(text, lang, speaker) {
    try {
      const r = await fetch(new URL("api/voice", base), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang, speaker }),
      });
      if (!r.ok) throw new Error(String(r.status));
      failures = 0;
      return URL.createObjectURL(await r.blob());
    } catch (_) {
      if (++failures >= GIVE_UP_AFTER) off = true; // stop asking: the browser's voice takes over
      return null;
    }
  }

  function next() {
    while (running < MAX_PARALLEL && waiting.length) {
      const job = waiting.shift();
      if (off) { job.done(null); continue; }
      running++;
      request(job.text, job.lang, job.speaker).then((url) => { running--; job.done(url); next(); });
    }
  }

  /* The audio of `text` as a blob URL, or null. Asking twice for the same text costs nothing.
     speaker: "narrator" (default) or "jarvis", which has its own voice for each language. */
  function get(text, lang, speaker = "narrator") {
    text = clean(text);
    lang = String(lang || "en").slice(0, 2).toLowerCase();
    if (off || !text || text.length > MAX_CHARS || !LANGS.includes(lang)) return Promise.resolve(null);
    const key = speaker + "|" + lang + "|" + text;
    if (saved.has(key)) return saved.get(key);
    const promise = new Promise((done) => { waiting.push({ text, lang, speaker, done }); next(); });
    saved.set(key, promise);
    promise.then((url) => { if (!url) saved.delete(key); });
    if (saved.size > MAX_SAVED) {
      const oldest = saved.keys().next().value;
      saved.get(oldest).then((url) => url && URL.revokeObjectURL(url));
      saved.delete(oldest);
    }
    return promise;
  }

  /* get(), but never waits longer than `ms`: a slow answer counts as no voice. */
  const within = (text, lang, ms, speaker) => Promise.race([get(text, lang, speaker), new Promise((r) => setTimeout(() => r(null), ms))]);

  window.CooperVoice = { get, within, available: () => !off };
})();
