"""Install pinned official barcode renderers with minimal native bootstrap dependencies."""
from pathlib import Path
import shutil
from dolibarr_compatibility import FILES, ROOT


def install_barcodes(webroot: Path, version='24.0.2'):
    source = ROOT / 'artifacts/dolibarr-compatibility' / version
    files = [name for name in FILES if 'barcode' in name]
    for name in files:
        path = source / name
        if not path.is_file():
            raise RuntimeError('Prepare pinned barcode sources first: python tests/dolibarr_compatibility.py --download --php /path/to/php')
        target = webroot / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    # Only the native engine's rendering/mapping is exercised. Its parent also declares
    # numbering models; these unrelated bootstrap dependencies are deliberate fixture doubles.
    for name, text in {
        'core/lib/functions.lib.php': "<?php if (!defined('DOL_DEFAULT_TTF_BOLD')) define('DOL_DEFAULT_TTF_BOLD', 'fixture-font.ttf'); function getDolGlobalString($name, $default='') { return $default; }",
        'core/class/commonnumrefgenerator.class.php': '<?php abstract class CommonNumRefGenerator {}',
    }.items():
        target = webroot / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')
