from dataclasses import dataclass
import time
import httpx
from src.config.settings import Settings
from .hash_utils import sha256_bytes

@dataclass(frozen=True)
class DownloadedFile:
    url: str
    content: bytes
    content_type: str | None
    etag: str | None
    last_modified: str | None
    sha256_hex: str

class NotModified(RuntimeError):
    """The server accepted a conditional request; caller must reuse and re-hash cached bytes."""

class Downloader:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    def download(self, url: str, *, etag: str | None = None, last_modified: str | None = None) -> DownloadedFile:
        headers = {"User-Agent": self.settings.http_user_agent}
        if etag: headers["If-None-Match"] = etag
        if last_modified: headers["If-Modified-Since"] = last_modified
        last_error = None
        with httpx.Client(timeout=self.settings.http_timeout_seconds, transport=self.transport, follow_redirects=True) as client:
            for attempt in range(self.settings.http_retry_count + 1):
                try:
                    response = client.get(url, headers=headers)
                    if response.status_code == 304:
                        raise NotModified("source not modified; reuse cached bytes and verify SHA-256")
                    response.raise_for_status()
                    content = response.content
                    if not content:
                        raise ValueError("empty source file rejected")
                    declared = response.headers.get("content-length")
                    if declared is not None and int(declared) != len(content):
                        raise ValueError("partial source file rejected: Content-Length mismatch")
                    content_type = response.headers.get("content-type")
                    if content_type and not any(x in content_type.lower() for x in ("text", "csv", "octet-stream")):
                        raise ValueError(f"unexpected Content-Type: {content_type}")
                    return DownloadedFile(url, content, content_type, response.headers.get("etag"), response.headers.get("last-modified"), sha256_bytes(content))
                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                    last_error = exc
                    if attempt >= self.settings.http_retry_count: break
                    time.sleep(self.settings.http_backoff_seconds * (2 ** attempt))
        raise RuntimeError(f"download failed after bounded retries: {type(last_error).__name__}") from last_error
