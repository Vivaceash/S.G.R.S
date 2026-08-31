import asyncio
import httpx
from app.main import app

headers = {"X-API-Key": "admin"}
endpoints = [
    "/api/v1/health",
    "/api/v1/system/status",
    "/api/v1/system/resources",
    "/api/v1/system/firmware",
    "/api/v1/devices",
    "/api/v1/devices/d4:f0:c9:01:f5:eb",
    "/api/v1/network/dhcp-leases",
    "/api/v1/network/dhcp-pools",
    "/api/v1/network/arp-table",
    "/api/v1/network/interfaces",
    "/api/v1/traffic/sessions",
    "/api/v1/traffic/destinations",
    "/api/v1/traffic/logs",
    "/api/v1/firewall/policies",
    "/api/v1/firewall/addresses",
    "/api/v1/firewall/address-groups",
    "/api/v1/vpn/ipsec",
    "/api/v1/vpn/ssl-sessions",
]


async def run_tests():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        for ep in endpoints:
            r = await ac.get(ep, headers=headers)
            data = r.json()
            is_ok = r.status_code == 200 and data.get("success")
            status_tag = "[OK]" if is_ok else f"[FAIL {r.status_code}]"
            msg = data.get("message") or data.get("error") or ""
            
            detail = ""
            if is_ok and "data" in data:
                d = data["data"]
                if isinstance(d, list):
                    detail = f"({len(d)} elementos)"
                elif isinstance(d, dict):
                    if "total_devices" in d:
                        detail = f"({d.get('total_devices')} dispositivos, {d.get('online_devices')} online)"
                    elif "cpu_percent" in d:
                        detail = f"(CPU: {d.get('cpu_percent')}%, RAM: {d.get('memory_percent')}%, Sesiones: {d.get('session_count')})"
                    elif "hostname" in d:
                        detail = f"(Host: {d.get('hostname')}, Versión: {d.get('version')})"
                    elif "mac" in d:
                        detail = f"(MAC: {d.get('mac')}, IP: {d.get('ip')}, Hostname: {d.get('hostname')})"
                    else:
                        detail = f"({len(d)} campos)"

            print(f"{status_tag:<12} {ep:<35} {msg} {detail}")


if __name__ == "__main__":
    asyncio.run(run_tests())
