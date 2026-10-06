import json
from fastapi import APIRouter, Depends, Request, Response as HttpResponse
from app.core.security import require
from app.repositories.database import database
from app.schemas.common import Response
from app.services import inventory, reconciliation

router = APIRouter(dependencies=[Depends(require('read'))])


@router.get('/catalogs/cabinets', tags=['Catálogos'], response_model=Response[list[dict]])
def cabinets():
    return {'data': inventory.snapshot()['cabinets']}


@router.get('/catalogs/networks', tags=['Catálogos'], response_model=Response[dict])
def networks():
    with database() as db:
        row = db.execute('SELECT result FROM jobs WHERE result IS NOT NULL ORDER BY rowid DESC LIMIT 1').fetchone()
    result = json.loads(row['result']) if row else {}
    return {'data': {'documented': inventory.snapshot()['structure'].get('networks', []),
                     'observed': result.get('networks', []), 'observed_at': result.get('observed_at'), 'sources': result.get('sources', [])}}


@router.get('/sources', tags=['Fuentes documentales'], response_model=Response[list[dict]])
def sources():
    return {'data': inventory.snapshot()['sources']}


@router.get('/sources/{digest}/download', tags=['Fuentes documentales'], response_class=HttpResponse)
def download(digest: str, principal=Depends(require('export'))):
    return HttpResponse(inventory.download(digest), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="inventario.xlsx"'})


@router.post('/reconciliation/jobs', tags=['Cotejo de red'], status_code=202, response_model=Response[dict])
async def start(request: Request):
    return {'data': request.app.state.reconciler.start()}


@router.get('/reconciliation/jobs/{job_id}', tags=['Cotejo de red'], response_model=Response[dict])
def job(job_id: str):
    return {'data': reconciliation.job(job_id)}


@router.get('/system/health', tags=['Salud'], response_model=Response[dict])
def health():
    with database() as db:
        imported = db.execute('SELECT COUNT(*) FROM catalog').fetchone()[0] == 1
        row = db.execute('SELECT status,finished_at,result FROM jobs ORDER BY rowid DESC LIMIT 1').fetchone()
    return {'data': {'storage_connected': True, 'catalog_imported': imported,
                     'last_reconciliation': {'status': row['status'], 'finished_at': row['finished_at']} if row else None,
                     'providers': json.loads(row['result']).get('sources', []) if row and row['result'] else []}}
