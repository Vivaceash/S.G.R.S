from typing import Any, Optional
from fastapi import status


class OmniVistaBaseException(Exception):
    """Excepción base para errores relacionados con Alcatel-Lucent OmniVista 2500."""
    def __init__(self, message: str, status_code: int = 500, details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class OmniVistaConnectionError(OmniVistaBaseException):
    """Error al intentar conectar o alcanzar el host del OmniVista NMS."""
    def __init__(self, message: str = "No se pudo establecer conexión con el servidor Alcatel OmniVista 2500.", details: Optional[Any] = None):
        super().__init__(message=message, status_code=status.HTTP_503_SERVICE_UNAVAILABLE, details=details)


class OmniVistaAuthError(OmniVistaBaseException):
    """Error de autenticación, token inválido o permisos insuficientes en OmniVista."""
    def __init__(self, message: str = "Error de autenticación con OmniVista: API Key o credenciales no válidas.", details: Optional[Any] = None):
        super().__init__(message=message, status_code=status.HTTP_502_BAD_GATEWAY, details=details)


class OmniVistaNotFoundError(OmniVistaBaseException):
    """Objeto o recurso no encontrado en OmniVista 2500."""
    def __init__(self, message: str = "Recurso no encontrado en OmniVista 2500.", details: Optional[Any] = None):
        super().__init__(message=message, status_code=status.HTTP_404_NOT_FOUND, details=details)


class OmniVistaResponseError(OmniVistaBaseException):
    """Error devuelto en el cuerpo de respuesta de OmniVista o código HTTP inesperado."""
    def __init__(self, message: str, status_code: int = status.HTTP_502_BAD_GATEWAY, details: Optional[Any] = None):
        super().__init__(message=message, status_code=status_code, details=details)
