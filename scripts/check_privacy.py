"""Check tracked files for common secrets and private runtime artifacts.

This is a preventative check, not a guarantee that arbitrary personal data
can be detected automatically. Findings never include matched secret values.
"""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'private key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'JWT credential': re.compile(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}'),
    'GitHub credential': re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})'),
    'literal access credential': re.compile(rb'''(?im)^\s*(?:(?:const|let|var)\s+)?(?:["']?)(?:TMDB_API_KEY|APP_KEY|ADMIN_SYNC_KEY|API_TOKEN|PASSWORD|SECRET_KEY)["']?\s*[:=]\s*["'][A-Za-z0-9_./+-]{20,}["']'''),
    'personal workstation path': re.compile(rb'(?i)[A-Z]:[\\/]Users[\\/][A-Za-z0-9_.-]+'),
}


def inspect_files():
    findings = []
    paths = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    for name in filter(None, paths):
        path = Path(name)
        lower = name.lower()
        if (any(part in {'venv', '.venv', '__pycache__', 'privacy-recovery'} for part in path.parts)
                or path.suffix.lower() in {'.pyc', '.db', '.sqlite', '.sqlite3', '.bundle', '.pem', '.key'}
                or (path.name.startswith('.env') and path.name != '.env.example')
                or '.bak' in lower or lower.endswith(('maintenance.md', '.sqlite3-wal', '.sqlite3-shm'))):
            findings.append((name, 'private/runtime file must not be tracked'))
        data = (ROOT / path).read_bytes()
        for label, pattern in PATTERNS.items():
            if pattern.search(data):
                findings.append((name, label))
    return findings


if __name__ == '__main__':
    findings = inspect_files()
    for name, label in findings:
        print(name + ': ' + label)
    print('Privacy check:', 'FAILED' if findings else 'passed')
    sys.exit(bool(findings))
