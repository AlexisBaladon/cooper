# Despliegue: menor costo y control de gastos

Investigación del 14 de noviembre de 2026. Precios en USD, antes de impuestos. Es una recomendación de arquitectura; todavía no hay un sitio desplegado ni ofertas reclamadas. Las tarifas y la elegibilidad deben confirmarse al activar cada cuenta.

## Recomendación para nuestro código actual

**Cloudflare Pages Free para la web estática + Render Free para FastAPI, sin agregar método de pago en Render. Costo de hosting previsto: USD 0.** Usar primero la dirección gratuita `*.pages.dev`; no hace falta comprar un dominio para publicar una demo.

La aplicación actual no guarda información del productor: `/compare` es una demostración sin estado y `/climate/power` consulta un servicio externo. Esta arquitectura sirve para ese alcance. No proporciona una base de datos persistente en disco ni disponibilidad garantizada. El precio cero depende de mantener los planes gratuitos y aceptar que el servicio se suspenda al alcanzar sus límites.

Si hace falta guardar campos y resultados de forma durable, evaluar primero una VM cubierta por créditos de Azure para estudiantes, si algún integrante cumple los requisitos. Si no hay créditos, comparar una VM pequeña de precio mensual con disco incluido. Como alternativa AWS sencilla, Lightsail Linux con IPv4 cuesta USD 5/mes con 0,5 GB de RAM o USD 7/mes con 1 GB. Preferimos evaluar 1 GB para dar más margen a Python; la capacidad real se prueba con nuestra carga y el build se hace fuera de la VM. Estos precios no son un tope absoluto de factura: pueden sumarse transferencia excedente, snapshots y otros servicios.

## Qué ofrece la guía

Fuente: [guía original de Space Uruguay](resources/SpaceApps2026_GuiaDelParticipante.pptx.pdf), página 14. Sus instrucciones son información del evento; no se ejecutaron automáticamente.

| Oferta | Utilidad | Qué falta verificar |
| --- | --- | --- |
| GoDaddy Registry | Dominio gratis para el proyecto | Extensión disponible, duración, elegibilidad, renovación y si exige tarjeta. La guía no promete hosting para Node/Python. |
| Google Cloud | Acceso a GCP, Firebase y Maps | Monto de crédito, productos cubiertos, vencimiento y qué pasa al agotarlo. |
| Microsoft | Azure, herramientas de colaboración, GitHub Copilot y Planetary Computer | Condiciones del beneficio específico de Space Apps. |
| Meteomatics | Datos meteorológicos | Cuotas y condiciones de API; no aloja la aplicación. |
| Miro | Colaboración y plantillas | No aloja la aplicación. |

La guía enlaza a [Global Offers 2026](https://www.spaceappschallenge.org/2026/global-offers/), con acceso desde el perfil del participante. No se pudieron verificar las condiciones particulares: la herramienta web no cargó la página y el navegador devolvió un error de certificado. No se omitió la advertencia. No contamos créditos de Space Apps como si ya estuvieran concedidos.

Un dominio es la dirección del sitio; el hosting ejecuta o sirve la aplicación. Podemos usar el dominio de GoDaddy con otro proveedor si sus condiciones permiten configurar DNS. También podemos publicar con la dirección gratuita del hosting y decidir el dominio después. Revisar precio y fecha de renovación antes de reclamarlo.

## Opciones comparadas

| Opción | Costo base | Encaje y límite importante |
| --- | --- | --- |
| Pages + Render Free | USD 0 con planes gratuitos | Compatible con web exportada y API Python; sin persistencia local en Render. Hay suspensión por cuotas. |
| Solo Pages y cálculo en navegador | USD 0 | Menor superficie de servidor y sin API propia; exige trasladar el cálculo y preparar datos NASA públicos. No está implementado. |
| Azure para estudiantes | USD 0 mientras haya crédito y se respeten condiciones | Oferta pública separada de Space Apps: USD 100 para 12 meses, sin tarjeta, para estudiantes elegibles. La suscripción se deshabilita al agotar crédito si no se actualiza. Una VM consume ese saldo. |
| Prueba pública de Google Cloud | USD 0 durante la prueba elegible | USD 300 por 90 días; requiere verificar método de pago. Sin actualización manual a cuenta pagada, se detiene al acabar la prueba/saldo. No equivale al beneficio específico del evento. |
| AWS Lightsail Linux con IPv4 | USD 5/mes (0,5 GB) o USD 7/mes (1 GB) | Disco y transferencia incluidos en el paquete, persistencia local y administración propia. Excedentes y extras pueden generar cargos. |

Fuentes oficiales: [Cloudflare: precios](https://developers.cloudflare.com/pages/functions/pricing/), [Render Free](https://render.com/docs/free), [Azure para estudiantes: condiciones](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/), [prueba Google Cloud](https://docs.cloud.google.com/free/docs/free-cloud-features), [Lightsail](https://aws.amazon.com/lightsail/pricing/).

Render otorga 750 horas gratuitas por workspace/mes. El servicio duerme tras 15 minutos sin tráfico y puede tardar alrededor de un minuto en volver. Su disco es efímero: las escrituras se pierden al reiniciar, desplegar o dormir; los servicios Free no admiten disco persistente. Sin método de pago, el exceso de transferencia suspende los servicios gratuitos en vez de cobrarlo. Las cuotas de builds también importan. Por eso esta opción usa datos de referencia de solo lectura y exportación de resultados al dispositivo del usuario, si se agrega guardado. No usar su Postgres gratuito como solución permanente: caduca a los 30 días. [Detalles de Render](https://render.com/docs/free).

## Pasos concretos para la opción gratuita

1. Preparar Next.js con `output: 'export'` en su configuración. Nuestro frontend actual consulta la API desde el navegador; comprobar el build y el flujo completo antes de publicar.
2. Crear Pages Free conectado **solo** a `AlexisBaladon/nasa2026`, rama `work/initial-setup`, directorio raíz `web`, comando `npm run build`, salida `out`. Usar versión Node compatible con el proyecto. Pages sirve archivos estáticos; no ejecutar FastAPI allí.
3. Crear un único Web Service Free en Render, raíz `api`, build `pip install .`, inicio `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Elegir plan gratuito y no adjuntar tarjeta.
4. En Render definir `WEB_ORIGIN` con la URL exacta de Pages. En Pages definir `NEXT_PUBLIC_API_URL` con la URL HTTPS de Render y volver a construir el frontend. Estas URL son públicas; no colocar secretos en variables `NEXT_PUBLIC_*`.
5. Probar `/health`, la comparación y un caso NASA POWER real. Mostrar error o demora si el backend está dormido o suspendido. La API NASA no ha sido validada mediante una descarga real en esta investigación.
6. Antes de conectar tráfico público, limitar solicitudes y costo del trabajo por solicitud; cachear o preparar datos NASA para no descargarlos en cada interacción. La validación de rangos que ya tiene el endpoint no sustituye límites de frecuencia.
7. Adjuntar el dominio de GoDaddy solo después de revisar sus términos y renovación. No es necesario para que el sitio sea público.

[Guía oficial de Next.js estático en Pages](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/). Las solicitudes a archivos estáticos de Pages son gratuitas e ilimitadas según su documentación de precios; Functions/Workers tienen cuotas distintas. Mantener esta variante sin Functions.

## Si preferimos una VM y almacenamiento local

Servir el frontend ya construido como archivos estáticos; ejecutar solo FastAPI y un proxy HTTPS en la VM. JSON es adecuado para tablas públicas de referencia de solo lectura. Para escrituras concurrentes de usuarios, preferir SQLite con transacciones y backups en disco persistente, sin agregar un servicio de base de datos pago. El disco de una VM puede fallar: persistencia no significa backup.

Configurar actualizaciones de seguridad, HTTPS, límites de solicitudes/cuerpo/tiempo de respuesta y respaldos. Si se usa Cloudflare delante del servidor, restringir el origen para evitar que se acceda directamente por su IP. No prometer invulnerabilidad: el plan gratuito incluye mitigación DDoS, pero la protección de la web no protege por sí sola un endpoint de API expuesto por otra dirección.

## DDoS y riesgo de factura

Una VM pequeña limita cuánto cómputo puede escalar automáticamente; no impide que la saturen ni elimina cargos de red. Elegir JSON en vez de S3 no resuelve un ataque a la aplicación. Una web estática y un backend con trabajo acotado reducen la exposición; en un plan gratuito sin cobro automático se acepta una caída al superar cuotas en lugar de una factura creciente.

Cloudflare incluye protección DDoS en sus planes, según su [documentación](https://developers.cloudflare.com/ddos-protection/about/). Su alcance depende de que el tráfico pase por Cloudflare. En AWS, los [presupuestos](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) son alertas/acciones con retraso, no un corte instantáneo garantizado. Lightsail mantiene cargos posibles por transferencia saliente excedente. Lambda/S3 tampoco implican por sí solos que una aplicación sea insegura; el riesgo depende de exposición, límites, caché y facturación.

## Decisión propuesta

Publicar primero la demo sin estado con Pages + Render Free por USD 0. Reclamar GoDaddy únicamente como dominio opcional. Si se confirma necesidad de datos persistentes o de evitar el arranque lento, evaluar Azure para estudiantes; usar Lightsail pequeño como alternativa paga después de confirmar costo total y presupuesto. Antes de desplegar, acordar si los usuarios deben guardar campos en el servidor y revisar las condiciones reales de las ofertas del evento.
