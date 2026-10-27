from pathlib import Path
import uuid
from sqlalchemy import create_engine,func,select
from sqlalchemy.orm import Session
from src.config.settings import Settings
from src.db.models import Base,DatasetVintage,HoldingEntity,IngestionRun,Table5Crosscheck,TreasuryHoldingFact
from src.ingestion.pipeline import IngestionPipeline
from src.validation.shadow import validate_shadow

def test_local_snapshot_pipeline_and_idempotent_retry(tmp_path):
    root=Path(__file__).resolve().parents[2]
    engine=create_engine(f"sqlite+pysqlite:///{tmp_path/'tic.db'}")
    Base.metadata.create_all(engine)
    settings=Settings(database_url=str(engine.url),raw_storage_dir=tmp_path/"raw")
    with Session(engine,expire_on_commit=False) as db:
        first=IngestionPipeline(db,settings).ingest(from_directory=root/"data"/"raw",entity_seed=root/"dashboard"/"public"/"data"/"tic.json")
        vintage=db.get(DatasetVintage,uuid.UUID(first["vintage_id"]))
        expected_fact_rows=first["table3_rows"]+first["historical_adopted_rows"]
        assert db.scalar(select(func.count()).select_from(TreasuryHoldingFact))==expected_fact_rows
        assert db.scalar(select(func.count()).select_from(HoldingEntity))==132
        assert db.scalar(select(func.count()).select_from(Table5Crosscheck).where(Table5Crosscheck.is_pass.is_(False)))==0
        assert db.scalar(select(func.count()).select_from(Table5Crosscheck))==286
        assert vintage.is_active and vintage.validation_status=="PASS"
        assert validate_shadow(db,vintage.vintage_id,root/"dashboard"/"public"/"data"/"tic.json")["status"]=="PASS"
        second=IngestionPipeline(db,settings).ingest(from_directory=root/"data"/"raw",entity_seed=root/"dashboard"/"public"/"data"/"tic.json")
        assert second["reused"] is True
        assert db.scalar(select(func.count()).select_from(TreasuryHoldingFact))==expected_fact_rows
        assert db.scalar(select(func.count()).select_from(DatasetVintage))==1
        assert db.scalar(select(func.count()).select_from(IngestionRun))==2
