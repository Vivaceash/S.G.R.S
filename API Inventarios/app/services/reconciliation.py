import asyncio
from datetime import datetime, timezone, timedelta
import json
import uuid
from app.core.config import settings
from app.core.errors import InventoryError
from app.repositories.database import database
from app.services.inventory import snapshot, now
from app.services.network_enrichment import enrich


def job(job_id):
    with database() as db:
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
    if not row:
        raise InventoryError(404, 'Cotejo no encontrado.')
    value = dict(row)
    value['result'] = json.loads(value['result']) if value['result'] else None
    return value


class Reconciler:
    def __init__(self, providers):
        self.providers, self.tasks = providers, set()

    def recover(self):
        # Run one Uvicorn worker: persisted jobs survive restarts, not parallel owners.
        with database(write=True) as db:
            db.execute("UPDATE jobs SET status='failed',error='Servicio reiniciado durante el cotejo.',finished_at=? WHERE status IN ('queued','running')", (now(),))

    def start(self):
        catalog = snapshot()
        with database(write=True) as db:
            active = db.execute("SELECT id FROM jobs WHERE status IN ('queued','running')").fetchone()
            if active:
                return job(active['id'])
            identifier = str(uuid.uuid4())
            db.execute('INSERT INTO jobs(id,status,created_at,revision) VALUES(?,?,?,?)', (identifier, 'queued', now(), catalog['revision']))
        task = asyncio.create_task(self.run(identifier, catalog))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return job(identifier)

    async def run(self, identifier, catalog):
        try:
            with database(write=True) as db:
                db.execute("UPDATE jobs SET status='running' WHERE id=?", (identifier,))
            responses = await self.providers.collect()
            result = enrich(catalog['assets'], responses)
            timestamp = now()
            result.update(revision=catalog['revision'], observed_at=timestamp)
            with database(write=True) as db:
                db.execute('UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?',
                           ('partial' if result['partial'] else 'completed', json.dumps(result), timestamp, identifier))
                for asset_id, observation in result['assets'].items():
                    db.execute('INSERT INTO observations(asset_id,job_id,observed_at,payload) VALUES(?,?,?,?)', (asset_id, identifier, timestamp, json.dumps(observation)))
                cutoff = (datetime.now(timezone.utc) - timedelta(days=settings.RETENTION_DAYS)).isoformat()
                db.execute('DELETE FROM observations WHERE observed_at<?', (cutoff,))
                db.execute("DELETE FROM jobs WHERE finished_at<? AND id<>?", (cutoff, identifier))
        except asyncio.CancelledError:
            with database(write=True) as db:
                db.execute("UPDATE jobs SET status='failed',error='Cotejo interrumpido.',finished_at=? WHERE id=?", (now(), identifier))
            raise
        except Exception:
            with database(write=True) as db:
                db.execute("UPDATE jobs SET status='failed',error='No se pudo completar el cotejo.',finished_at=? WHERE id=?", (now(), identifier))

    async def periodic(self):
        while True:
            await asyncio.sleep(settings.REFRESH_SECONDS)
            try:
                self.start()
            except InventoryError:
                pass

    async def close(self):
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
