# Cooper functional and audience audit

Date: 14 November 2026. Audience: farmers and agricultural advisers in Uruguay; English remains the default, as requested.

## Purpose and scope

Help a farmer compare their current rotation with two alternatives, understand the water/soil/climate trade-offs, and take a useful comparison to an adviser. Reviewed frontend inputs, analysis lifecycle, scenarios, comparison output, maps/tables, explanations, printing, error handling, accessibility, mobile layout, backend validation, and the public deployment. This is a functional/code audit, not agronomic certification, a penetration test, or a guarantee of availability.

## Findings and changes

| Priority | Finding | Change |
| --- | --- | --- |
| High | Changed location, area, crop, livestock or priorities could leave old results and narration looking current. | Mark stale results, pause explanation/report actions, and attach the exact inputs and time to each comparison. |
| High | Scenario requests could overlap and older responses could replace newer settings. | Serialize analyses, queue the latest settings, discard superseded responses, and test that lifecycle. |
| High | Missing terrain/storage could replace a user's 3D explanation with the sample field. | Prefer the current tab's in-memory result; use charts for missing terrain; never substitute a demo in an explicitly requested analysis. |
| High | All-zero priorities generated arbitrary tied recommendations. | Validate in the browser and backend before downloads. |
| Medium | First clicks were possible before initialization completed; loading failures lacked a recovery action. | Disable Analyze until ready, check catalog responses, add a reload action and bounded request timeouts. |
| Medium | Sample fields and scenarios were easy to mistake for real field/future predictions. | Explicit sample and historical/what-if labels in results, reports and narration. |
| Medium | Too much technical output appeared before the decision; indicative income could be mistaken for profit. | Keep the comparison primary, clarify the relative income score, and provide a compact PDF button exporting the existing visual page. The introductory summary block was removed at the user's request. |
| Medium | Field selection relied on a pointer-operated map. | Add a labelled coordinate form; keep sample/coordinate analysis available if Leaflet fails. |
| Medium | Chart/3D dependencies could leave broken interfaces. | Show the climate table if Chart.js is unavailable; offer the same analysis as charts if 3D cannot load. |
| Medium | Missing rotation label, invalid table/tab semantics, tiny touch controls and modal focus issues. | Label the rotation, use a real calendar table, pressed-state layer controls, larger targets, skip link, status/error announcements and modal focus restoration. |
| Medium | Light heatmap colours used white text in dark mode; wide calendars/tables were difficult on phones. | Select readable text from cell luminance, improve muted text contrast, and contain horizontal scrolling inside tables/calendars. |
| Medium | Narration cache grew without a bound on the 512 MB server; numeric validation also ignored minus signs. | Bound the recent-result cache to 64 entries, protect concurrent access, cap completion tokens per request, and preserve signs when validating rewritten numbers. |
| Medium | Climate storage errors could become plain-text 500 responses. | Return a structured temporary-unavailable response and test it. |

The previously reported read-only terrain cache, missing narration route and iframe header issues remain covered by the existing deployment and regression checks. No scientific thresholds, crop calendars, soil factors or scoring weights were changed during this audit.

## Verification

- Backend regression suite: synthetic climate, terrain, recommendations and narration; new tests for zero priorities, structured storage failures and bounded narration caching.
- Frontend regression suite: stale response rejection/queueing, coordinates/priorities validation, HTTP failure messages, current-tab explanation data with blocked/corrupt storage, and explicit visual/spoken scenario labels. Narration regression tests also reject rewrites that turn negative values positive.
- Syntax checks include inline scripts in both explanation pages, not just app.js.
- Browser review includes desktop and a 390 × 844 phone viewport. The detailed checks below distinguish real analysis from deliberate degraded-data fixtures.

## Remaining product work

1. Validate crop parameters, scoring thresholds, seasonal calendars and erosion assumptions with Uruguayan agronomists and representative farms. Cite the source for each parameter; a generic soil K factor does not replace soil sampling.
2. Run usability sessions with actual farmers, including older phones and slow rural connections. The audit improves usability but is not a formal WCAG conformance assessment.
3. Add real field boundaries and measured soil properties before presenting precise field-zone advice. Display interpolation and vertical exaggeration as visual aids.
4. English / Español is now selectable with English as the default. Review Spanish agronomic terminology with local advisers and users.
5. Establish monitoring, supplier billing limits and external data-service failure alerts before wider promotion. Request limits and a small fixed VM do not guarantee protection from a network flood or cap all transfer/provider charges.
6. Historical comparisons and hypothetical perturbations are not forecasts; income scores need local yield, price, cost and operational data before being used as business estimates.

## Technical reference

The narration output limit uses Groq's documented `max_completion_tokens` parameter: [Groq API reference](https://console.groq.com/docs/api-reference). The public proxy retains the existing body, request and concurrency limits and server-only secret storage.

## Browser and release checks

| Case | Result |
| --- | --- |
| Real NASA POWER/SRTM analysis for the Young sample | Passed locally; complete climate, terrain and three-rotation output. |
| Change area after a completed result | Stale banner appeared; explanation, chart link and report were paused. |
| Change 50 ha to 200 ha while a request was in flight | Latest 200 ha result rendered; earlier response did not overwrite it. |
| Rainfall scenario −20% | Recalculated and labelled “What-if simulation · not a forecast”. |
| All five priorities set to zero | Clear client validation; backend regression independently rejects it before downloading. |
| Leaflet/Chart.js unavailable, terrain response absent (local fixture) | Coordinate/sample selection remained available, climate table opened, and the explanation showed the same field as charts. |
| Close explanation with Escape | Closed and returned focus to the explanation button. |
| 390 × 844 phone viewport | No document-wide horizontal overflow; three crop calendars scroll within their cards; results receive focus after analysis. |
| Form labels | No unlabelled select controls in the reviewed comparison page. |
| PDF export | The compact button prints the existing charts, maps, climate table and rotation calendars, with input context. It does not generate a separate text-only summary. The embedded automation browser did not expose a native print/PDF preview; the system print dialog still needs manual confirmation in a regular browser. |
| CI | Backend suite, six Node workflow regression tests, frontend/inline script syntax and release packaging passed. |

Public deployment verification is recorded in the pull request and its Actions run. No test fixture, environment file or private key is included in the release.

## Interface follow-up

At the user's request, removed the introductory summary block and the visible alternate charts-explanation links. Retained automatic charts fallback when a device or terrain data cannot support 3D. Added a visible English / Español selector, remembered per browser, with local interface translations and language-aware narration. English remains the default.

Language verification: English default, persisted Español selection, Spanish comparison headings/crop names/glossary, restoration to English, and preservation of numerical values passed local browser and regression checks. The visible alternate-view controls and introductory report block are absent. Spanish narration is requested explicitly and cached separately from English.
