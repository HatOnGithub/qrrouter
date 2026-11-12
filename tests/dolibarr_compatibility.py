"""Check the native APIs used by QR Router against pinned official Dolibarr sources.

This checks source contracts, not a running Dolibarr database. Use --download to
populate the ignored source cache, or --source-dir for an existing htdocs checkout.
"""
import argparse
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ['21.0.2', '22.0.5', '23.0.4', '24.0.2']
FILES = [
    'product/class/product.class.php',
    'product/stock/class/productlot.class.php',
    'product/stock/class/entrepot.class.php',
    'core/lib/security.lib.php',
    'core/lib/admin.lib.php',
    'core/modules/DolibarrModules.class.php',
    'user/class/user.class.php',
    'core/modules/modStock.class.php',
    'commande/class/commande.class.php',
]
TABLES = {
    'product_batch': ['fk_product_stock', 'qty', 'batch', 'eatby', 'sellby'],
    'product_stock': ['fk_product', 'fk_entrepot', 'reel'],
    'product_lot': ['rowid', 'entity', 'fk_product', 'batch'],
    'stock_mouvement': ['fk_product', 'fk_entrepot', 'value', 'batch', 'inventorycode'],
    'entrepot': ['rowid', 'entity', 'ref', 'lieu', 'statut'],
    'user': ['rowid', 'entity', 'login', 'firstname', 'lastname', 'statut', 'fk_soc'],
    'commande': ['rowid', 'entity', 'ref', 'fk_soc'],
    'mrp_mo': ['rowid', 'entity', 'ref'],
    'expedition': ['rowid', 'entity', 'ref', 'fk_soc'],
}
TABLE_FILES = {
    table: f'install/mysql/tables/llx_{table}{"-mrp" if table == "mrp_mo" else ""}.sql'
    for table in TABLES
}
FILES += list(TABLE_FILES.values())


def download(version):
    target = ROOT / 'artifacts/dolibarr-compatibility' / version

    def fetch(name):
        path = target / name
        if not path.is_file():
            url = f'https://raw.githubusercontent.com/Dolibarr/dolibarr/{version}/htdocs/{name}'
            with urlopen(url, timeout=60) as response:
                content = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch, FILES))
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', action='append', choices=VERSIONS)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--php', default='php')
    parser.add_argument('--source-dir', type=Path, help='Existing official htdocs tree (one --version required).')
    args = parser.parse_args()
    if args.source_dir and (not args.version or len(args.version) != 1 or args.download):
        parser.error('--source-dir requires exactly one --version and cannot use --download')
    for version in args.version or VERSIONS:
        source = args.source_dir or (download(version) if args.download else ROOT / 'artifacts/dolibarr-compatibility' / version)
        if not all((source / name).is_file() for name in FILES):
            raise SystemExit(f'Missing {version} sources; run with --download.')
        for table, columns in TABLES.items():
            sql = (source / TABLE_FILES[table]).read_text(encoding='utf-8')
            for column in columns:
                if not re.search(r'^\s*' + re.escape(column) + r'\s+\w+', sql, re.MULTILINE):
                    raise SystemExit(f'{version}: native column missing: {table}.{column}')
        with tempfile.TemporaryDirectory(prefix='qrr-compat-') as fixture:
            subprocess.run([
                args.php, str(ROOT / 'tests/test_dolibarr_compatibility.php'),
                str(source.resolve()), version, fixture,
            ], check=True)
        print(f'{version}: {sum(map(len, TABLES.values()))} native SQL columns checked.', flush=True)
