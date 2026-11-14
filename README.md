# Cooper · NASA Space Apps 2026

Herramienta web de apoyo a la decisión para que un productor uruguayo compare
rotaciones de cultivos usando datos de la NASA. Responde al desafío
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).

Cooper ayuda a pensar, no decide: muestra datos, razones y riesgos para revisar con un
agrónomo local. No hay inteligencia artificial tomando decisiones; todo sale de reglas y
fórmulas que se pueden revisar.

## Estado

El proyecto se incorpora al repositorio en cinco fases. Esta es la **fase 1**.

| Fase | Contenido | Estado |
|---|---|---|
| 1. Base y clima | Servidor, datos diarios de NASA POWER, clima de la zona y tendencias | ✅ |
| 2. Motor de rotaciones | Tabla de cultivos, balance de agua, puntajes, explicaciones y simulador de clima | ⏳ |
| 3. Terreno y erosión | Relieve SRTM, erosión RUSLE por rotación y mapa de zonas del campo | ⏳ |
| 4. Diagnóstico y "Explícamelo fácil" | Lo bueno y lo flojo, recomendaciones y resumen con voz en 3D | ⏳ |
| 5. IA y documentación | Redacción de la voz con Groq y documentación completa | ⏳ |

El esqueleto anterior del equipo (API FastAPI, web Next.js y documentos iniciales) está
en [`legacy/`](legacy/).

## Qué hace la fase 1

1. El usuario marca un punto en el mapa de Uruguay o elige uno de tres campos de ejemplo.
2. El servidor descarga 30 años de datos diarios de NASA POWER (1996–2025) para ese punto.
3. La página muestra:
   - lluvia y evapotranspiración de referencia por mes, para ver cuándo los cultivos pasan sed;
   - un calendario de riesgos: días de calor, de helada, de lluvia fuerte y déficit de agua;
   - cómo cambió el clima entre 1996–2010 y 2011–2025.

## Cómo correrlo

Requisitos: Python 3.11 o superior.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # en macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Abrir <http://127.0.0.1:8000>. El mismo servidor entrega la API y la página.

Tests (no usan internet): `cd backend && python -m pytest -q`

La primera consulta de un punto nuevo tarda unos 10 segundos: descarga la serie de NASA
POWER y la guarda en `data/cache/`, que no se sube al repositorio. Las siguientes
consultas del mismo punto son instantáneas. El mapa y las librerías de la página se
cargan desde internet.

## Estructura

```
backend/app/power.py     cliente de NASA POWER con caché en disco
backend/app/climate.py   evapotranspiración, calor, heladas, lluvia fuerte y tendencias
backend/app/main.py      API (/api/catalog, /api/analyze) y servidor de la página
backend/tests/           tests con datos sintéticos
frontend/                página en HTML y JavaScript (Leaflet y Chart.js)
legacy/                  esqueleto inicial del equipo
```

## Datos y supuestos

| Dato | Fuente | Resolución |
|---|---|---|
| Temperatura máxima y mínima, lluvia, humedad del suelo en la zona de raíces | [NASA POWER](https://power.larc.nasa.gov/) (MERRA-2 y GPM-IMERG), diario | ~50 km |

- **Evapotranspiración de referencia (ET0):** Hargreaves-Samani (FAO-56), con temperatura
  máxima, mínima y latitud.
- **Día de calor:** máxima ≥ 32 °C. **Riesgo de helada:** mínima del aire ≤ 2 °C, porque
  el suelo y las hojas se enfrían más que el aire a 2 m y la grilla suaviza los extremos.
  **Lluvia fuerte:** ≥ 40 mm en un día.
- **Año agrícola:** de mayo a abril. Solo se usan años agrícolas completos.
- **Año seco:** el percentil 20 de la lluvia de cada mes (un mes malo de cada cinco).
- **Escala:** el clima es de la zona, no del campo. Dos campos vecinos reciben los mismos datos.
- **Fuera de Uruguay** la página avisa que los resultados pueden no aplicar.

## Colaboración

Una rama por tarea y pull requests hacia la rama de trabajo del equipo. No subir claves,
credenciales, datos privados de productores ni descargas satelitales voluminosas.
