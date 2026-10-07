import uuid
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from src.db.models import Base, DatasetVintage, IngestionRun
from src.services.vintage_service import PromotionBlocked, promote_vintage

def test_failed_promotion_keeps_active_vintage():
    engine=create_engine("sqlite+pysqlite:///:memory:");Base.metadata.create_all(engine)
    with Session(engine) as db:
        old_run=IngestionRun();new_run=IngestionRun();db.add_all([old_run,new_run]);db.flush()
        old=DatasetVintage(ingestion_run_id=old_run.ingestion_run_id,vintage_label="old",latest_reference_month=__import__('datetime').date(2024,1,1),validation_status="PASS",is_active=True)
        new=DatasetVintage(ingestion_run_id=new_run.ingestion_run_id,vintage_label="new",latest_reference_month=__import__('datetime').date(2024,2,1),validation_status="FAIL",is_active=False)
        db.add_all([old,new]);db.commit()
        with pytest.raises(PromotionBlocked): promote_vintage(db,new.vintage_id)
        db.rollback();assert db.get(DatasetVintage,old.vintage_id).is_active is True

