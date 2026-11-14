# Rotaciones con datos NASA · Space Apps 2026

Proyecto inicial para el desafío [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/) de NASA Space Apps Challenge 2026. Equipo en Uruguay.

La meta es ayudar a un productor a **comparar su rotación actual con dos alternativas** usando observaciones de la Tierra, datos de suelo, características de cultivos y sus prioridades. El sistema muestra razones, evidencia, datos faltantes y riesgos para revisar con un técnico local. Es apoyo a la decisión; no prescribe una siembra.

## Estado

Demo pública inicial: **[https://52.71.101.193](https://52.71.101.193)**. Frontend y API en una VM AWS Lightsail de USD 5/mes de base; ver [recursos, verificaciones y operación](deploy/aws-lightsail/DEPLOYMENT.md). El código de despliegue está en la rama `work/aws-demo`.

Este repositorio es un **punto de partida funcional**, no una recomendación agronómica validada. El comparador incluido usa datos y reglas **ilustrativos**. La conexión NASA POWER permite consultar temperatura y precipitación históricas para una coordenada, pero aún no alimenta la puntuación de rotaciones. No se han integrado SMAP, ECOSTRESS, MODIS/Landsat, GPM, SRTM ni datos de suelo uruguayos.

## Inicio rápido

Requisitos: Python 3.11+, Node.js 20.9+ y npm.

### API

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
uvicorn app.main:app --reload --port 8000
```

En macOS/Linux: `source .venv/bin/activate`. API docs: <http://localhost:8000/docs>. Verificación: `python -m unittest discover -s tests` desde `api/`.

### Web

En otra terminal:

```powershell
cd web
npm install
Copy-Item .env.example .env.local
npm run dev
```

Abrir <http://localhost:3000>. El frontend usa `NEXT_PUBLIC_API_URL`; por defecto apunta a <http://localhost:8000>. `npm run lint` y `npm run build` verifican el frontend.

## Carpetas

- `api/`: endpoints de salud, comparación ilustrativa y consulta NASA POWER.
- `web/`: interfaz inicial en español para comparar tres rotaciones.
- `docs/`: desafío, propuesta, decisiones y plan de datos.
- `docs/propuesta-original.pdf`: copia del documento compartido por el equipo.
- [Guía del participante Uruguay 2026](docs/resources/SpaceApps2026_GuiaDelParticipante.pptx.pdf): documento original de Space Uruguay, con agenda y Global Offers (p. 14).
- [Comparación de despliegue y costos](docs/DESPLIEGUE.md): opciones gratuitas, ofertas y alternativa con VM.
- [Despliegue AWS Lightsail](deploy/aws-lightsail/README.md): plan de publicación inicial elegido por el equipo.
- [Preparación de VM](deploy/vm/README.md): release estático, API local, HTTPS sin dominio y controles de acceso.

## Próximos pasos del equipo

1. Acordar un caso de uso en Uruguay y dos rotaciones alternativas reales con un agrónomo local.
2. Definir cultivos, calendario, límites de suelo y procedencia de cada parámetro. No usar los valores de demostración para campo.
3. Preparar una serie NASA POWER reproducible y evaluar su escala espacial para el campo elegido.
4. Incorporar una fuente de suelo (MGAP o SoilGrids), con licencia y resolución documentadas.
5. Conectar los datos a la comparación, mostrar incertidumbre y probar el escenario de lluvia −20 %.
6. Construir mapa y calendario después de contar con geometría y series fiables.

Ver [plan de trabajo](docs/PLAN.md) y [fuentes](docs/DATOS.md).

## Colaboración

Crear una rama por tarea, abrir pull requests hacia la rama de trabajo del equipo y registrar fuentes y supuestos junto a cada cambio. No subir claves, credenciales, datos privados de productores ni descargas satelitales voluminosas. La licencia del código queda pendiente de decisión del equipo.
