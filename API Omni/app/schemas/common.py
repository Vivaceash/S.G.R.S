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
    total: Optional[int] = Field(None, description="Total confirmado por el proveedor; null si no está disponible")
    returned_count: int = Field(0, description="Registros incluidos en esta respuesta")
    complete: bool = Field(False, description="Indica si se verificó la integridad del inventario completo")
    page: int = Field(1, description="Número de página actual")
    page_size: int = Field(50, description="Tamaño de página")
    has_more: Optional[bool] = Field(None, description="Más registros observados; null si no puede confirmarse el fin")
