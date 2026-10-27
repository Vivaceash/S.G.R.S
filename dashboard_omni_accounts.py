"""Match Company Property to explicit employee identities without fuzzy prefixes."""
import re


def employee_index(employees):
    index = {}
    for employee in employees:
        for field in ('username', 'email'):
            key = str(employee.get(field) or '').strip().casefold()
            if key:
                existing = index.get(key)
                if key not in index or (existing and existing.get('username') == employee.get('username')):
                    index[key] = employee
                else:
                    index[key] = None  # Ambiguous aliases must never select a person.
    return index


def account_details(device, index):
    employee = None
    for field in ('employeeAccount', 'account'):
        key = str(device.get(field) or '').strip().casefold()
        if key:
            employee = index.get(key)
            # An explicit but unresolved account must not fall back to another person.
            break
    else:
        name = str(device.get('deviceName') or '').strip().casefold()
        employee = index.get(name)
        if name not in index:
            base = re.sub(r'\s*[-_/]\s*(?:cel|lap)\s*$', '', name)
            employee = index.get(base) if base != name else None
    if not employee:
        return {}
    fields = {'account': 'username', 'full_name': 'fullName', 'department': 'department',
              'position': 'position', 'description': 'description', 'email': 'email',
              'telephone': 'telephone', 'account_effective_at': 'dateOfEffective',
              'account_profile': 'accessRoleProfile', 'account_status': 'status'}
    return {target: employee.get(source) for target, source in fields.items()}
