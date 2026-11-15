# How Cooper works

Cooper is a web tool that helps a Uruguayan farmer compare crop rotations using 30 years
of NASA data. It answers the "Field Shift: Adapting Farms with NASA Data" challenge of
NASA Space Apps 2026.

This document explains what the system does, where its data comes from and how each
result is calculated. To install and run it, see the [README](../README.md).

## The idea in one paragraph

The farmer marks their field on a map and tells Cooper which rotation they use today and
what matters most to them. Cooper downloads the historical climate and the terrain for
that spot, simulates how every rotation in its library would perform, and shows three
side by side: the current one and the two alternatives that best fit the farmer's
priorities. For each one it explains why it's suggested, what data supports it, what
benefits it may bring, what information is missing and which risks an agronomist should
review.

**No AI makes the decisions.** Everything comes from agronomic rules, published formulas
and thresholds written in the code, which anyone can review. Cooper helps farmers think;
the decision belongs to the farmer and their agronomist.

AI is optional and limited to language. A Groq language model can rewrite the text the
voice reads in "Explain it simply", and it powers "Ask Cooper", a chat that answers short
questions about the analysis on screen. In both cases it doesn't calculate anything, doesn't
pick rotations and works only from numbers Cooper already computed (see below).

## Minimal vocabulary

| Term | Meaning |
|---|---|
| Rotation | The order in which crops are sown, year after year, in the same field. |
| Farming year | May to April: one winter crop (wheat, barley…) and one summer crop (soybean, maize…). |
| First crop / second crop | A first crop is sown on its normal date; a second crop is sown right after harvesting a winter crop, so the field gives two harvests a year. |
| Cover crop | A crop sown to protect the soil rather than to sell (black oat, vetch). |
| Evapotranspiration (ET0) | The water that the sun and heat "take away" from the field. |
| Water deficit | The water a crop needed and couldn't find. |
| Erosion | The fertile soil that rain washes away, in tonnes per hectare per year. |
| No-till | Sowing without plowing, on top of the previous crop's stubble. It's the norm in Uruguay. |

## The path of a query

```
Browser (map, priorities)
        │  POST /api/analyze
        ▼
1. Climate     power.py    → 30 years of daily NASA POWER data (cached)
2. Indicators  climate.py  → evapotranspiration, heat, frost, heavy rain, trends
3. Terrain     terrain.py  → SRTM elevation, slope, where water flows
4. Erosion     terrain.py  → RUSLE for every rotation in the library
5. Engine      engine.py   → water balance, indicators, 5 scores, weighted total
6. Selection   engine.py   → current rotation + the 2 best alternatives
7. Explanation engine.py   → why, data, benefits, gaps, risks, strengths and weaknesses
        │  JSON
        ▼
Browser: charts, zones map, 3 cards, scenario slider and "Explain it simply"
```

When the farmer moves the climate scenario sliders (less rain, more heat), the whole path
runs again with the modified daily data.

## Data sources

| Data | Source | Resolution | Used for |
|---|---|---|---|
| Max and min temperature, rainfall, root-zone soil moisture | NASA POWER (MERRA-2 and GPM-IMERG), daily 1996–2025 | ~50 km | Climate, water balance, frost, heat, rainfall strength |
| Elevation | NASA SRTM, via OpenTopoData | 30 m | Slope, water flow, erosion, low spots |
| Satellite background | Esri World Imagery | — | Visual only, on the zones map |
| Crops | `data/crops.json` (general literature) | — | Calendar, water use, contributions to the soil |
| Rotations | `data/rotations.json` | — | The 9 options being compared |
| Recommendations | `data/recommendations.json` | — | Ideas to improve each weak point |

The first two need no API key. Everything downloaded is stored in `data/cache/`, which is
not committed.

**Not used yet:** the real soil type (SoilGrids or MGAP's soil map) and vegetation
greenness (NDVI from MODIS or Landsat). Both are planned.

## Steps 1 and 2: the area's climate

From the daily data, Cooper calculates for each day:

- **Reference evapotranspiration (ET0)** with the Hargreaves-Samani formula (FAO-56),
  which only needs maximum and minimum temperature and latitude.
- **Hot day:** maximum temperature ≥ 32 °C.
- **Frost-risk day:** minimum temperature ≤ 2 °C. Cooper uses 2 °C instead of 0 °C because
  the ground and leaves get colder than the air 2 m up, and because a 50 km grid smooths
  extremes.
- **Heavy-rain day:** ≥ 40 mm.

The data is then grouped by month and by farming year. Only complete farming years are
used (29 in total). From there come:

- The **rainfall versus ET0 chart** by month. When ET0 is above rainfall, crops depend on
  the water stored in the soil.
- The **risk calendar**: hot days, frost-risk days and heavy-rain days per month.
- The **trends**: the 1996–2010 average compared with 2011–2025.

## Step 3: the field's terrain

The field is approximated by a square centered on the marked point, with the area the
farmer chooses. Cooper samples a 15 × 15 grid of SRTM elevation over that square and
calculates:

- **Slope** of each cell.
- **Where water flows** (D8 method: each cell drains to its lowest neighbor) and how much
  area drains into each point.
- **Relative wetness** (TWI): low spots and drainage lines collect water, hilltops dry out
  first. It's relative within the field, not a measurement.
- **Low spots:** cells lower than their surroundings, where cold air pools on frosty
  nights and water can pond.

## Step 4: erosion (RUSLE)

RUSLE is the standard formula for estimating soil loss. It's the same basis that MGAP's
Erosión 6.0 tool uses in Uruguay:

```
A = R × K × LS × C × P        (tonnes per hectare per year)
```

| Factor | What it represents | How Cooper gets it |
|---|---|---|
| R | Rainfall strength | From NASA POWER annual rainfall (Renard and Freimund, 1994), spread across months by erosive-rain days |
| K | How erodible the soil is | Fixed typical value of 0.035. **Not measured.** |
| LS | Slope and slope length | From SRTM (Moore and Burch, 1986), with a 250 m maximum slope length |
| C | How much the cover protects | Month by month from the rotation's calendar, assuming no-till |
| P | Conservation practices | 1 (no terraces or contour farming) |

The C factor is what makes each rotation's erosion different: a bare month after soybean
protects very little, while a crop with a closed canopy or a pasture protects a lot. Each
month is weighted by how much erosive rain falls in it.

The reference tolerance is **7 t/ha a year**. If OpenTopoData doesn't respond, Cooper keeps
working and estimates erosion with a simpler indicator: the rainfall that lands on bare
soil.

## Step 5: the rotation engine

### The crop table

`data/crops.json` describes 11 crops. For each one:

- The **months** it occupies and its monthly **Kc** (the share of ET0 it uses).
- Its **critical months** (for example, maize flowering in December and January) and
  whether it's sensitive to heat or frost then.
- Relative 0–5 scores: stubble left behind, nitrogen contribution, forage, income and
  drought tolerance. Also its plant family and whether it has deep roots.
- Text for **risks** and **information gaps**, in English.

`data/rotations.json` defines 9 rotations lasting 1 to 5 years. Three of them need
livestock and are only suggested if the farmer says they have it.

Both tables are JSON so an agronomist can correct them without touching code.

### The water balance

For each rotation, soil water is simulated month by month **over the 29 real years** in
the record, not over an average year. The soil works like a bucket:

```
new water = stored water + effective rainfall − crop water use
```

- **Effective rainfall:** the share of rainfall that stays available (USDA-SCS method).
- **Water use:** ET0 × the crop's Kc. Bare soil uses Kc = 0.3.
- **Bucket size:** chosen by the farmer (80, 120 or 170 mm).
- When the bucket runs dry, the shortfall is the **deficit**.

Multi-year rotations are run in every phase (which crop falls in which year) and
averaged. A "dry year" is the 80th percentile of the deficit: the worst year in five.

### The indicators

| Indicator | What it measures |
|---|---|
| Water use | Millimeters the crops use per year |
| Deficit in an average and a dry year | Water the crops are short of |
| Deficit at critical stages | The same, only in critical months |
| Months without a crop | Bare months per year |
| Heat and frost days at critical stages | Only counted for sensitive crops |
| Erosion | Field-average RUSLE and share of the area above tolerance |
| Stubble, nitrogen, forage, income | Sum of the crops' scores, per year |
| Families and repetition | Plant diversity and whether the same crop repeats year after year |

### The five scores (0 to 100)

| Score | How it's calculated |
|---|---|
| **Water saving** | Half from the dry-year deficit (0 mm is best, 600 mm worst) and half from total water use (500 mm a year best, 1,400 worst) |
| **Soil health** | Average of five parts: cover (months covered), organic matter (stubble), erosion (0 t/ha best, 14 worst), nitrogen and diversity |
| **Income (indicative)** | Sum of the crops' income scores per year. It's relative: no prices or costs |
| **Forage** | Sum of forage scores per year |
| **Climate resilience** | Starts at 100 and subtracts for deficit at critical stages (up to 50), heat at flowering (up to 25) and frost at sensitive stages (up to 25) |

The **total** is the average of the five, weighted by the 0–5 importance the farmer gave
each one. That's why two farmers on the same field can get different suggestions.

The exact thresholds are in `engine.subscores()`. They're heuristic: the team set them
and they haven't been validated with field data.

## Steps 6 and 7: selection and explanation

All 9 rotations are evaluated. Cooper shows the current one and the two with the highest
total among the rest (leaving out those that need livestock if the farmer has none).

The texts are built from templates using the numbers:

- **Why we suggest it:** the scores that improve most over the current rotation, weighted
  by the priorities, with the concrete figure ("the field is left without a crop 1 month a
  year instead of 6 months").
- **Supporting data:** water use, deficit, erosion and the climate in each crop's critical
  months.
- **Possible benefits:** from the crops' properties (adds nitrogen, deep roots, plenty of
  stubble, breaks pest cycles).
- **What we don't know yet:** the data's limits (50 km grid, unmeasured soil, no prices)
  plus each crop's gaps.
- **Risks to review with an agronomist:** those triggered by the numbers (erosion above
  tolerance, deficit at critical stages), what gets worse compared with the current
  rotation, and each crop's own risks.

## The diagnosis: strengths and weaknesses

For each rotation the engine builds a rule-based diagnosis (`engine.diagnose()`):

- **Level of each score:** 65 or more is "good", under 40 is "weak" and the rest is "fair".
  Topics the farmer rated 0 are skipped, and forage is skipped without livestock.
- **The reason:** comes from the indicator that explains the score. For example, soil
  health is explained by its weakest part: erosion above tolerance, months without a crop,
  little stubble, no nitrogen or low diversity.
- **Ideas to improve:** up to two per weak or fair point, taken from
  `data/recommendations.json`. It's a hand-written list, one entry per problem, that an
  agronomist can correct.

It appears on each rotation card ("Strengths and weaknesses") and in one slide of
"Explain it simply". AI plays no part in this: at most it rewords the sentence.

## What the user sees

### The application (`index.html`)

A single-page application with a side menu (a bottom bar on phones). It opens with the
Cooper intro video; its white background is removed in real time by a WebGL shader, and
the logo then lands in the menu while the interface assembles itself.

- **Top bar:** the active field (each user can keep several independent fields), the
  live weather at the field (Open-Meteo through `/api/weather`) and the time and date.
- **Home:** the decision first.
  - *Overall analysis:* the best rotation for the farmer's priorities, its five scores
    compared with today's rotation and a score-profile radar.
  - *Your best options:* one card per score (water saving, soil health, income, forage,
    climate resilience) with the best rotation for that topic alone, only that topic's
    indicators compared with today, its reason and an idea to improve. "See more
    options" reveals the second and third rotations for that score.
  - *Explain it simply:* the narrated explanation of that whole analysis (see below).
  - The field on the map, the upcoming sowing, critical stages and harvest of the
    current rotation, and the 7-day forecast.
- **Analysis:**
  - *New analysis:* the four input steps (field and location, current rotation,
    farm, priorities), then every chart, map and table: climate (monthly, water
    balance, 30 years, temperature), risk calendar, trends, zones of the field, the
    climate scenario, the three rotations side by side with a score radar, and all the
    options ranked. "Save analysis" keeps it in the history.
  - *Analysis history:* saved analyses with date and time, the full breakdown of each
    one, and exports to a branded PDF report, Excel (.xlsx), CSV and JSON.
- **My field:** field details, a 3D model of the SRTM terrain coloured by erosion,
  satellite image, NDVI (NASA GIBS, MODIS 250 m), erosion map, crop and land-cover map
  (ESA WorldCover), soil properties (ISRIC SoilGrids through `/api/soil`), climate
  charts, the crops of the rotation, terrain and notes. When an image source does not
  respond, its panel shows a placeholder ready for that source.
- **Settings:** light, dark or system theme, language, intro and motion preferences,
  and export or deletion of the data stored on the device.
- **Jarvis:** a floating assistant. With a Groq key it answers questions with the
  numbers of the open analysis (`/api/assistant`); without one it gives guided answers
  built from the same data. It explains; it never decides.

Fields, the history and notes are stored in the browser (IndexedDB and localStorage);
there are no user accounts on the server yet.

### "Explain it simply" (`slides.html` and `slides-3d.html`)

An eight-slide narrated presentation for someone with no technical background:
introduction, climate, how it changed, the current rotation, strengths and weaknesses, a
better option, what to check, and closing.

- On Home it plays in a video-style player: it expands over a blurred interface, has a
  progress bar with chapters, ±10 seconds, volume, captions and full screen, and it can
  keep playing in a small window while the farmer uses the rest of the app. The player
  drives the same narration engine (`slides.js`) through its timeline API.
- The base texts come from templates (`slides.js`). The voice is the browser's English
  voice.
- It uses the last analysis run on the main screen, which is saved in the browser. If
  there is none, it uses a real example from the field near Young (`slides-sample.js`,
  built with `scripts/make_slides_sample.py`).
- The 3D version (`slides3d.js`, with Three.js) shows a model of the field: the terrain is
  the SRTM terrain, the soil color is each zone's erosion, plants change month by month
  with the calendar, and the amount of soil washing downhill is proportional to the tonnes
  lost. The landscape beyond the fence is decorative.

### Narration rewritten with Groq

The 3D version sends the slides' template texts to `/api/narrate`. The server
(`narrator.py`) passes them to a Groq model with instructions to rewrite them in more
natural English for farmers in Uruguay, and validates each slide before accepting it:

- it must have the same number of sentences, because each sentence triggers a step of the
  animation;
- each sentence must keep exactly the numbers of the original and add none (a thousands
  comma doesn't count: "1,308" and "1308" are the same number);
- the headline can't introduce new figures, and sentences have a maximum length.

A slide that fails keeps its template text. If the model returns malformed JSON, which
happens now and then, Cooper retries once. If there's no key or Groq doesn't respond, the
whole presentation uses the templates and the screen says so.

- **The key** goes in `backend/.env` (`GROQ_API_KEY`; see `backend/.env.example`). It
  never reaches the browser and is never committed.
- **The model** is `openai/gpt-oss-120b` by default; change it with `GROQ_MODEL`.
- **What is sent to Groq:** only the slides' text, which includes the field's name, the
  rotations and the analysis figures. No coordinates are sent.
- **What Groq doesn't do:** it doesn't write code, calculate indicators, choose or rank
  rotations, or touch the 3D model.

### "Ask Cooper": chat and voice notes

A button in the bottom-right corner opens a chat panel. The farmer can type a question or
record a voice note of up to a minute.

- **Voice notes** are recorded in the browser and sent to `/api/transcribe`, which passes them
  to Groq Whisper (`whisper-large-v3-turbo`). The text appears in the chat as the farmer's
  question. The language is detected automatically.
- **Questions** go to `/api/chat` with the short conversation history and a compact summary of
  the current analysis: inputs, monthly climate, trends, terrain, and for each rotation its
  scores, key figures, calendar, reasons, critical stages, strengths and weaknesses, and main
  risks. Coordinates are not sent.
- **The model** (`openai/gpt-oss-120b` by default) is told to answer in at most about 60 words,
  use only numbers from the summary, say so when the data doesn't have the answer, keep each
  number with its own meaning and avoid markdown. Cooper detects whether the question is in
  English or Spanish and tells the model which language to answer in.
- **Limits:** questions up to 1,500 characters, the last 6 messages as history, a summary of
  about 7,000 characters and voice notes up to 3 MB. When Groq's per-minute limit is hit and it
  asks to wait 15 seconds or less, Cooper waits and retries once.
- **When the analysis changes**, the conversation starts over, because the data behind it is
  different.

The chat can still be wrong: the panel says so, and suggests checking important decisions
with an agronomist. It never makes decisions or changes the analysis.

## The API

| Route | Returns |
|---|---|
| `GET /api/catalog` | Crops, rotations, sample fields and score names |
| `POST /api/analyze` | The full analysis for a point |
| `POST /api/narrate` | The slides' text rewritten by Groq, or the templates if that wasn't possible |
| `GET /api/weather?lat&lon` | Current weather and a 7-day forecast (Open-Meteo, context only) |
| `GET /api/soil?lat&lon` | Modelled soil properties by depth and surface texture (SoilGrids, reference only) |
| `POST /api/assistant` | Jarvis' answer about the open analysis (Groq), or `fuente: "sin_ia"` |
| `POST /api/chat` | A short answer (plain text) about the analysis summary sent with the question |
| `POST /api/transcribe` | The text of a voice note (raw audio body, `Content-Type: audio/*`) |

Input to `/api/analyze`:

```json
{
  "lat": -32.62, "lon": -57.75,
  "rotacion_actual": "soja_continua",
  "prioridades": {"agua": 3, "suelo": 4, "ingreso": 4, "forraje": 1, "clima": 3},
  "escenario": {"lluvia_pct": -20, "temp_delta": 1},
  "capacidad_suelo_mm": 120,
  "tiene_ganado": false,
  "area_ha": 100
}
```

Output: `meta` (source and period), `advertencias` (warnings), `clima` (monthly, monthly
without the scenario, and trends), `rotaciones` (the three rotations, with indicators,
scores, calendar, explanation and diagnosis), `ranking` (every eligible rotation ordered
by total, each with a per-score profile, used for the best option per score) and `zonas`
(terrain summary, the 225 cells and `erosion_ranking`, the erosion per cell of every
ranked rotation).

The API's field names are in Spanish because the prototype was written that way; every
text the user sees is in English.

## Where everything lives

```
backend/app/power.py      NASA POWER client and cache
backend/app/climate.py    climate indicators and trends
backend/app/terrain.py    SRTM, slope, water flow, RUSLE, zones
backend/app/engine.py     water balance, scores, selection, explanations and diagnosis
backend/app/narrator.py   narration rewriting with Groq, and its validation
backend/app/assistant.py  Jarvis answers (/api/assistant), plus short chat and
                          voice-note transcription (/api/chat, /api/transcribe) with Groq
backend/app/weather.py    live weather (Open-Meteo), cached 10 minutes
backend/app/soil.py       SoilGrids soil properties, cached on disk
backend/app/main.py       API and web server
backend/tests/            tests with synthetic data and a simulated Groq (no internet needed)
backend/.env.example      template for the Groq key
data/crops.json           crop table
data/rotations.json       rotation library
data/recommendations.json ideas to improve, per problem
data/cache/               downloaded data (not committed)
frontend/index.html, app.js, styles.css       application shell, routing, top bar, settings
frontend/js/                                  views (home, analysis, history, field), charts,
                                              exports, player, Jarvis, intro, 3D relief
frontend/assets/brand/                        logo, icons and Jarvis rings with real transparency
frontend/public/                              original brand files and the intro video
frontend/slides*.html, slides*.js, slides.css "Explain it simply" (charts and 3D)
scripts/make_slides_sample.py                 rebuilds the slides' sample analysis
legacy/                                       the team's earlier scaffold
```

## Limits to keep in mind

- **The climate describes the area, not the field.** The NASA POWER grid is about 50 km
  wide, so neighboring fields get the same climate.
- **Only the terrain tells zones apart within the field.** Erosion, relative wetness and
  low spots come from SRTM. There's no moisture or vegetation measurement at that scale.
- **The soil isn't measured.** The farmer chooses the water capacity and erodibility (K)
  is a typical value. That's why absolute erosion values are indicative: they're most
  useful for comparing rotations.
- **The field is a square.** The real outline can't be drawn yet.
- **The crop table comes from general literature.** It needs review by a local
  agronomist, as do the score thresholds and the recommendation list.
- **Income is relative.** There are no prices, costs or yields.
- **The calendars are Uruguayan.** Outside Uruguay, Cooper warns that results may not
  apply.
- **It depends on the internet** for maps, libraries (Leaflet, Chart.js, Three.js) and
  new points. Points already queried are served from the cache.
