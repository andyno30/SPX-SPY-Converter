"""Verify existing tracked content against the pre-implementation SHA256 inventory.

Read-only with respect to existing files and Git. Writes B2B evidence only.
"""
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'scripts/b2b-api/evidence'
BASELINE = EVIDENCE / 'original-files-sha256.json'
before = json.loads(BASELINE.read_text())
production_base = '1201ef5'
approved_path = EVIDENCE / 'website-security-approved-files.json'
approved = json.loads(approved_path.read_text())['files'] if approved_path.exists() else {}
changed = []
authorized_security_changes = []
inherited_updates = []
for name, digest in before.items():
    file = ROOT / name
    production_bytes = subprocess.check_output(['git', 'show', f'{production_base}:{name}'], cwd=ROOT)
    production_digest = hashlib.sha256(production_bytes).hexdigest()
    if production_digest != digest:
        inherited_updates.append(name)
    if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != production_digest:
        actual = hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None
        if actual is not None and approved.get(name) == actual:
            authorized_security_changes.append(name)
        else:
            changed.append(name)
branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
report = {
    'verified_at': datetime.now(timezone.utc).isoformat(),
    'branch': branch,
    'baseline_commit': subprocess.check_output(['git', 'rev-parse', production_base], cwd=ROOT, text=True).strip(),
    'inherited_production_updates_since_original_review': inherited_updates,
    'original_tracked_files': len(before),
    'unchanged': len(before) - len(changed) - len(authorized_security_changes),
    'authorized_security_changes': authorized_security_changes,
    'unexpected_modified_or_missing': changed,
    'scope': 'Local file integrity; no production requests or hosted configuration assertions.',
}
EVIDENCE.mkdir(parents=True, exist_ok=True)
(EVIDENCE / 'preservation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
if changed or branch != 'codex/b2b-api-platform':
    raise SystemExit('Preservation or branch check failed')
