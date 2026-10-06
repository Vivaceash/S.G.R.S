from fastapi import APIRouter, Depends, Query

from app.core.security import require
from app.schemas.common import Response
from app.schemas.cctv import IntegrationCameraPage
from app.services import inventory


router = APIRouter(prefix='/cctv/integration', tags=['Integración CCTV'], dependencies=[Depends(require('integration'))])


@router.get('/cameras', response_model=Response[IntegrationCameraPage],
            summary='Consulta CCTV limitada para módulos externos')
def cameras(q: str = Query('', max_length=240), idf_id: str | None = Query(None, max_length=240),
            limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    data = inventory.snapshot()
    rows = inventory.integration_cameras(data, q, idf_id)
    return {'data': {'items': rows[offset:offset + limit], 'total': len(rows), 'limit': limit,
                     'offset': offset, 'revision': data['revision']}}
