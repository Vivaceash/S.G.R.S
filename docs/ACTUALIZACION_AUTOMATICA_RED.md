# Actualización manual de redes y CCTV

El Dashboard consulta `GET /api/networks` al usar su botón de actualización. No hay consulta periódica ni actualización al recuperar visibilidad o conexión. No se mantiene una lista de nombres o VLANs permitidas en Soporte.

El catálogo combina las conexiones configuradas:

| Fuente | Información |
| --- | --- |
| Forti `/network/dhcp-pools` | Servidores DHCP habilitados, capacidad y concesiones |
| Forti `/network/interface-config` | Interfaces, VLANs y subredes, incluidas redes sin DHCP |
| Forti `/network/dhcp-leases` | Clientes de los pools consultados |
| Omni `/catalogs/access-role-profiles` | Perfiles de acceso actuales, sin nombres declarados en el código |
| Omni `/catalogs/vlans` | VLANs publicadas por el proveedor, cuando la ruta está disponible |

Cada consulta vuelve a leer las fuentes. Nombres equivalentes con prefijos de perfil o SSID se agrupan cuando existe una única coincidencia. Los perfiles se identifican como tales: un perfil de acceso no demuestra por sí solo la existencia de un SSID o su VLAN. Los dispositivos pueden asociarse por el perfil explícito informado por Omni o por una subred configurada.

La capacidad, las concesiones y la saturación permanecen desconocidas cuando la fuente solo publica un perfil o una interfaz. No se deducen VLANs del nombre ni se presentan métricas desconocidas como cero. Los fallos parciales se notifican y las demás fuentes continúan disponibles. Si todas fallan, se devuelve un error en lugar de un catálogo vacío confirmado. El alcance de Forti corresponde al VDOM configurado o solicitado; no se presume acceso a otros VDOMs.

Mixcoatl fue verificado en el perfil `__SSID-Mixcoatl` y en una muestra de terminales conectadas de OmniVista. No apareció en las interfaces ni pools del VDOM `root` consultado. El catálogo de VLANs de OmniVista 2500 4.8R2 usa `GET /api/vlanservice/vlans/view`: la integración lee `response.data`, exige una respuesta final satisfactoria y normaliza `number`/`description` a `vlanId`/`vlanName`. Se verificaron 33 VLANs en el proveedor instalado. La antigua ruta `/api/vlan` redirigía a una página 404 y provocaba un falso diagnóstico genérico de falta de conectividad.

## CCTV

Inventarios no ejecuta cotejos periódicos (`INVENTARIOS_REFRESH_SECONDS=0`). La adquisición de Forti/Omni y la lectura del catálogo CCTV se ejecutan al usar sus respectivos botones de actualización. Las ediciones pendientes se conservan durante la consulta.

Access Points, posiciones del mapa y catálogo documental (incluido CCTV) conservan su última lectura confirmada en `sessionStorage`, separada por usuario y permisos. La primera apertura consulta los datos; volver a la sección, cambiar sus pestañas o recargar el navegador reutiliza esa lectura. Los botones de actualización consultan de nuevo la API. Las correcciones y ubicaciones guardadas actualizan también la caché. Cerrar sesión o detectar una sesión expirada borra estos datos; las consultas pendientes compartidas no se duplican al navegar.

El runner raíz ejecuta el aprovisionamiento de Inventarios en cada inicio. Este conserva las claves existentes, actualiza las credenciales de proveedores y sincroniza la conexión guardada del Dashboard únicamente cuando corresponde al servicio local administrado. No reemplaza conexiones remotas personalizadas. Los cambios de configuración de los servicios requieren reiniciarlos; crear una red nueva en los proveedores no requiere declarar su nombre en SGRS.

## Verificación

La cobertura incluye nombres nuevos en redes, interfaces sin DHCP, conservación de métricas, fallos parciales, ausencia de métricas inventadas, interfaces manuales de actualización y sincronización limitada a la conexión local administrada.
