import pytest

from dashboard_routes import has_meztli_submodule_access


@pytest.mark.parametrize(
    ("allowed_pages", "derechohabientes", "supervision"),
    [
        ([], False, False),
        (["disponibilidad"], False, False),
        (["gestion-meztli"], True, True),
        (["gestion-meztli", "gestion-meztli:derechohabientes"], True, False),
        (["gestion-meztli", "gestion-meztli:supervision"], False, True),
        (["gestion-meztli:derechohabientes"], True, False),
        (["gestion-meztli:supervision"], False, True),
    ],
)
def test_meztli_permissions_require_the_explicit_module_or_submodule(
    allowed_pages, derechohabientes, supervision
):
    assert has_meztli_submodule_access(allowed_pages, "derechohabientes") is derechohabientes
    assert has_meztli_submodule_access(allowed_pages, "supervision") is supervision
