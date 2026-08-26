from omnivista_client import OmniVistaClient
import json

def main():
    print("=" * 70)
    print(" Alcatel-Lucent OmniVista 2500 - API Client Demo")
    print("=" * 70)

    # Inicializar cliente (lee credenciales automáticamente de .env)
    client = OmniVistaClient()
    
    print("\n[1] Iniciando sesión...")
    if not client.login():
        print("[-] Falló el inicio de sesión. Revisa tu archivo .env")
        return

    print(f"[+] Conectado exitosamente! Token: {client.access_token}")

    # Consultar resumen de dispositivos
    print("\n[2] Consultando inventario de dispositivos en la red...")
    devices = client.get_devices_summary()
    print(f"[+] Total de dispositivos descubiertos: {len(devices)}")

    # Mostrar tabla resumen de los primeros 15
    print("\n" + "-" * 75)
    print(f"{'#':<3} | {'IP':<16} | {'NOMBRE / HOSTNAME':<22} | {'MODELO':<14} | {'ESTADO':<8}")
    print("-" * 75)
    
    switches_count = 0
    aps_count = 0
    other_count = 0

    for i, dev in enumerate(devices):
        ip = dev.get("ip") or "N/A"
        name = (dev.get("name") or "N/A")[:20]
        model = (dev.get("model") or "N/A")[:13]
        status = dev.get("status") or "N/A"

        if "AP" in model or "AP" in name:
            aps_count += 1
        elif "AOS" in model or "OS" in model or "IDF" in name:
            switches_count += 1
        else:
            other_count += 1

        if i < 15:
            print(f"{i+1:<3} | {ip:<16} | {name:<22} | {model:<14} | {status:<8}")

    if len(devices) > 15:
        print(f"... y {len(devices) - 15} dispositivos más.")

    print("-" * 75)
    print(f"\nResumen de tipos en la red:")
    print(f"  - Puntos de Acceso WiFi (APs): {aps_count}")
    print(f"  - Switches / Equipos de Red:   {switches_count}")
    print(f"  - Otros dispositivos:          {other_count}")

    print("\n" + "=" * 70)
    print(" ¡La API está 100% operativa y lista para usar en tu proyecto!")
    print("=" * 70)

if __name__ == "__main__":
    main()
