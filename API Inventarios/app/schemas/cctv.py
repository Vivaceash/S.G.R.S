from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool


class CorrectionFields(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str | None = Field(None, min_length=1, max_length=240)
    idf_id: str | None = Field(None, max_length=240)
    location: str | None = Field(None, max_length=240)
    rack: str | None = Field(None, max_length=240)
    ports: str | None = Field(None, max_length=240)
    notes: str | None = Field(None, max_length=1000)
    decommissioned: StrictBool | None = None
    relocated: StrictBool | None = None
    destination: str | None = Field(None, max_length=240)


class Correction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: str = Field(min_length=1, max_length=100)
    fields: CorrectionFields


class Camera(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: str
    dataset: Literal['cctv', 'cctv_original']
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
    items: list[Camera]
    total: int
    limit: int
    offset: int
    revision: str


class Catalog(BaseModel):
    assets: list[Camera]
    cabinets: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    structure: dict[str, Any]
    revision: str
