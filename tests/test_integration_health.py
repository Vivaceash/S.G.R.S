import json
import pytest
from integration_health import upstream_healthy


@pytest.mark.parametrize("service,data", [
    ("forti", {"fortigate_connection": {"reachable": True}}),
    ("omni", {"omnivista_connected": True}),
])
def test_health_requires_equipment_confirmation(service, data):
    payload = json.dumps({"success": True, "data": data})
    assert upstream_healthy(service, 200, payload)
    assert not upstream_healthy(service, 502, payload)
    assert not upstream_healthy(service, 200, json.dumps({"success": False, "data": data}))


@pytest.mark.parametrize("payload", ["{}", "[]", "null", "<html>login</html>", '{"data": {}}', '{"data":{"omnivista_connected":false}}', '{"data":{"fortigate_connection":{"reachable":false}}}'])
def test_http_success_is_not_connection_success(payload):
    assert not upstream_healthy("forti", 200, payload)
    assert not upstream_healthy("omni", 200, payload)
