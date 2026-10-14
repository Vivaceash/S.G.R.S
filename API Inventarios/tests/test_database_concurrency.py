from app.repositories.database import database
from app.services.inventory import snapshot


def test_catalog_read_does_not_wait_for_inventory_writer(store):
    # A reserved SQLite write lock still allows readers. Initializing the
    # schema on each read used to turn this into a competing write request.
    with database(write=True) as writer:
        writer.execute("UPDATE catalog SET revision=revision WHERE id=1")
        result = snapshot()
        assert {asset['id'] for asset in result['assets']} == {'cam-1', 'old-1'}


def test_existing_database_is_initialized_once(store):
    with database() as db:
        db.execute('PRAGMA user_version=0')
    with database() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM catalog').fetchone()[0] == 1
