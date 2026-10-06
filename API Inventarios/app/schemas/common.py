from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar('T')


class Response(BaseModel, Generic[T]):
    success: bool = True
    message: str = 'Operación completada.'
    data: T


class ErrorResponse(BaseModel):
    success: bool = False
    message: str
    error: str
    request_id: str | None = None
