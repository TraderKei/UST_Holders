from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from src.config.settings import get_settings

def make_engine(database_url: str | None = None):
    return create_engine(database_url or get_settings().database_url, pool_pre_ping=True)

@contextmanager
def session_scope(database_url: str | None = None):
    factory = sessionmaker(make_engine(database_url), expire_on_commit=False)
    with factory() as session:
        try:
            yield session
            if session.in_transaction():
                session.commit()
        except Exception:
            session.rollback()
            raise
