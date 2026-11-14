# Demo publicada

Publicación verificada el 14 de noviembre de 2026. Las actualizaciones de aplicación ahora usan [GitHub Actions](../../docs/AUTODEPLOY.md).

URL: **https://52.71.101.193**. No se compró ni configuró un dominio de GoDaddy.

## Recursos creados

| Recurso | Valor |
| --- | --- |
| Región / zona | `us-east-1` / `us-east-1a` |
| Instancia Lightsail | `nasa2026-demo` |
| Plan | `nano_3_0`: Linux, 512 MB de RAM, 20 GB de disco, 1 TB de transferencia |
| Precio base consultado en AWS | USD 5/mes, antes de impuestos y excedentes |
| Sistema | Ubuntu 24.04 LTS |
| IP estática asociada | `nasa2026-demo-ip`: `52.71.101.193` |
| Clave SSH registrada | `nasa2026-demo-key` |
| Sitio y API | `/opt/nasa2026/current` → release activo, Nginx y `nasa2026-api.service` |
| Certificado | Let's Encrypt para la IP; renovación automática con `nasa2026-certbot.timer` |

No se configuraron balanceadores, bases de datos administradas, snapshots automáticos ni llamadas pagas a modelos de IA. El disco incluye un archivo de swap de 1 GB para dar margen durante instalación y renovación de certificados. No hay escalado automático. La tarifa base no es un límite absoluto: revisar transferencia excedente, impuestos y recursos que se agreguen en el futuro.

## Acceso y secretos

- HTTPS 443 y validación ACME/redirect en 80 son públicos. SSH está restringido a la IP de administración que se usó al desplegar; una conexión nueva desde otra red requiere actualizar esa regla.
- La API escucha solo en `127.0.0.1:8000`. Nginx expone únicamente comparación y salud, con límite de cuerpo de 16 KB y límites de solicitudes.
- La configuración para futuras claves es `/etc/nasa2026/ai-keys.env`, vacía al publicar. Directorio root con modo 700 y archivo root con modo 600. Nunca incluir claves en Git, el frontend o variables `NEXT_PUBLIC_*`.
- Se puede usar `sudoedit /etc/nasa2026/ai-keys.env` para configurar `GROQ_API_KEY` u `OPENAI_API_KEY` cuando se implemente la integración. Después, reiniciar `nasa2026-api`. Agregar una clave no implementa llamadas al proveedor: la demo actual no las realiza.
- Las credenciales AWS y las claves privadas de GitHub/SSH no se copiaron al servidor. La clave SSH local está fuera de los archivos versionados; conservarla de forma segura.
- GitHub Actions obtiene acceso temporal mediante un rol limitado a esta instancia y abre SSH únicamente para la IP del runner durante el despliegue. No utiliza la clave SSH local del administrador.

## Verificaciones realizadas

- Certificado HTTPS válido y sitio público: 200.
- Salud del backend: 200; comparación: tres opciones y escenario actualizado.
- Cambio de prioridad y lluvia comprobados en el navegador público.
- Rutas `/api/docs`, `/api/climate/power`, `/api/openai` y `/api/groq`: 404.
- Archivo oculto `/.env`: 403; cuerpo excesivo: 413; ráfaga de solicitudes: 429.
- Nginx validó su configuración; backend y proxy activos. Archivo de claves con permisos verificados.
- Renovación simulada de Certbot: éxito; temporizador automático habilitado.
- Memoria del backend observada después del inicio: aproximadamente 46 MB. Es una medición de la demo, no una garantía para futuras funciones o cargas.

Para repetir la prueba pública desde la raíz: `python scripts/check_deployment.py https://52.71.101.193`. Ejecutarla solo contra una demo propia: incluye una ráfaga pequeña para comprobar el límite de solicitudes.

## Operación

Mediante SSH autorizado:

```bash
sudo systemctl status nasa2026-api nginx --no-pager
sudo journalctl -u nasa2026-api -n 50 --no-pager
sudo systemctl list-timers nasa2026-certbot.timer --no-pager
sudo /opt/nasa2026-certbot/bin/certbot renew --dry-run
```

La prueba de renovación no debe sustituir el certificado real por uno de staging. Si se cambia la IP, emitir un certificado nuevo antes de publicar esa dirección.

## Retirar la demo

Decidir primero si hay datos que conservar. **Detener la instancia no elimina la tarifa de Lightsail.** Para cesar el uso, eliminar la instancia dedicada y liberar su IP estática; revisar snapshots/discos adicionales si se crearon después. La IP sin asociar puede generar cargos. No ejecutar la eliminación automáticamente como parte de una actualización. Mantener este inventario actualizado para identificar exactamente los recursos de este proyecto.
