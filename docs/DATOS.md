# Plan de datos y trazabilidad

| Fuente prevista | Señal | Estado | Precaución |
| --- | --- | --- | --- |
| [NASA POWER](https://power.larc.nasa.gov/) | Temperatura y precipitación históricas | Consulta API implementada; sin unión al motor | Serie regional, no medición del lote |
| [SMAP](https://smap.jpl.nasa.gov/) | Humedad superficial del suelo | Pendiente | Resolución demasiado gruesa para ciertos campos |
| [GPM IMERG](https://gpm.nasa.gov/data/imerg) | Precipitación y eventos intensos | Pendiente | Validar frente a pluviómetros locales |
| [ECOSTRESS](https://ecostress.jpl.nasa.gov/) | Temperatura/estrés hídrico | Pendiente | Cobertura y fechas irregulares |
| MODIS / Landsat | Vegetación y suelo descubierto | Pendiente | Nubes, mezcla de píxeles, interpretación de NDVI |
| SRTM | Pendiente del terreno | Pendiente | Pendiente sola no equivale a riesgo de erosión |
| MGAP / SoilGrids | Propiedades del suelo | Pendiente | Confirmar fuente, licencia y escala local |
| Tabla de cultivos del equipo | Agua, nitrógeno, raíces y calendario | Pendiente | Revisar con agrónomo y bibliografía local |

Para cada dato integrado registrar: producto y versión, URL, fecha de descarga, cobertura temporal, resolución espacial, unidades, tratamiento de faltantes, transformación, licencia y límites. Guardar datos crudos fuera de Git. No llamar “medición de campo” a una estimación satelital o de modelo.

La API POWER usa el endpoint diario público `https://power.larc.nasa.gov/api/temporal/daily/point` con `T2M` y `PRECTOTCORR`. Al desarrollar el cálculo, conservar el JSON fuente, unidades y parámetros de la solicitud en la evidencia del proyecto.
