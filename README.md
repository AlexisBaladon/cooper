# Cooper · NASA Space Apps 2026

Cooper is a decision-support web tool that helps Uruguayan farmers compare crop
rotations using NASA Earth observation data. It answers the
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/)
challenge.

Cooper helps farmers think; it doesn't decide for them. It shows data, reasons and risks
to review with a local agronomist. No AI makes the decisions: every result comes from
written rules and published formulas that anyone can check. AI is optional and limited to
language: it rewrites the narration of "Explain it simply" and powers "Ask Cooper", a chat
that answers short questions using only the analysis on screen.

For a full explanation of the system, see [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Status

The project was brought into this repository in five phases, and all of them are in.

| Phase | Content | Status |
|---|---|---|
| 1. Base and climate | Server, daily NASA POWER data, local climate and trends | ✅ |
| 2. Rotation engine | Crop table, water balance, scores, explanations and climate scenarios | ✅ |
| 3. Terrain and erosion | SRTM elevation, RUSLE erosion per rotation and a map of zones within the field | ✅ |
| 4. Diagnosis and "Explain it simply" | Strengths and weaknesses, recommendations and a narrated 3D summary | ✅ |
| 5. AI and documentation | Narration text written with Groq, and full documentation | ✅ |

The team's earlier scaffold (FastAPI API, Next.js web app and first documents) is in
[`legacy/`](legacy/).

## Live deployment

The public app is [https://52.71.101.193](https://52.71.101.193). Pushes and merges to
**`main`** run the backend tests, check the frontend and automatically deploy to the
existing AWS Lightsail server. See [GitHub Actions](https://github.com/AlexisBaladon/nasa2026/actions)
and the [deployment guide](docs/AUTODEPLOY.md). Other branches run checks through pull
requests. Server-side API keys and the NASA cache persist outside application releases.

## What it does

1. The farmer marks a point on a map of Uruguay, or picks one of three sample fields,
   sets its approximate size, and tells Cooper which rotation they use today, whether they have livestock, roughly how
   much water their soil holds and what matters most to them (saving water, soil health,
   income, forage, climate resilience).
2. The server downloads 30 years of daily NASA POWER data (1996–2025) for that point and
   NASA SRTM elevation for the field.
3. The page shows:
   - monthly rainfall against reference evapotranspiration, to see when crops go thirsty;
   - a risk calendar: hot days, frost-risk days, heavy-rain days and water deficit;
   - how the climate changed between 1996–2010 and 2011–2025;
   - **three rotations side by side**: the current one and the two alternatives that best
     fit the farmer's priorities, each with five scores, a month-by-month calendar and an
     explanation of why it's suggested, the supporting data, possible benefits, what we
     don't know yet, and risks to review with an agronomist;
   - **zones of the field** on satellite imagery: erosion for each rotation, relative
     wetness (where water collects or dries out first), low spots with more frost risk, and slope;
   - **strengths and weaknesses** of each rotation: every score rated good, fair or weak,
     the reason behind it, and up to two ideas to improve each weak point;
   - a scenario slider to recalculate everything with less rain or more heat.
4. **Explain it simply** opens a narrated summary over a 3D model of the field, built from templates chosen by the field's data:
   its real SRTM terrain, crops changing month by month, soil colored by erosion and soil
   washing downhill, followed by the climate, the diagnosis, a better option and what to
   check with an agronomist. There's also a version with simple 2D charts. The narration is
   built from templates filled with the analysis data and read aloud by the browser's
   English voice. Optionally, a Groq language model rewrites it in more natural English;
   every rewritten sentence must keep exactly the same numbers, or it's discarded.
5. **Ask Cooper**, a button in the corner, opens a chat about the current analysis. The farmer
   can type or record a voice note (transcribed by Groq Whisper) and gets a short answer that
   uses only the analysis data, in the language they asked in (English or Spanish).

## The interface

The app is organised in **Home** (the decision cards: overall analysis, the best option for
each score with "See more options", and the narrated explanation in a video-style player),
**Analysis** (new analysis with every chart and map, and the analysis history with PDF,
Excel, CSV and JSON exports), **My field** (several independent fields, imagery, NDVI,
erosion and crop maps, soil, climate and crops) and **Settings** (dark mode, language,
motion). Jarvis, a floating assistant, explains the open analysis. See
[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#the-application-indexhtml).

## Adapted to Uruguay

The interface is in English, but the agronomy is Uruguayan:

- **Farming year from May to April**, so a season's winter crop (wheat, barley, canola,
  oats) and summer crop (soybean, maize, sorghum) stay together.
- **Local crops and systems:** first-crop and second-crop soybean, winter forage crops
  (*verdeos*) such as annual ryegrass, mixed pastures (*praderas*) of tall fescue, white
  clover and birdsfoot trefoil, and the classic crop-pasture rotation.
- **Livestock filter:** pasture and forage rotations are only suggested to farmers who
  have livestock.
- **No-till is assumed** where it matters, as it's the norm in Uruguay.
- Points outside Uruguay get a warning that results may not apply.

## Running it

Requirements: Python 3.11 or newer.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Open <http://127.0.0.1:8000>. The same server provides the API and the web page.

If PowerShell refuses to activate the virtual environment ("running scripts is disabled"),
run this once and try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Tests (no internet needed): `cd backend && python -m pytest -q`

### Optional: AI features (Groq)

Copy `backend/.env.example` to `backend/.env`, paste a key from
<https://console.groq.com/keys> into `GROQ_API_KEY` and restart the server. That enables the
rewritten narration and the "Ask Cooper" chat with voice notes. Without a key, the narration
falls back to templates and the chat explains that it isn't set up.
`backend/.env` is ignored by git; never commit it. Groq receives the slides' text, the chat
questions, voice notes and a summary of the analysis, never coordinates.

### Optional: spoken voice (ElevenLabs)

"Explain it simply" and full-screen Jarvis speak with an ElevenLabs voice when
`ELEVENLABS_API_KEY` is set in `backend/.env` (a key with the *Text to Speech* permission is
enough). The server asks for one sentence at a time (`POST /api/voice`) and keeps every
sentence it has already generated in `data/cache/voice`, so replaying an explanation spends
no credit. Without the key, without credit or without a connection, the browser's own voice
is used instead. ElevenLabs receives only the sentences to be spoken.

Groq's free tier allows about 8,000 tokens per minute; each chat question uses roughly 2,500.
If several questions arrive at once, Cooper waits a few seconds and retries before showing a
"busy" message.

The first query for a new point takes about 15 to 20 seconds while it downloads the NASA
POWER series and the SRTM elevation into `data/cache/`, which is not committed. Later queries for the same point are
instant. The map and the page's libraries load from the internet.

## Offline use

Cooper installs a service worker (`frontend/sw.js`), so after one visit with a connection the
app opens without signal and shows what is on the device: fields, saved analyses and the latest
result of each field, with their charts, zone maps, glossary and exports. **Settings → Offline
use** shows what is saved and has a button that stores, for every field, the map tiles around it,
the latest weather and the soil data. Offline, the weather chip shows when it was saved.

A new analysis or a new climate scenario still needs the server (the comparison runs in Python);
a comparison already made with exactly the same settings is shown again from the device. The AI
narration and Jarvis fall back to their template and guided answers.

`frontend/sw-files.js` lists the files to store. Regenerate it after adding or renaming frontend
files with `python scripts/make_offline_manifest.py`; packaging a release does it automatically.
Service workers need `https` or `localhost`.

## Project layout

```
backend/app/power.py     NASA POWER client with an on-disk cache
backend/app/climate.py   evapotranspiration, heat, frost, heavy rain and trends
backend/app/engine.py    water balance, indicators, scores and explanations
backend/app/terrain.py   SRTM elevation, slope, water flow, RUSLE erosion and field zones
backend/app/narrator.py  narration rewriting with Groq, with number checks
backend/app/assistant.py "Ask Cooper" chat and voice-note transcription (Groq)
backend/app/voice.py     spoken voice with ElevenLabs, saved per sentence
backend/app/main.py      API (/api/catalog, /api/analyze, /api/narrate, /api/chat, /api/transcribe) and web server
backend/tests/           tests with synthetic data and a simulated Groq
backend/.env.example     template for the Groq key
data/crops.json          crop table (editable by an agronomist)
data/rotations.json      rotation library
data/recommendations.json ideas to improve each weak point (editable by an agronomist)
frontend/                web page in HTML and JavaScript (Leaflet and Chart.js)
frontend/assistant.js    the "Ask Cooper" chat button
frontend/slides*.{html,js,css}  "Explain it simply" (2D charts and Three.js 3D model)
scripts/make_slides_sample.py   rebuilds the sample analysis the slides use when there is none
docs/HOW-IT-WORKS.md     full explanation of the system
legacy/                  the team's earlier scaffold
```

## Data and assumptions

| Data | Source | Resolution |
|---|---|---|
| Max and min temperature, rainfall, root-zone soil moisture | [NASA POWER](https://power.larc.nasa.gov/) (MERRA-2 and GPM-IMERG), daily | ~50 km |
| Elevation | NASA SRTM 1 arc-second, via [OpenTopoData](https://www.opentopodata.org/) | 30 m |
| Crops and rotations | `data/crops.json`, `data/rotations.json` (general literature for Uruguay) | — |

- **Reference evapotranspiration (ET0):** Hargreaves-Samani (FAO-56), from daily maximum
  and minimum temperature and latitude.
- **Hot day:** maximum ≥ 32 °C. **Frost risk:** minimum air temperature ≤ 2 °C, because
  the ground and leaves get colder than the air 2 m up and the grid smooths extremes.
  **Heavy rain:** ≥ 40 mm in a day.
- **Water balance:** month by month over every real year in the record. Effective rainfall
  uses the USDA-SCS method, crop water use is ET0 × crop coefficient (Kc, FAO-56), bare
  soil uses Kc = 0.3, and the soil is a "bucket" of the capacity the farmer chooses.
  Multi-year rotations are run in every phase and averaged.
- **Dry year:** for rainfall, the 20th percentile of each month; for the crops' water
  deficit, the 80th percentile (the worst year in five).
- **Scores (0–100):** water saving, soil health, indicative income, forage and climate
  resilience. The total is a weighted average using the farmer's priorities. Thresholds
  are heuristic and documented in `engine.subscores()`.
- **Field:** approximated by a square of the chosen area around the point, sampled on a
  15 × 15 grid of SRTM elevation. Slope, water flow (D8), relative wetness (TWI) and low
  spots come from that grid.
- **Erosion (RUSLE, A = R × K × LS × C × P):** R from NASA POWER rainfall (Renard & Freimund,
  1994), spread over the months with erosive rain; K = 0.035 (a typical value, not measured);
  LS from SRTM (Moore & Burch, with a 250 m maximum slope length); C month by month from each
  rotation's calendar, **assuming no-till**; P = 1. Reference tolerance: 7 t/ha a year.
  Absolute values are indicative; they're most useful for comparing rotations.
- **If OpenTopoData doesn't respond**, Cooper keeps working and estimates erosion from the
  rain that falls on bare soil.
- **Diagnosis:** a score of 65 or more is "good", under 40 is "weak", the rest "fair".
  Topics the farmer rated 0 are skipped, and forage is skipped without livestock. The
  improvement ideas come from `data/recommendations.json`, a hand-written list, not from AI.
- **Income is relative:** it compares crops with each other; there are no prices, costs or
  yields yet.
- **Scale:** the climate describes the area, not the field. Neighboring fields get the
  same data.
- **The crop table and thresholds come from general literature** and need review by a local
  agronomist.

## Collaboration

One branch per task and pull requests into the team's working branch. Don't commit keys,
credentials, private farmer data or large satellite downloads.
