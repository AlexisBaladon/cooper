/* Shared, dependency-free workflow rules for the page and explanation players. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CooperWorkflow = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  class AnalysisQueue {
    constructor() { this.revision = 0; this.active = false; this.queued = false; }
    invalidate() { this.revision++; if (this.active) this.queued = true; }
    begin() {
      if (this.active) { this.queued = true; return null; }
      this.active = true; this.queued = false;
      return { revision: this.revision };
    }
    isCurrent(run) { return run.revision === this.revision; }
    finish() { this.active = false; const again = this.queued; this.queued = false; return again; }
  }
  function validate(input) {
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lon) || Math.abs(input.lat) > 90 || Math.abs(input.lon) > 180)
      throw new Error("Enter a latitude from −90 to 90 and a longitude from −180 to 180.");
    if (!Object.values(input.prioridades).some((n) => n > 0))
      throw new Error("Choose at least one priority above zero so the comparison reflects what matters to you.");
  }
  async function readResponse(response) {
    let data;
    try { data = await response.json(); } catch {
      throw new Error(`The server could not complete this request (HTTP ${response.status}). Please try again.`);
    }
    if (!response.ok) {
      if (response.status === 429 || response.status === 503)
        throw new Error("The service is busy. Please wait a few seconds and try again.");
      if (response.status === 502 || response.status === 504)
        throw new Error("The data service is taking too long or is unavailable. Please try again shortly.");
      const detail = typeof data.detail === "string" ? data.detail : "Check the field settings and try again.";
      throw new Error(detail);
    }
    return data;
  }
  function explanationData(win) {
    // Prefer this tab's exact result, including when browser storage is unavailable.
    try { if (win.parent !== win) return win.parent.CooperAnalysis || null; } catch (_) { /* separate origin */ }
    try { const raw = win.localStorage.getItem("cooper-analysis"); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }
  function sourceNote(data) {
    const scenario = data.escenario;
    const prefix = data.context?.field || "Saved analysis";
    return scenario?.activo
      ? `${prefix} · What-if simulation: rainfall ${scenario.lluvia_pct > 0 ? "+" : ""}${scenario.lluvia_pct}%, temperature +${scenario.temp_delta} °C. This is not a forecast.`
      : `${prefix} · Historical climate comparison, 1996–2025. This is not a weather forecast.`;
  }
  return { AnalysisQueue, validate, readResponse, explanationData, sourceNote };
});
