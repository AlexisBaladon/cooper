# Demo inicial en Amazon Lightsail

El equipo eligió AWS después de comprobar que la prueba pública de Google Cloud de la cuenta disponible estaba vencida. La preparación local no crea infraestructura ni autoriza cobros por sí sola.

## Plan para revisar antes de crear

- Una VM Linux/Unix, Ubuntu o Debian compatible con [el instalador común](../vm/README.md), en `us-east-1`.
- Consultar los paquetes disponibles en la cuenta. Referencia pública del 14/11/2026: IPv4 + 512 MB por USD 5/mes o 1 GB por USD 7/mes. Preferir evaluar 1 GB para Python, Nginx, actualizaciones y renovación TLS; no ejecutar el build de Next.js allí.
- Mantener una sola instancia, sin balanceador, base administrada, snapshots automáticos ni otros servicios pagos añadidos.
- Solicitar una IP estática y asociarla a la VM para evitar cambios de dirección/certificado. Una IP sin asociar puede generar cargos.
- Confirmar impuestos, transferencia incluida y excedentes. La tarifa base no garantiza un tope total. Las alertas de presupuesto tampoco son un corte instantáneo.

## Acceso

1. Iniciar sesión en [Lightsail](https://lightsail.aws.amazon.com/). El titular ingresa credenciales, verificaciones y datos de pago personalmente.
2. Para operaciones locales, usar autenticación temporal `aws login` si la cuenta lo admite. No compartir claves de acceso por chat ni guardarlas en Git. Verificar identidad y región antes de cada creación.
3. Crear una clave SSH exclusiva de la demo y subir únicamente su parte pública. Conservar la privada fuera de los archivos versionados.
4. Limitar SSH a la dirección de administración. Abrir solo 80/443 para la web; revisar reglas IPv4 e IPv6. No abrir 8000.

## Publicación

Seguir [preparación del release, servicio, proxy y HTTPS sobre IP](../vm/README.md). Copiar el archivo de release desde la computadora, sin credenciales del repositorio en el servidor. El acceso público final será `https://IP_PUBLICA`, sin dominio comprado. Las solicitudes a servicios externos de NASA no se exponen en esta demo inicial.

Antes de entregar la URL: probar certificado válido y renovación, comparación real frontend/API, límites del proxy y endpoints bloqueados. Registrar tamaño, región, costo y recursos creados. Si el sitio se retira, revisar instancia, disco, snapshots e IP reservada; detener la VM no siempre elimina cargos.

Fuentes: [precios Lightsail](https://aws.amazon.com/lightsail/pricing/), [firewall](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html), [login temporal de CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).
