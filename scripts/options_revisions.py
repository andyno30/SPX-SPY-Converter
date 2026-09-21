"""Local provenance for upstream gamma revisions omitted by the public schema.

Only timestamps and a hash of the cached row are stored, never payloads/auth.
A manual or live cache edit invalidates the hash and the caller fails closed.
"""

import hashlib
import json
import os
import tempfile
from pathlib import Path


class OptionsPayload(dict):
    def __init__(self, values, gamma_updated_at=None):
        super().__init__(values)
        # An attribute, not a JSON key: keep the website payload schema unchanged.
        self.gamma_updated_at = gamma_updated_at


def row_digest(row):
    data = {key: row.get(key) for key in ("payload", "source_updated_at", "fetched_at")}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


class OptionsRevisions:
    def __init__(self, path):
        self.path = Path(path)
        try:
            self.records = json.loads(self.path.read_text())
            if not isinstance(self.records, dict):
                self.records = {}
        except (OSError, ValueError):
            self.records = {}

    def matching_gamma(self, row):
        if not row:
            return None
        record = self.records.get(row.get("ticker"))
        if not isinstance(record, dict) or record.get("row_digest") != row_digest(row):
            return None
        return record.get("gamma_updated_at")

    def cache_changed(self, row):
        if not row:
            return False
        record = self.records.get(row.get("ticker"))
        return isinstance(record, dict) and record.get("row_digest") != row_digest(row)

    def remember(self, row, incoming):
        # Only call after a successful conditional write and exact readback.
        self.records[row["ticker"]] = {
            "row_digest": row_digest(row),
            "gamma_updated_at": incoming.gamma_updated_at,
        }
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                os.fchmod(handle.fileno(), 0o600)
                json.dump(self.records, handle)
            temporary.replace(self.path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
