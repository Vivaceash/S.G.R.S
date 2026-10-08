from typing import Literal
from fastapi import APIRouter, Depends, Query, Response as HttpResponse
from app.core.security import require
from app.schemas.common import Response
from app.schemas.cctv import Camera, CameraPage, Catalog, Correction
from app.services import inventory

router = APIRouter(prefix='/cctv', tags=['CCTV'], dependencies=[Depends(require('read'))])


def filters(dataset: Literal['cctv', 'cctv_original'] = 'cctv', q: str = Query('', max_length=240, description='Busca por texto en identificadores, nombres, ubicación o modelo.'),
            idf_id: str | None = Query(None, description='Filtra por identificador del gabinete o IDF.'),
            model: str | None = Query(None, description='Filtra por modelo documentado.'),
            decommissioned: bool | None = Query(None, description='Filtra equipos dados de baja administrativamente.'),
            relocated: bool | None = Query(None, description='Filtra equipos marcados como reubicados.'),
            status: Literal['online', 'offline', 'unknown'] | None = Query(None, description='Estado observado en la última consulta de red.'),
            comparison: Literal['pending', 'matched', 'changed', 'ambiguous', 'not_observed', 'unavailable'] | None = Query(None, description='Resultado del cotejo documental contra red.'),
            vlan_id: int | None = Query(None, ge=0, le=4094, description='VLAN observada; rango válido de 0 a 4094.'),
            sort: Literal['name', 'number', 'location', 'idf_id', 'model', 'documented_ip'] = Query('name', description='Campo de ordenamiento.'),
            descending: bool = Query(False, description='Invierte el ordenamiento cuando es true.')):
    return locals()


@router.get('/catalog', response_model=Response[Catalog], summary='Catálogo CCTV completo para el dashboard',
            description='Devuelve el catálogo normalizado, observaciones documentales, fuentes, estructura y revisión vigente. Es la lectura recomendada para inicializar el dashboard.')
def catalog():
    return {'data': inventory.snapshot()}


@router.get('/cameras', response_model=Response[CameraPage], summary='Consultar cámaras y observaciones de red',
            description='Consulta cámaras con filtros documentales y de red. La respuesta incluye paginación, total de resultados y la revisión del catálogo utilizada.')
def cameras(params=Depends(filters), limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    data = inventory.snapshot()
    rows = inventory.select(data, params)
    return {'data': {'items': rows[offset:offset+limit], 'total': len(rows), 'limit': limit, 'offset': offset, 'revision': data['revision']}}


@router.get('/summary', response_model=Response[dict], summary='Métricas del inventario filtrado',
            description='Calcula totales y métricas sobre el mismo conjunto filtrado que /cameras, sin devolver el detalle completo de cada equipo.')
def summary(params=Depends(filters)):
    return {'data': inventory.summary(inventory.select(inventory.snapshot(), params))}


@router.get('/export', response_class=HttpResponse, summary='Exportar consulta a CSV',
            description='Exporta a CSV el resultado filtrado. Requiere permiso de exportación y protege valores que podrían interpretarse como fórmulas de hoja de cálculo.',
            responses={200: {'content': {'text/csv': {}}}})
def export(params=Depends(filters), principal=Depends(require('export'))):
    return HttpResponse(inventory.export_csv(inventory.select(inventory.snapshot(), params)), media_type='text/csv; charset=utf-8',
                        headers={'Content-Disposition': 'attachment; filename="cctv.csv"'})


@router.get('/cameras/{asset_id}', response_model=Response[Camera], summary='Ficha de cámara',
            description='Devuelve el estado documental, correcciones vigentes y última observación de red de un activo identificado por asset_id.')
def detail(asset_id: str):
    return {'data': inventory.camera(asset_id)}


@router.patch('/cameras/{asset_id}', response_model=Response[Camera], summary='Corregir datos físicos o estado administrativo',
              description='Aplica una corrección optimista y auditable. El campo version debe coincidir con la versión vigente; la baja administrativa no apaga ni elimina el equipo.')
def correct(asset_id: str, body: Correction, principal=Depends(require('write'))):
    return {'data': inventory.correct(asset_id, body, principal)}


@router.get('/cameras/{asset_id}/observations', response_model=Response[dict], summary='Historial de observaciones de red',
            description='Lista las observaciones históricas recibidas desde Forti/Omni para un activo, con paginación y fecha de captura.')
def observations(asset_id: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    return {'data': inventory.history(asset_id, 'observations', limit, offset)}


@router.get('/cameras/{asset_id}/changes', response_model=Response[dict], summary='Auditoría de correcciones',
            description='Lista las correcciones aplicadas al activo. Requiere permiso de escritura y devuelve actor, versión y cambios antes/después.')
def changes(asset_id: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), principal=Depends(require('write'))):
    return {'data': inventory.history(asset_id, 'audit', limit, offset)}
