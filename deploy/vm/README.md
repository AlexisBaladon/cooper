# VM inicial sin dominio propio

Objetivo: una VM pequeña Debian/Ubuntu con IP pública y sin escalado automático. El frontend actual es HTML/JavaScript estático, sin build de Next.js. Confirmar tamaño, precio y facturación antes de crear recursos. Para la selección actual del equipo ver [AWS Lightsail](../aws-lightsail/README.md).

## Antes de publicar

1. Verificar la cuenta, créditos y límites de facturación. No asumir que una alerta de presupuesto detiene los gastos.
2. Crear recursos nuevos y etiquetados para este equipo; no reutilizar servidores de otros trabajos.
3. Aplicar reglas solo a esta VM: TCP 80 y 443 públicos; SSH restringido a la IP de administración (o IAP si se usa Google Cloud). Mantener el puerto 8000 privado y sin servicio de base de datos expuesto.
4. La VM no necesita claves cloud ni de GitHub. Copiar únicamente el release construido, sin `.git`, `.env`, tokens o credenciales locales.

## Preparar release local

Desde la raíz ejecutar `python scripts/package_release.py` para generar `dist/nasa2026-release.tar.gz` con una lista explícita de archivos de `backend/`, `frontend/`, catálogos JSON de `data/` y scripts de VM. El archivo no incluye `.git`, credenciales, descargas NASA ni los documentos del equipo. Revisar su contenido antes de copiarlo.

Para una instalación inicial, extraer el release bajo `/opt/nasa2026` en la VM. Ejecutar:

```bash
sudo bash /opt/nasa2026/deploy/vm/install.sh
```

El servicio Python escucha solo en loopback, con un proceso y límites de memoria. Nginx expone salud, catálogo y análisis, con límites de solicitudes y de análisis simultáneos. La caché NASA se guarda en el estado persistente del servicio. Los límites ayudan frente al abuso de aplicación, pero no garantizan disponibilidad ni un tope de transferencia facturada.

Para futuras integraciones Groq/OpenAI, el servicio lee opcionalmente `/etc/nasa2026/ai-keys.env`, creado vacío con permisos 600 y directorio 700. Editarlo con `sudoedit` en el servidor y reiniciar `nasa2026-api` cuando se implemente una integración. No escribir claves en el chat, en Git ni en `NEXT_PUBLIC_*`. La demo no realiza llamadas a modelos ni necesita claves para funcionar. No se agregan endpoints de IA genéricos sin autenticación, límites y un presupuesto para el proveedor.

## HTTPS directo sobre la IP

No hace falta comprar un dominio: Let's Encrypt admite certificados para IP públicas. Usar **Certbot 5.4 o superior**, instalado según sus instrucciones oficiales, y revisar/aceptar personalmente sus términos antes de solicitar el certificado.

Después de autorizar esa solicitud y con el puerto 80 accesible, usar el modo `certonly --webroot`, raíz `/var/www/acme`, `--ip-address IP_PUBLICA` y `--preferred-profile shortlived`. El certificado no configura Nginx automáticamente: sustituir `PUBLIC_IP` en `nginx-https.conf.template`, instalar como `/etc/nginx/sites-available/default`, ejecutar `nginx -t` y recargar.

Configurar renovación automática y un deploy hook `systemctl reload nginx`, y verificarla con `certbot renew --dry-run`. Estos certificados duran aproximadamente seis días: no publicar sin haber comprobado el temporizador de renovación. Un cambio de IP requiere otro certificado. No usar certificados de staging para la URL final ni omitir las advertencias del navegador.

`enable-https.sh IP_PUBLICA` automatiza esa configuración tras revisar los términos de Let's Encrypt. Instala Certbot en un entorno separado, habilita `nasa2026-certbot.timer` dos veces al día y comprueba una renovación simulada. La instalación del primer certificado usa el servicio de producción; la prueba de renovación utiliza staging sin sustituir el certificado público.

Fuentes: [Certbot y certificados IP](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/), [firewall Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html).

## Comprobación final

- Abrir `https://IP_PUBLICA` desde fuera de la VM con certificado válido.
- Comprobar `/api/health`, las tres alternativas y cambios de prioridad/lluvia.
- Verificar que `/api/docs` y `/api/climate/power` no sean públicos y que 8000 no esté expuesto.
- Probar límite de cuerpo y solicitudes; revisar servicio y timer de renovación.
- Registrar URL, recursos, región, costo previsto y procedimiento para detener/eliminar la demo. Los discos/IP reservadas pueden seguir costando aunque la VM esté detenida.

Esta preparación no crea una VM ni configura facturación por sí sola.
