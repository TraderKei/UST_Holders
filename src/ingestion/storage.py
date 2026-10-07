from pathlib import Path
from typing import Protocol

class RawStorage(Protocol):
    def put(self, key: str, content: bytes) -> str: ...
    def get(self, uri: str) -> bytes: ...

class LocalRawStorage:
    def __init__(self, root: Path): self.root = root.resolve()
    def put(self, key: str, content: bytes) -> str:
        target = (self.root / key).resolve()
        if self.root not in target.parents:
            raise ValueError("storage key escapes configured root")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(content)
        return target.as_uri()
    def get(self, uri: str) -> bytes:
        from urllib.parse import unquote,urlparse
        parsed=urlparse(uri);path=unquote(parsed.path)
        if len(path)>2 and path[0]=="/" and path[2]==":": path=path[1:]
        return Path(path).read_bytes()

class S3RawStorage:
    def __init__(self, bucket: str, prefix: str = "tic/raw", endpoint_url: str | None = None):
        import boto3
        self.bucket, self.prefix = bucket, prefix.strip("/")
        self.client = boto3.client("s3", endpoint_url=endpoint_url)
    def put(self, key: str, content: bytes) -> str:
        object_key = f"{self.prefix}/{key}"
        self.client.put_object(Bucket=self.bucket, Key=object_key, Body=content)
        return f"s3://{self.bucket}/{object_key}"
    def get(self, uri: str) -> bytes:
        from urllib.parse import urlparse
        parsed=urlparse(uri)
        return self.client.get_object(Bucket=parsed.netloc,Key=parsed.path.lstrip("/"))["Body"].read()
