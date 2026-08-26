from typing import Generic, TypeVar, Optional, Any, List
from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: bool = Field(True, description="Indica si la operación fue exitosa")
    message: str = Field("Operación realizada con éxito", description="Mensaje informativo")
    data: Optional[T] = Field(None, description="Datos devueltos por la operación")
    error: Optional[str] = Field(None, description="Detalle del error en caso de fallo")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T] = Field(default_factory=list, description="Lista de elementos")
    total: int = Field(0, description="Total de elementos disponibles")
    page: int = Field(1, description="Número de página actual")
    page_size: int = Field(50, description="Tamaño de página")
    has_more: bool = Field(False, description="Indica si existen más páginas disponibles")
