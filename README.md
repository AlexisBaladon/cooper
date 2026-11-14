# Cooper · NASA Space Apps 2026

Cooper is a decision-support web tool that helps Uruguayan farmers compare crop
rotations using NASA Earth observation data. It answers the
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/)
challenge.

Cooper helps farmers think; it doesn't decide for them. It shows data, reasons and risks
to review with a local agronomist. No AI makes the decisions: every result comes from
written rules and published formulas that anyone can check.

## Status

The project is being brought into this repository in five phases. This is **phase 3**.

| Phase | Content | Status |
|---|---|---|
| 1. Base and climate | Server, daily NASA POWER data, local climate and trends | ✅ |
| 2. Rotation engine | Crop table, water balance, scores, explanations and climate scenarios | ✅ |
| 3. Terrain and erosion | SRTM elevation, RUSLE erosion per rotation and a map of zones within the field | ✅ |
| 4. Diagnosis and "Explain it simply" | Strengths and weaknesses, recommendations and a narrated 3D summary | ⏳ |
| 5. AI and documentation | Narration text written with Groq, and full documentation | ⏳ |

The team's earlier scaffold (FastAPI API, Next.js web app and first documents) is in
[`legacy/`](legacy/).

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
   - a scenario slider to recalculate everything with less rain or more heat.

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

The first query for a new point takes about 15 to 20 seconds while it downloads the NASA
POWER series and the SRTM elevation into `data/cache/`, which is not committed. Later queries for the same point are
instant. The map and the page's libraries load from the internet.

## Project layout

```
backend/app/power.py     NASA POWER client with an on-disk cache
backend/app/climate.py   evapotranspiration, heat, frost, heavy rain and trends
backend/app/engine.py    water balance, indicators, scores and explanations
backend/app/terrain.py   SRTM elevation, slope, water flow, RUSLE erosion and field zones
backend/app/main.py      API (/api/catalog, /api/analyze) and web server
backend/tests/           tests with synthetic data
data/crops.json          crop table (editable by an agronomist)
data/rotations.json      rotation library
frontend/                web page in HTML and JavaScript (Leaflet and Chart.js)
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
- **Income is relative:** it compares crops with each other; there are no prices, costs or
  yields yet.
- **Scale:** the climate describes the area, not the field. Neighboring fields get the
  same data.
- **The crop table and thresholds come from general literature** and need review by a local
  agronomist.

## Collaboration

One branch per task and pull requests into the team's working branch. Don't commit keys,
credentials, private farmer data or large satellite downloads.
