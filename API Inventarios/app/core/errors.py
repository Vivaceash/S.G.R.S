class InventoryError(Exception):
    def __init__(self, status, message, code='inventory_error'):
        self.status, self.message, self.code = status, message, code
        super().__init__(message)
