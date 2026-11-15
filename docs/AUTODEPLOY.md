# Actualización automática desde GitHub

La rama de publicación es **`main`**. Cada `git push` a esa rama ejecuta [Check and deploy demo](https://github.com/AlexisBaladon/cooper/actions). Los pull requests ejecutan las verificaciones sin publicar. Para compartir una función, integrar el trabajo en esa rama y esperar que el run termine en verde.

## Flujo

1. GitHub instala `backend/requirements.txt` y ejecuta los tests de clima y rotaciones con pytest.
2. Comprueba la sintaxis de `frontend/app.js`, valida los scripts y empaqueta backend, frontend y catálogos JSON. El frontend actual no requiere build de Next.js.
3. Obtiene credenciales AWS temporales mediante OpenID Connect. La confianza admite únicamente este repositorio y esta rama.
4. Habilita SSH temporalmente desde la IP del runner y obtiene un certificado SSH de corta duración para esta instancia. La clave del servidor está fijada en `deploy/aws-lightsail/known_hosts`.
5. Copia el release y prepara un entorno Python independiente. Solo entonces cambia el enlace `current` y reinicia brevemente la API.
6. Comprueba salud y comparación; si fallan, restaura el release anterior. Verifica la versión pública y cierra el acceso SSH temporal al terminar.

El resultado aparece en la pestaña **Actions** y en el resumen del run, con el enlace del sitio. No es instantáneo: incluye tiempo de cola, pruebas, build e instalación. Una página ya abierta puede necesitar recargarse para mostrar los nuevos archivos. No hay que descargar cambios ni ejecutar comandos manualmente en AWS después de cada push.

## Acceso y costo

- No se guardan claves AWS permanentes ni la clave SSH local en GitHub Secrets.
- La confianza OIDC coincide con el `sub` observado en GitHub, incluyendo los IDs inmutables de la cuenta/repositorio y la referencia exacta de la rama. No se usa una confianza comodín para otros repositorios o ramas.
- El rol `nasa2026-github-deploy` puede obtener acceso temporal y abrir/cerrar puertos solo de la instancia `nasa2026-demo`; no puede crear o eliminar instancias ni administrar IAM.
- El permiso de despliegue permite modificar el código del servidor. Solo personas autorizadas deben poder escribir en la rama de publicación.
- Las futuras claves Groq/OpenAI siguen en `/etc/nasa2026/ai-keys.env`, fuera de los releases; los despliegues no las sobrescriben. Los datos futuros deben estar fuera de `releases/`, por ejemplo en `/var/lib/nasa2026`.
- La caché NASA usa `NASA_CACHE_DIR=/var/lib/nasa2026/power-cache`, así conserva sus descargas al publicar otra versión. El proxy limita las consultas de análisis simultáneas y permite el tiempo necesario para una descarga inicial.
- Se reutiliza la misma VM de USD 5/mes. No se añadieron CodePipeline, CodeBuild, Lambda, S3 ni otra máquina para desplegar. Los límites y precios de GitHub Actions deben revisarse si se cambia la visibilidad del repositorio o el tipo de runner.
- La configuración de TLS, el servicio y el activador privilegiado son archivos de infraestructura. Cambiarlos en Git no los instala automáticamente como root; requieren una actualización revisada por el operador.

## Diagnóstico y recuperación

La versión publicada se consulta en `https://52.71.101.193/version.json`. El historial de releases está en `/opt/nasa2026/releases`, con enlaces `current` y `previous`. Se conservan el actual, su predecesor y como máximo un release anterior adicional; el bootstrap inicial se conserva para recuperación.

Si el run falla durante el build, la demo anterior sigue publicada. Si falla la comprobación del nuevo backend, el activador revierte el enlace y reinicia el backend anterior. Para reintentar, usar **Re-run all jobs** en Actions. Si se cancela forzosamente un runner y el cierre final no llega a ejecutarse, revisar las reglas SSH de Lightsail y retirar la IP temporal indicada por ese run; mantener la regla del administrador.

Para revisar desde SSH:

```bash
readlink -f /opt/nasa2026/current
cat /opt/nasa2026/current/RELEASE
sudo journalctl -u nasa2026-api -n 50 --no-pager
```

La renovación del certificado continúa con `nasa2026-certbot.timer`, independientemente de GitHub Actions. El cambio de IP o de instancia exige actualizar el pin SSH, la política IAM y los identificadores del cliente de despliegue antes de volver a publicar.
