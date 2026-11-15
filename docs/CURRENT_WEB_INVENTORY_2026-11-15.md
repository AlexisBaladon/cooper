# Cooper current web inventory

Checked on 15 November 2026 in Montevideo time. This document records what exists now, so the team can make its own decisions. It contains no proposed priorities or feature recommendations.

Scope: one confirmed project repository, AlexisBaladon/nasa2026, with 13 remote branches. A branch is a separate version inside that repository. The public website still matches main. The newer dev and frontend work is available as source code on GitHub, rather than as verified public deployments. [1, 2, 6]

## Availability at a glance

| Feature | Public website today | Elsewhere in the repository |
| --- | --- | --- |
| Rotation recommendations and numerical results | Yes | frontend adds a recommendation-first dashboard |
| Climate charts and field zone maps | Yes | frontend reorganizes these into views |
| Narrated 3D explanation | Yes through Explain it simply | frontend adds a video-style player and relief views |
| Download a PDF to read offline | Yes through browser Save as PDF | frontend contains a generated PDF report |
| English and Spanish | Yes | Also present in the redesigned interface |
| Saved fields and analysis history | No dedicated history interface | frontend uses browser storage |
| Excel CSV and JSON exports | No visible export controls | frontend contains these export options |
| Questions typed into an assistant | No | dev has Ask Cooper; frontend has Jarvis |
| Voice questions | No | dev records voice notes and transcribes them |
| Full offline application | No implemented mode found | Browser-local history exists in frontend |
| WhatsApp assistant | No implementation found | No integration found in inspected versions |
| Final competition video | No identified final video | frontend contains an intro MP4 asset |

“Exists in code” does not mean tested end to end or ready to deploy. The branch descriptions below are based on the fetched remote source. Live observations come from the public app and one sample analysis. [1–7]


---

## What visitors can use today

Website: https://agrocooper.earth/. The latest successful main deployment is commit 5e2430c, from 14 November 2026 at 17:58 Montevideo time. Its deployment run succeeded. Live HTML includes the updated print stylesheet and does not load either branch assistant or the redesigned dashboard. [1, 2]

### Field inputs and calculated results

Visitors can mark a map or enter coordinates, choose one of three example fields, set approximate area, choose their current rotation, indicate livestock, select soil water storage, and weight five priorities from 0 to 5. The live catalog contains 9 rotations and 11 crops. The field boundary is approximated by a square, rather than a drawn farm polygon. [1, 2]

Results include monthly rainfall and atmospheric water demand, a numerical table, a risk calendar, climate trends, terrain zones, and the current rotation beside two alternatives. Each rotation has a total and five scores from 0 to 100, crop calendars, water and erosion indicators, strengths, weaknesses and explanations. Rainfall and temperature controls create hypothetical scenarios. The page currently puts climate and terrain sections before the rotation cards. [1, 2]

| Live example near Young | Total score |
| --- | --- |
| Continuous soybean current rotation | 44 / 100 |
| Barley sorghum then oat soybean alternative | 59 / 100 |
| Wheat then second crop soybean alternative | 58 / 100 |

Example settings: 100 ha, 120 mm soil water storage, no livestock, priorities 3 4 4 1 3, and unchanged historical climate. These are this sample’s results, not a general recommendation. The income score is a relative index, not profit or a price estimate. [1, 2]

### Explanation and PDF

Explain it simply opens an eight-part 3D presentation with terrain, crops and erosion, captions, slide navigation, browser voice and speed controls. The 3D scene opened and played during inspection with voice muted. Groq narration reported 7 of 8 slides ready; the remaining slide retained its template. This is an interactive explanation rather than a downloadable finished video. [1, 2]

Save as PDF prints the current results, charts, tables and map, with labeled field settings. The saved file can be read offline. New analyses, live maps and AI requests still need network access. This inspection confirmed the control and deployed print code, but did not create a new PDF or verify every printed page. [1, 2]


---

## What exists in the unmerged branches

### dev contains Ask Cooper with voice notes

Snapshot d0ef719 contains all main commits plus three additional commits. Pull request 11 is open and unmerged; its latest automated check succeeded. The app adds a floating Ask Cooper panel, suggested questions, typed questions about the current analysis, and microphone recordings capped at 60 seconds in the browser. [5, 6]

Its backend adds /api/chat and /api/transcribe. Groq generates answers and Whisper transcribes recordings. The code includes server errors for missing configuration and unavailable services, plus proxy rate limits. This is an in-app assistant, not WhatsApp. The live website does not load it. Microphone recording and real provider responses were not tested on this branch. [5]

### frontend contains the larger interface redesign

Snapshot 7f408dd is 17 commits ahead of main and lacks two main commits. It is a separate line of work from dev. No open pull request for this branch appeared in the repository listing. The source contains the following features; they were inspected in code, not exercised in a public deployment. [3, 4, 6]

- Home Analysis My field and Settings views, with desktop sidebar and mobile navigation, themes and motion controls.
- A best overall rotation plus best options for each priority, with numerical changes relative to the current rotation. Metrics include water deficit, water use, erosion, bare months, relative income and forage indices, and critical-stage heat exposure.
- A visible eight-chapter explanation card and a video-style player with seeking, chapters, captions, volume, fullscreen and minimized playback. The player embeds the existing 3D or 2D presentation.
- Several named fields, saved analyses, timestamps, history filters and field notes stored locally in the browser. Export all data is present; cloud accounts or cross-device synchronization were not found.
- Generated PDF reports with charts and tables, Excel workbooks, CSV tables and JSON data exports.
- Current weather and a seven-day forecast from Open-Meteo; SoilGrids modeled soil properties; satellite, NASA NDVI, ESA WorldCover, erosion and relief views. Weather and SoilGrids data are informational and do not feed the rotation calculations.
- A separate floating Jarvis text assistant using /api/assistant, with guided local answers and optional Groq responses. The voice-note routes from dev are not part of this assistant implementation.
An intro asset named videoinicio2.mp4 exists, but index.html points to videoinicio.mp4, which is absent from this snapshot. The intro handles media errors. The existence of this asset does not establish that a final competition video has been produced. [4]

Browser-local history can retain results, but no service worker, install manifest or complete offline mode was found. CDN libraries, online map layers and backend analysis remain dependencies. No WhatsApp integration was found across main, dev or frontend. [2–6]


---

## Repository versions and source links

GitHub’s default branch is still work/initial-setup, while deployment uses main. Opening the repository homepage can therefore show older scaffold content. The inventory below describes the remote branches present before this document’s own working branch was created. [2, 6]

| Branch | Snapshot | What it represents |
| --- | --- | --- |
| main | 5e2430c | Deployed Cooper app |
| dev | d0ef719 | Unmerged Ask Cooper chat and voice |
| frontend | 7f408dd | Unmerged interface redesign and expanded features |
| work/initial-setup | d242d95 | Older scaffold and GitHub default branch |
| work/aws-demo | cef7779 | Earlier AWS demo setup |
| work/main-deployment | a35abfe | Main deployment setup already merged |
| work/groq-domain | 66033ca | Groq routes and HTTPS already merged |
| work/fix-analysis-cache | d77b124 | Production cache fix already merged |
| work/fix-explanation-frame | fc37b49 | Explanation frame fix already merged |
| work/functional-audit | 602abe4 | Workflow and reliability improvements already merged |
| work/cooper-branding | 9362a70 | Logo and icons already merged |
| work/simplify-results | b57e664 | PDF button and language switch already merged |
| work/print-layout-preview | 310ad74 | Print layout improvements already merged |

Verification boundary: one live sample and the 3D scene were exercised; other branches were source-reviewed. No new branch feature was deployed or merged for this inventory. Private or unshared repositories and unpublished files are outside its scope. No final competition video was identified in the inspected file trees.

### Sources

[1] Live website and catalog: [Public app](https://agrocooper.earth/), [Catalog](https://agrocooper.earth/api/catalog)

[2] Deployed main source and successful release: [Main snapshot](https://github.com/AlexisBaladon/nasa2026/tree/5e2430c65a202152e166c621c600b15d8b65989c), [Deployment](https://github.com/AlexisBaladon/nasa2026/actions/runs/43640327399)

[3] Recommendation dashboard and player: [Home](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/js/home.js), [Player](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/js/player.js)

[4] Storage exports assistant maps and intro: [Core](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/js/core.js), [Exports](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/js/export.js), [Jarvis](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/js/jarvis.js), [Field](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/js/field.js), [HTML](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/frontend/index.html)

[5] Ask Cooper voice and chat: [Open PR 11](https://github.com/AlexisBaladon/nasa2026/pull/11), [Dev backend](https://github.com/AlexisBaladon/nasa2026/blob/d0ef719fee0c460aebbffe5743b5c517dbcb8daa/backend/app/assistant.py), [Dev UI](https://github.com/AlexisBaladon/nasa2026/blob/d0ef719fee0c460aebbffe5743b5c517dbcb8daa/frontend/assistant.js), [Checks](https://github.com/AlexisBaladon/nasa2026/actions/runs/43671326893)

[6] Branches history and repository metadata: [Branches](https://github.com/AlexisBaladon/nasa2026/branches), [Pull requests](https://github.com/AlexisBaladon/nasa2026/pulls), [Repository metadata](https://api.github.com/repos/AlexisBaladon/nasa2026)

[7] Weather and modeled soil: [Weather](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/backend/app/weather.py), [Soil](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/backend/app/soil.py), [Backend routes](https://github.com/AlexisBaladon/nasa2026/blob/7f408ddcf62545483e225677618733149d695dee/backend/app/main.py)
