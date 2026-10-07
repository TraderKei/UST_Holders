from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from src.db.models import Base,DatasetVintage,EntityType,HoldingEntity,IngestionRun,ReportingPeriod,SourceFile,SourceRecord,SourceSystem,TreasuryHoldingFact

def test_fact_grain_unique():
    engine=create_engine("sqlite+pysqlite:///:memory:");Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(EntityType(entity_type_code="country",type_name_ko="country",rank_eligible=True));source=SourceSystem(source_code="T3",source_name="t3",official_url="https://x",native_unit="USD million");run=IngestionRun();entity=HoldingEntity(tic_country_code="1",entity_name="X",entity_type_code="country");period=ReportingPeriod(reference_month=date(2024,1,1),calendar_year=2024,calendar_month=1);db.add_all([source,run,entity,period]);db.flush()
        sf=SourceFile(source_system_id=source.source_system_id,ingestion_run_id=run.ingestion_run_id,file_name="x",official_url="https://x",downloaded_at=__import__('datetime').datetime.now(__import__('datetime').UTC),sha256_hex="A"*64,byte_size=1,storage_uri="file:///x");v=DatasetVintage(ingestion_run_id=run.ingestion_run_id,vintage_label="v",latest_reference_month=date(2024,1,1));db.add_all([sf,v]);db.flush();sr=SourceRecord(source_file_id=sf.source_file_id,row_number=1,entity_id=entity.entity_id,period_id=period.period_id,natural_key="1|2024-01",row_sha256_hex="B"*64,raw_payload={});db.add(sr);db.flush()
        db.add_all([TreasuryHoldingFact(vintage_id=v.vintage_id,entity_id=entity.entity_id,period_id=period.period_id,source_record_id=sr.source_record_id),TreasuryHoldingFact(vintage_id=v.vintage_id,entity_id=entity.entity_id,period_id=period.period_id,source_record_id=sr.source_record_id)])
        with pytest.raises(IntegrityError): db.flush()
