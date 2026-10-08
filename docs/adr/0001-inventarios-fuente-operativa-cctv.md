# Inventarios como fuente operativa de CCTV

**Estado: aceptado.** Inventarios será la fuente operativa única para activos CCTV, correcciones, historial de cotejos y procedencia. Los archivos de `Documentos/redes` conservarán el papel de evidencia documental; el Dashboard consumirá Inventarios y no mantendrá una segunda escritura de CCTV. Esta separación evita divergencias entre catálogos, permite importar revisiones con rollback y concentra autenticación, auditoría y reglas de identidad en un módulo profundo.
