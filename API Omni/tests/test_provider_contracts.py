from unittest.mock import Mock
import pytest
from app.services.omnivista_service import OmniVistaService
from app.errors import OmniVistaResponseError
from app.routers.catalogs import get_vlans


@pytest.mark.parametrize("operation", ["get_vlans", "get_topology", "get_notifications", "get_system_version", "get_devices"])
@pytest.mark.parametrize("http", [200, 404, 500])
def test_unavailable_is_not_an_empty_collection(operation, http):
    service = OmniVistaService()
    response = Mock(status_code=http)
    response.json.side_effect = ValueError("HTML page")
    service.request = Mock(return_value=response)
    with pytest.raises(OmniVistaResponseError):
        getattr(service, operation)()


def test_vlan_response_matches_declared_catalog():
    service = Mock()
    service.get_vlans.return_value = [{"vlanId": 10, "vlanName": "Test"}]
    response = get_vlans(service)
    assert response.data.total == 1
    assert response.data.vlans[0]["vlanId"] == 10


@pytest.mark.parametrize("operation,field", [("get_employee_accounts", "username"), ("get_company_properties", "deviceMac")])
def test_second_page_fetches_sufficient_prefix_without_inventing_total(operation, field):
    service = OmniVistaService()
    response = Mock(status_code=200)
    response.json.return_value = {"data": [{field: str(index)} for index in range(11)]}
    service.request = Mock(return_value=response)
    result = getattr(service, operation)(page=2, page_size=5)
    assert service.request.call_args.kwargs["json"]["querySize"] == 11
    assert [row[field] for row in result["items"]] == [str(index) for index in range(5, 10)]
    assert result["total"] is None and result["complete"] is False
    assert result["has_more"] is True and result["returned_count"] == 5
