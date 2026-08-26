from typing import Any, Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

DataT = TypeVar("DataT")


class BaseResponse(BaseModel, Generic[DataT]):
    """Envoltorio estándar para respuestas exitosas de la API."""
    success: bool = Field(default=True, description="Indica si la operación fue exitosa")
    message: str = Field(default="Operación completada exitosamente", description="Mensaje descriptivo")
    data: Optional[DataT] = Field(default=None, description="Cuerpo de datos de la respuesta")
    vdom: Optional[str] = Field(default=None, description="VDOM consultado")


class ErrorResponse(BaseModel):
    """Envoltorio estándar para respuestas de error de la API."""
    success: bool = Field(default=False, description="Siempre false en errores")
    error: str = Field(..., description="Tipo o código de error")
    message: str = Field(..., description="Descripción amigable del error")
    details: Optional[Any] = Field(default=None, description="Detalles adicionales del error")


class PaginationMeta(BaseModel):
    """Metadatos de paginación."""
    total: int = Field(..., description="Total de registros encontrados")
    limit: int = Field(..., description="Límite solicitado por página")
    offset: int = Field(..., description="Desplazamiento / inicio")
