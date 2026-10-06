from typing import Literal
from fastapi import APIRouter, Depends, Query, Response as HttpResponse
from app.core.security import require
from app.schemas.common import Response
from app.schemas.cctv import Camera, CameraPage, Catalog, Correction
from app.services import inventory

router = APIRouter(prefix='/cctv', tags=['CCTV'], dependencies=[Depends(require('read'))])


def filters(dataset: Literal['cctv', 'cctv_original'] = 'cctv', q: str = Query('', max_length=240),
            idf_id: str | None = None, model: str | None = None,
            decommissioned: bool | None = None, relocated: bool | None = None,
            status: Literal['online', 'offline', 'unknown'] | None = None,
            comparison: Literal['pending', 'matched', 'changed', 'ambiguous', 'not_observed', 'unavailable'] | None = None,
            vlan_id: int | None = Query(None, ge=0, le=4094),
            sort: Literal['name', 'number', 'location', 'idf_id', 'model', 'documented_ip'] = 'name', descending: bool = False):
    return locals()


@router.get('/catalog', response_model=Response[Catalog], summary='Catálogo CCTV completo para el dashboard')
def catalog():
    return {'data': inventory.snapshot()}


@router.get('/cameras', response_model=Response[CameraPage], summary='Consultar cámaras y observaciones de red')
def cameras(params=Depends(filters), limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    data = inventory.snapshot()
    rows = inventory.select(data, params)
    return {'data': {'items': rows[offset:offset+limit], 'total': len(rows), 'limit': limit, 'offset': offset, 'revision': data['revision']}}


@router.get('/summary', response_model=Response[dict], summary='Métricas del inventario filtrado')
def summary(params=Depends(filters)):
    return {'data': inventory.summary(inventory.select(inventory.snapshot(), params))}


@router.get('/export', response_class=HttpResponse, summary='Exportar consulta a CSV', responses={200: {'content': {'text/csv': {}}}})
def export(params=Depends(filters), principal=Depends(require('export'))):
    return HttpResponse(inventory.export_csv(inventory.select(inventory.snapshot(), params)), media_type='text/csv; charset=utf-8',
                        headers={'Content-Disposition': 'attachment; filename="cctv.csv"'})


@router.get('/cameras/{asset_id}', response_model=Response[Camera], summary='Ficha de cámara')
def detail(asset_id: str):
    return {'data': inventory.camera(asset_id)}


@router.patch('/cameras/{asset_id}', response_model=Response[Camera], summary='Corregir datos físicos o estado administrativo')
def correct(asset_id: str, body: Correction, principal=Depends(require('write'))):
    return {'data': inventory.correct(asset_id, body, principal)}


@router.get('/cameras/{asset_id}/observations', response_model=Response[dict], summary='Historial de observaciones de red')
def observations(asset_id: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    return {'data': inventory.history(asset_id, 'observations', limit, offset)}


@router.get('/cameras/{asset_id}/changes', response_model=Response[dict], summary='Auditoría de correcciones')
def changes(asset_id: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), principal=Depends(require('write'))):
    return {'data': inventory.history(asset_id, 'audit', limit, offset)}
