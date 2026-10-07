import hashlib
import json

def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest().upper()

def row_sha256(payload: dict) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(canonical)

