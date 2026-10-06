"""Importa una extracción documental revisada; por defecto solo informa diferencias."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.import_service import migrate

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalog', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--replace', action='store_true')
    args = parser.parse_args()
    print(json.dumps(migrate(args.catalog, apply=args.apply, replace=args.replace), ensure_ascii=False))
