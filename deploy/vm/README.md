# VM inicial sin dominio propio

Objetivo: una VM pequeña Debian/Ubuntu con IP pública y sin escalado automático. El build de Next.js se realiza en la computadora, no en la VM. Confirmar tamaño, precio y facturación antes de crear recursos. Para la selección actual del equipo ver [AWS Lightsail](../aws-lightsail/README.md).

## Antes de publicar

1. Verificar la cuenta, créditos y límites de facturación. No asumir que una alerta de presupuesto detiene los gastos.
2. Crear recursos nuevos y etiquetados para este equipo; no reutilizar servidores de otros trabajos.
3. Aplicar reglas solo a esta VM: TCP 80 y 443 públicos; SSH restringido a la IP de administración (o IAP si se usa Google Cloud). Mantener el puerto 8000 privado y sin servicio de base de datos expuesto.
4. La VM no necesita claves cloud ni de GitHub. Copiar únicamente el release construido, sin `.git`, `.env`, tokens o credenciales locales.

## Preparar release local

En `web/`, sin `NEXT_PUBLIC_API_URL` local definido (producción usa `/api`):

```powershell
npm ci
npm run build
```

Desde la raíz ejecutar `python scripts/package_release.py` para generar `dist/nasa2026-release.tar.gz` con una lista explícita de archivos. El archivo no incluye `.git`, credenciales ni los documentos del equipo. Revisar su contenido antes de copiarlo. Mantener las variables de desarrollo en `.env.local` fuera del build de producción; un valor `NEXT_PUBLIC_API_URL=http://localhost:8000` rompería las consultas en los navegadores de otros usuarios.

Copiar `web/out/`, `api/app/`, `api/pyproject.toml` y `deploy/vm/` a la misma estructura bajo `/opt/nasa2026` en la VM. Ejecutar:

```bash
sudo bash /opt/nasa2026/deploy/vm/install.sh
```

El servicio Python escucha solo en loopback, con un proceso y límites de concurrencia. Nginx solo expone comparación y salud; las consultas NASA y documentación API quedan fuera de la demo pública. Los límites de solicitudes ayudan frente al abuso de aplicación, pero no garantizan disponibilidad ni un tope de transferencia facturada.

## HTTPS directo sobre la IP

No hace falta comprar un dominio: Let's Encrypt admite certificados para IP públicas. Usar **Certbot 5.4 o superior**, instalado según sus instrucciones oficiales, y revisar/aceptar personalmente sus términos antes de solicitar el certificado.

Después de autorizar esa solicitud y con el puerto 80 accesible, usar el modo `certonly --webroot`, raíz `/var/www/acme`, `--ip-address IP_PUBLICA` y `--preferred-profile shortlived`. El certificado no configura Nginx automáticamente: sustituir `PUBLIC_IP` en `nginx-https.conf.template`, instalar como `/etc/nginx/sites-available/default`, ejecutar `nginx -t` y recargar.

Configurar renovación automática y un deploy hook `systemctl reload nginx`, y verificarla con `certbot renew --dry-run`. Estos certificados duran aproximadamente seis días: no publicar sin haber comprobado el temporizador de renovación. Un cambio de IP requiere otro certificado. No usar certificados de staging para la URL final ni omitir las advertencias del navegador.

Fuentes: [Certbot y certificados IP](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/), [firewall Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html), [Next.js estático](https://nextjs.org/docs/app/guides/static-exports).

## Comprobación final

- Abrir `https://IP_PUBLICA` desde fuera de la VM con certificado válido.
- Comprobar `/api/health`, las tres alternativas y cambios de prioridad/lluvia.
- Verificar que `/api/docs` y `/api/climate/power` no sean públicos y que 8000 no esté expuesto.
- Probar límite de cuerpo y solicitudes; revisar servicio y timer de renovación.
- Registrar URL, recursos, región, costo previsto y procedimiento para detener/eliminar la demo. Los discos/IP reservadas pueden seguir costando aunque la VM esté detenida.

Esta preparación no crea una VM ni configura facturación por sí sola.
