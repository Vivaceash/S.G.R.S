import json
from fastapi import APIRouter, Depends, Request, Response as HttpResponse
from app.core.security import require
from app.repositories.database import database
from app.schemas.common import Response
from app.services import inventory, reconciliation

router = APIRouter(dependencies=[Depends(require('read'))])
health_router = APIRouter()


@router.get('/catalogs/cabinets', tags=['Catálogos'], response_model=Response[list[dict]], summary='Listar gabinetes e IDF',
            description='Devuelve los gabinetes o IDF documentados en la fuente de inventario.')
def cabinets():
    return {'data': inventory.snapshot()['cabinets']}


@router.get('/catalogs/networks', tags=['Catálogos'], response_model=Response[dict], summary='Consultar redes documentadas y observadas',
            description='Combina redes documentadas con la última observación disponible del cotejo y sus fuentes.')
def networks():
    with database() as db:
        row = db.execute('SELECT result FROM jobs WHERE result IS NOT NULL ORDER BY rowid DESC LIMIT 1').fetchone()
    result = json.loads(row['result']) if row else {}
    return {'data': {'documented': inventory.snapshot()['structure'].get('networks', []),
                     'observed': result.get('networks', []), 'observed_at': result.get('observed_at'), 'sources': result.get('sources', [])}}


@router.get('/sources', tags=['Fuentes documentales'], response_model=Response[list[dict]], summary='Listar fuentes documentales',
            description='Devuelve metadatos de los archivos importados, incluyendo digest, nombre, tamaño y fecha de incorporación.')
def sources():
    return {'data': inventory.snapshot()['sources']}


@router.get('/sources/{digest}/download', tags=['Fuentes documentales'], response_class=HttpResponse, summary='Descargar fuente documental',
            description='Descarga el archivo original asociado a un digest. Requiere permiso de exportación y evita exponer rutas internas del servidor.')
def download(digest: str, principal=Depends(require('export'))):
    return HttpResponse(inventory.download(digest), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="inventario.xlsx"'})


@router.post('/reconciliation/jobs', tags=['Cotejo de red'], status_code=202, response_model=Response[dict], summary='Iniciar cotejo de red',
             description='Encola una consulta contra Forti/Omni para comparar observaciones de red con el inventario documental. Devuelve el identificador del trabajo.')
async def start(request: Request, principal=Depends(require('write'))):
    return {'data': request.app.state.reconciler.start()}


@router.get('/reconciliation/jobs/{job_id}', tags=['Cotejo de red'], response_model=Response[dict], summary='Consultar trabajo de cotejo',
            description='Devuelve estado, progreso, resultado y fuentes del trabajo de cotejo identificado por job_id.')
def job(job_id: str):
    return {'data': reconciliation.job(job_id)}


@health_router.get('/system/health', tags=['Salud'], response_model=Response[dict], summary='Diagnóstico interno del servicio',
            description='Comprueba almacenamiento, importación del catálogo y último cotejo sin autenticación.')
def health():
    with database() as db:
        imported = db.execute('SELECT COUNT(*) FROM catalog').fetchone()[0] == 1
        row = db.execute('SELECT status,finished_at,result FROM jobs ORDER BY rowid DESC LIMIT 1').fetchone()
    return {'data': {'storage_connected': True, 'catalog_imported': imported,
                     'last_reconciliation': {'status': row['status'], 'finished_at': row['finished_at']} if row else None,
                     'providers': json.loads(row['result']).get('sources', []) if row and row['result'] else []}}
