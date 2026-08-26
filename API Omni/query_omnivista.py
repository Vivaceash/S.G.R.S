import requests
import urllib3
import json
import os

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def load_config():
    config = {}
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                config[k.strip()] = v.strip().strip('"').strip("'")
    return config

def main():
    config = load_config()
    host = config.get("OV_HOST", "192.168.10.201")
    protocol = config.get("OV_PROTOCOL", "https")
    base_url = f"{protocol}://{host}"
    
    username = config.get("OV_USERNAME", "admin.red")
    password = config.get("OV_PASSWORD", "")
    api_key = config.get("OV_API_KEY", "")

    session = requests.Session()
    session.verify = False

    print("=" * 65)
    print(f" Conectando a Alcatel OmniVista 2500 en {base_url}")
    print("=" * 65)

    # 1. Login
    print(f"\n[1] Autenticando con usuario: {username} ...")
    r_login = session.post(
        f"{base_url}/api/login",
        json={"userName": username, "password": password},
        headers={"Content-Type": "application/json"},
        timeout=10
    )

    if r_login.status_code != 200:
        print(f"[-] Error en login: {r_login.status_code} - {r_login.text}")
        return

    data = r_login.json()
    token = data.get("accessToken")
    print(f"[+] Login Exitoso! Token obtenido: {token}")

    # Guardar headers para llamadas posteriores
    session.headers.update({
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    })

    # 2. Endpoints a explorar
    endpoints = [
        ("Swagger Spec", "/apidoc/swagger.json"),
        ("OpenAPI Endpoints", "/api/ca_openapi"),
        ("Dispositivos / Switches", "/api/devices"),
        ("Topología", "/api/topology/devices"),
        ("VLANs", "/api/vlan"),
        ("Alarmas / Traps", "/api/notifications"),
        ("Eventos", "/api/events"),
        ("Usuarios", "/api/users"),
        ("Versión del Sistema", "/api/system/version"),
        ("Config Backups", "/api/config/backups"),
        ("Inventario Hardware", "/api/inventory/chassis"),
        ("Puertos", "/api/ports"),
        ("SSIDs / Wireless", "/api/wlan/ssids"),
        ("APs Wireless", "/api/wlan/aps")
    ]

    print("\n[2] Consultando Endpoints del sistema:")
    print("-" * 65)
    for name, ep in endpoints:
        try:
            r = session.get(f"{base_url}{ep}", timeout=8)
            ct = r.headers.get("Content-Type", "")
            print(f" -> {name:25} | GET {ep:25} | HTTP {r.status_code}")
            if r.status_code == 200 and "json" in ct:
                js = r.json()
                if isinstance(js, list):
                    print(f"    [OK] Lista con {len(js)} registros")
                    if js:
                        print(f"    Muestra: {json.dumps(js[0], indent=2)[:300]}...")
                elif isinstance(js, dict):
                    keys = list(js.keys())
                    print(f"    [OK] Objeto devuelto. Claves principales: {keys[:8]}")
                    print(f"    Muestra: {json.dumps({k: js[k] for k in keys[:4]}, indent=2)[:300]}...")
        except Exception as e:
            print(f" -> {name:25} | Error: {e}")

    print("\n" + "=" * 65)

if __name__ == "__main__":
    main()
