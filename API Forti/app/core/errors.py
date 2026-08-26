from typing import Any, Optional
from fastapi import HTTPException, status


class FortiOSBaseException(Exception):
    """Excepción base para errores relacionados con FortiOS."""
    def __init__(self, message: str, status_code: int = 500, details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class FortiOSConnectionError(FortiOSBaseException):
    """Error al intentar conectar o alcanzar el host del FortiGate."""
    def __init__(self, message: str = "No se pudo establecer conexión con el FortiGate.", details: Optional[Any] = None):
        super().__init__(message=message, status_code=status.HTTP_503_SERVICE_UNAVAILABLE, details=details)


class FortiOSAuthError(FortiOSBaseException):
    """Error de autenticación o token inválido en FortiOS."""
    def __init__(self, message: str = "Error de autenticación con FortiOS: Token inválido o permisos insuficientes.", details: Optional[Any] = None):
        super().__init__(message=message, status_code=status.HTTP_401_UNAUTHORIZED, details=details)


class FortiOSNotFoundError(FortiOSBaseException):
    """Objeto o recurso no encontrado en el FortiGate."""
    def __init__(self, message: str = "Recurso no encontrado en FortiOS.", details: Optional[Any] = None):
        super().__init__(message=message, status_code=status.HTTP_404_NOT_FOUND, details=details)


class FortiOSResponseError(FortiOSBaseException):
    """Error devuelto en el cuerpo de respuesta de FortiOS (código de retorno negativo u error HTTP)."""
    def __init__(self, message: str, status_code: int = status.HTTP_400_BAD_REQUEST, details: Optional[Any] = None):
        super().__init__(message=message, status_code=status_code, details=details)
