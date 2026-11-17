#!/usr/bin/env python3
"""Resolve a pinned official image; validate the extracted web game before packaging."""
import argparse
import json
import re
import urllib.request
from pathlib import Path


def resolve():
    req = urllib.request.Request('https://hub.docker.com/v2/repositories/gaozih/pvzge/tags/latest',
                                 headers={'User-Agent': 'Gardendless-Android'})
    with urllib.request.urlopen(req, timeout=30) as response:
        tag = json.load(response)
    images = [i for i in tag['images'] if i.get('architecture') == 'amd64' and i.get('os') == 'linux']
    if len(images) != 1 or not re.fullmatch(r'sha256:[0-9a-f]{64}', images[0]['digest']):
        raise ValueError('Expected one pinned Linux amd64 game image')
    return {'image': 'gaozih/pvzge@' + images[0]['digest'], 'digest': images[0]['digest']}


def validate(root):
    root = Path(root)
    for name in ('index.html', 'application.js', 'src/settings.json'):
        if not (root / name).is_file() or (root / name).stat().st_size == 0:
            raise ValueError('Game bundle missing ' + name)
    if not (root / 'assets').is_dir() or not any((root / 'assets').iterdir()):
        raise ValueError('Game assets missing')
    html = (root / 'index.html').read_text(encoding='utf-8')
    version = re.search(r'PvZ2 Gardendless[^<]*?\|\s*(\d+\.\d+\.\d+)(?:\s|<|$)', html)
    if not version:
        raise ValueError('Cannot identify bundled game version; refusing to publish')
    bootstrap = (root / 'application.js').read_text(encoding='utf-8')
    if not re.search(r'\bcc\s*=\s*engine\s*;', bootstrap):
        raise ValueError('Game engine bootstrap changed; manual compatibility review required')
    return version[1]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--validate')
    args = parser.parse_args()
    print(validate(args.validate) if args.validate else json.dumps(resolve()))
