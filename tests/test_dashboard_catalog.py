from urllib.parse import urlsplit
from dashboard_catalog import CATALOG
from dashboard_routes import reserved_read_allowed


def test_catalog_only_uses_explicit_read_routes_and_unique_identifiers():
    modules = set()
    resources = set()
    for module in CATALOG:
        assert module["id"] not in modules
        modules.add(module["id"])
        for item in module["resources"]:
            assert item["id"] not in resources
            resources.add(item["id"])
            path = urlsplit(item["path"]).path
            assert path in ("/api/forti/network/dhcp-pools", "/api/admin/history") or reserved_read_allowed(path)
            assert item["note"] and item["title"]
