import logging
from pythonjsonlogger.json import JsonFormatter

SENSITIVE_KEYS = {"password", "database_url", "authorization", "api_key", "token"}

class ContextDefaults(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record,"run_id"): record.run_id=None
        return True

def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.addFilter(ContextDefaults())
    handler.setFormatter(JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s %(run_id)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
