import json
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from src.db.models import Base,EntityType,HoldingEntity
from src.ingestion.pipeline import IngestionPipeline

def test_new_code_name_conflict_requires_review(tmp_path):
    engine=create_engine("sqlite+pysqlite:///:memory:");Base.metadata.create_all(engine)
    seed=tmp_path/"seed.json";seed.write_text(json.dumps({"countries":[{"country_code":"001","country_name":"New Name","record_type":"country","region":"아시아"}]},ensure_ascii=False),encoding="utf-8")
    with Session(engine) as db:
        db.add(EntityType(entity_type_code="country",type_name_ko="country",rank_eligible=True));db.add(HoldingEntity(tic_country_code="001",entity_name="Old Name",entity_type_code="country"));db.commit()
        try:
            IngestionPipeline(db)._load_entity_seed(seed)
        except ValueError as exc:
            assert "review required" in str(exc)
        else:
            raise AssertionError("name conflict was silently accepted")
