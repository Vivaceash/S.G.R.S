"""Server-owned read-only navigation. Only returned to authorized technical accounts."""


def resource(id, title, path, collection=None, columns=(), note="Consulta actual; no representa un histórico."):
    return dict(id=id, title=title, path=path, collection=collection,
                columns=[dict(key=key, label=label) for key, label in columns], note=note)


CATALOG = [
    dict(id="historico", title="Histórico de métricas", resources=[
        resource("history", "Métricas agregadas · 30 días", "/api/admin/history", "items", [("observed_at", "Fecha UTC"), ("dhcp_capacity", "Capacidad DHCP"), ("dhcp_leases", "Concesiones DHCP"), ("cpu_percent", "CPU (%)"), ("memory_percent", "Memoria (%)"), ("session_count", "Sesiones"), ("infrastructure_devices", "Equipos de infraestructura")], "Muestras cada 5 minutos mientras el servidor está activo. Retención de 30 días con eliminación automática. Sin datos personales ni logs de tráfico; los intervalos sin muestra no se interpolan."),
    ]),
    dict(id="redes", title="Redes e IPAM", resources=[
        resource("pools", "Capacidad DHCP", "/api/forti/network/dhcp-pools", "pools", [("interface", "Interfaz"), ("capacity", "Capacidad"), ("active_leases", "Concesiones"), ("available_ips", "Disponibles"), ("utilization_percent", "Uso (%)")], "Capacidad calculada por la API; verifica reservas y ámbitos antes de asignar direcciones."),
        resource("leases", "Concesiones DHCP", "/api/forti/network/dhcp-leases", columns=[("ip", "IP"), ("mac", "MAC"), ("hostname", "Equipo"), ("interface", "Interfaz"), ("status", "Estado")]),
        resource("arp", "Vecinos ARP", "/api/forti/network/arp-table", columns=[("ip", "IP"), ("mac", "MAC"), ("interface", "Interfaz"), ("state", "Estado")]),
        resource("interfaces", "Interfaces", "/api/forti/network/interfaces", columns=[("name", "Interfaz"), ("ip", "IP"), ("link_up", "Enlace activo"), ("speed", "Velocidad"), ("rx_errors", "Errores RX"), ("tx_errors", "Errores TX")]),
        resource("vlans", "VLANs", "/api/omni/catalogs/vlans", "vlans", [("vlanId", "VLAN"), ("vlanName", "Nombre"), ("vlanType", "Tipo"), ("description", "Descripción")]),
    ]),
    dict(id="infraestructura", title="Infraestructura", resources=[
        resource("infrastructure-stats", "Resumen de infraestructura", "/api/omni/monitoring/infrastructure-stats", note="Conteo de equipos recibidos. La clasificación AP/switch es una estimación por modelo; los totales de cuentas y MACs no confirmados se muestran como no informados."),
        resource("forti-devices", "Equipos detectados", "/api/forti/devices", "devices", [("hostname", "Equipo"), ("ip", "IP"), ("mac", "MAC"), ("interface", "Interfaz"), ("is_online", "Detectado en línea")], "Inventario detectado por FortiGate. No implica una asignación física a un IDF."),
        resource("omni-devices", "Switches y puntos de acceso", "/api/omni/monitoring/devices", columns=[("name", "Equipo"), ("ipAddress", "IP"), ("model", "Modelo"), ("status", "Estado"), ("location", "Ubicación")]),
        resource("online", "Terminales autenticadas", "/api/omni/monitoring/online-devices", columns=[("deviceIp", "IP"), ("deviceMac", "MAC"), ("userName", "Cuenta"), ("accessDeviceName", "Equipo de acceso"), ("accessDeviceSsid", "SSID")], note="Muestra de hasta 200 terminales de OmniVista; no equivale al total de la red."),
    ]),
    dict(id="directorio", title="Directorio de acceso", resources=[
        resource("employees", "Cuentas de red", "/api/omni/employees?page_size=500", "items", [("username", "Cuenta"), ("fullName", "Nombre"), ("department", "Departamento"), ("accessRoleProfile", "Perfil"), ("status", "Estado")], "Bloque de hasta 500 cuentas. La búsqueda y exportación se limitan al bloque recibido; no son cuentas locales del dashboard."),
        resource("properties", "Terminales registradas", "/api/omni/company-properties?page_size=500", "items", [("deviceMac", "MAC"), ("deviceName", "Equipo"), ("account", "Cuenta"), ("accessRoleProfile", "Perfil"), ("deviceOS", "Sistema")], "Bloque de hasta 500 terminales; no se presume que sea el inventario completo."),
        resource("profiles", "Perfiles de acceso", "/api/omni/catalogs/access-role-profiles", "profiles", [("value", "Perfil")]),
        resource("options", "Clasificaciones de terminales", "/api/omni/catalogs/device-options", note="Catálogo estático publicado por la API, no inventario observado."),
    ]),
    dict(id="trafico", title="Tráfico de red", resources=[
        resource("sessions", "Sesiones activas", "/api/forti/traffic/sessions?limit=1000", columns=[("src_ip", "Origen"), ("dst_ip", "Destino"), ("dst_port", "Puerto"), ("protocol_name", "Protocolo"), ("application", "Aplicación")], note="Muestra de hasta 1,000 sesiones actuales. No representa tráfico histórico ni totalidad garantizada."),
        resource("destinations", "Destinos frecuentes", "/api/forti/traffic/destinations?limit=100", columns=[("destination", "Destino"), ("session_count", "Sesiones"), ("total_bytes", "Bytes")], note="Hasta 100 destinos calculados sobre una muestra de 500 sesiones."),
        resource("logs", "Registros recientes", "/api/forti/traffic/logs?limit=200", columns=[("timestamp", "Fecha y hora"), ("src_ip", "Origen"), ("dst_ip", "Destino"), ("action", "Acción")], note="Hasta 200 registros recientes. Un resultado vacío no confirma que el almacenamiento de logs esté habilitado."),
    ]),
    dict(id="seguridad", title="Políticas de red", resources=[
        resource("policies", "Políticas del firewall", "/api/forti/firewall/policies", columns=[("policyid", "ID"), ("name", "Política"), ("action", "Acción"), ("status", "Estado")]),
        resource("addresses", "Objetos de dirección", "/api/forti/firewall/addresses", columns=[("name", "Nombre"), ("type", "Tipo"), ("subnet", "Subred"), ("fqdn", "Dominio")]),
        resource("groups", "Grupos de direcciones", "/api/forti/firewall/address-groups", columns=[("name", "Grupo"), ("members", "Miembros")]),
    ]),
    dict(id="vpn", title="Conectividad VPN", resources=[
        resource("ipsec", "Túneles IPsec", "/api/forti/vpn/ipsec", columns=[("name", "Túnel"), ("status", "Estado"), ("remote_gateway", "Extremo remoto")]),
        resource("ssl", "Sesiones SSL VPN", "/api/forti/vpn/ssl-sessions", columns=[("user_name", "Cuenta"), ("remote_host", "Origen"), ("ip", "IP del túnel")]),
    ]),
    dict(id="eventos", title="Topología y alarmas", resources=[
        resource("topology", "Topología", "/api/omni/monitoring/topology", note="Solo se muestran relaciones entregadas por el proveedor. No se infieren enlaces a partir del inventario."),
        resource("notifications", "Alarmas del NMS", "/api/omni/monitoring/notifications", note="Alarmas entregadas por OmniVista. No se confunden con incidencias de visitas IDF."),
    ]),
    dict(id="sistemas", title="Salud de sistemas", resources=[
        resource("status", "Sistema FortiGate", "/api/forti/system/status"),
        resource("resources", "Uso de recursos", "/api/forti/system/resources"),
        resource("firmware", "Firmware", "/api/forti/system/firmware"),
        resource("forti-health", "Conexión FortiGate", "/api/forti/health"),
        resource("omni-health", "Conexión OmniVista", "/api/omni/system/health"),
        resource("version", "Versión OmniVista", "/api/omni/system/version"),
    ]),
]
