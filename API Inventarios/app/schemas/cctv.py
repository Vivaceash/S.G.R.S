from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool


class CorrectionFields(BaseModel):
    """Campos permitidos para una corrección administrativa o física."""

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str | None = Field(None, min_length=1, max_length=240, description='Nombre operativo de la cámara.')
    idf_id: str | None = Field(None, max_length=240, description='IDF o gabinete físico asociado.')
    location: str | None = Field(None, max_length=240, description='Ubicación física documentada.')
    rack: str | None = Field(None, max_length=240, description='Rack o posición dentro del gabinete.')
    ports: str | None = Field(None, max_length=240, description='Puertos o canalización asociados.')
    notes: str | None = Field(None, max_length=1000, description='Nota administrativa o técnica.')
    decommissioned: StrictBool | None = Field(None, description='Marca baja administrativa sin apagar ni borrar el equipo.')
    relocated: StrictBool | None = Field(None, description='Marca que el equipo fue reubicado.')
    destination: str | None = Field(None, max_length=240, description='Destino documentado cuando relocated=true.')


class Correction(BaseModel):
    """Solicitud de corrección con control de concurrencia optimista."""

    model_config = ConfigDict(extra='forbid')
    version: str = Field(min_length=1, max_length=100, description='Versión devuelta por la consulta previa del activo.')
    fields: CorrectionFields = Field(description='Campos que se desean corregir; solo se aplican los enviados.')


class Camera(BaseModel):
    """Representación normalizada de una cámara y su estado observado."""

    model_config = ConfigDict(extra='allow')
    id: str
    dataset: Literal['cctv', 'cctv_original']
    number: str = Field('', description='Número de cámara tal como aparece en el documento; puede estar vacío si la fuente no lo informa.')
    name: str = ''
    model: str = ''
    serial: str = ''
    mac: str = ''
    documented_ip: str = ''
    idf_id: str = ''
    location: str = ''
    relocated: bool = False
    decommissioned: bool = False
    destination: str = ''
    issues: list[str] = []
    source: dict[str, Any] = {}
    documented: dict[str, Any]
    version: str
    corrected_at: str | None = None
    network: dict[str, Any] | None = None


class CameraPage(BaseModel):
    """Página de resultados de cámaras."""

    items: list[Camera]
    total: int
    limit: int
    offset: int
    revision: str


class Catalog(BaseModel):
    """Catálogo completo consumido por el dashboard."""

    assets: list[Camera]
    cabinets: list[dict[str, Any]]
    observations: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[dict[str, Any]]
    structure: dict[str, Any]
    revision: str


class Report(BaseModel):
    """Sanitized IDF visit or incident from the dashboard report log."""

    model_config = ConfigDict(extra='allow')
    idf_id: str
    id: str
    date: str
    severity: str
    device: str = ''
    temp: float | int | None = None
    title: str = ''
    description: str = ''
    status: str
    tech: str = ''
    resolved_at: str | None = None
    origin_key: str | None = None
    record_key: str


class ReportPage(BaseModel):
    """Bounded page of sanitized IDF reports."""

    items: list[Report]
    total: int
    limit: int
    offset: int
