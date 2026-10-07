import httpx, pytest
from src.config.settings import Settings
from src.ingestion.downloader import Downloader,NotModified

def test_empty_and_partial_are_rejected():
    for response in (httpx.Response(200,content=b""),httpx.Response(200,content=b"x",headers={"content-length":"2"})):
        d=Downloader(Settings(http_retry_count=0),httpx.MockTransport(lambda request,r=response:r))
        with pytest.raises(ValueError): d.download("https://example.test/file")

def test_timeout_retries_are_bounded():
    calls=0
    def handler(request):
        nonlocal calls;calls+=1;raise httpx.ReadTimeout("timeout",request=request)
    d=Downloader(Settings(http_retry_count=2,http_backoff_seconds=0),httpx.MockTransport(handler))
    with pytest.raises(RuntimeError): d.download("https://example.test/file")
    assert calls==3

def test_conditional_not_modified_is_explicit():
    d=Downloader(Settings(http_retry_count=0),httpx.MockTransport(lambda request:httpx.Response(304,request=request)))
    with pytest.raises(NotModified): d.download("https://example.test/file",etag='"abc"')
