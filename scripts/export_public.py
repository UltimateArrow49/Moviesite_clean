"""Export tracked frontend files without publishing backend or user data."""
import argparse
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = {'.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp',
              '.ico', '.woff', '.woff2', '.ttf', '.webmanifest'}
ASSET_DIRS = {'assets', 'icons', 'providers'}


def export(destination: Path) -> int:
    destination = destination.resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError('Choose a public directory outside the application checkout.')
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Choose a new or empty public directory; existing files are not overwritten.')
    paths = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    selected = []
    for name in filter(None, paths):
        relative = Path(name)
        if any(part.startswith('.') for part in relative.parts):
            continue
        if len(relative.parts) > 1 and relative.parts[0] not in ASSET_DIRS:
            continue
        if relative.suffix.lower() not in EXTENSIONS and name != 'catalog_fallback.json':
            continue
        source = ROOT / relative
        if source.is_symlink() or not source.is_file() or ROOT not in source.resolve().parents:
            raise ValueError('Refusing unsafe source: ' + name)
        selected.append((source, destination / relative))
    destination.mkdir(parents=True, exist_ok=True)
    for source, target in selected:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return len(selected)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    print('Exported', export(parser.parse_args().destination), 'frontend files.')
