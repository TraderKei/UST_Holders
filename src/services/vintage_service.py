import uuid
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session
from src.db.models import DatasetVintage, ValidationResult, ValidationRule, ValidationRun

class PromotionBlocked(RuntimeError): pass

def promote_vintage(session: Session, vintage_id: uuid.UUID) -> None:
    vintage = session.execute(select(DatasetVintage).where(DatasetVintage.vintage_id == vintage_id).with_for_update()).scalar_one()
    latest_run = session.execute(select(ValidationRun).where(ValidationRun.vintage_id == vintage_id).order_by(ValidationRun.started_at.desc()).limit(1)).scalar_one_or_none()
    if not latest_run or latest_run.overall_status != "PASS" or vintage.validation_status != "PASS":
        raise PromotionBlocked("vintage must have a latest PASS validation run")
    error_failure = session.execute(select(ValidationResult.validation_result_id).join(ValidationRule).where(ValidationResult.validation_run_id == latest_run.validation_run_id, ValidationRule.severity == "ERROR", ValidationResult.result_status != "PASS").limit(1)).first()
    if error_failure:
        raise PromotionBlocked("ERROR validation failure blocks promotion")
    session.execute(update(DatasetVintage).where(DatasetVintage.is_active.is_(True), DatasetVintage.vintage_id != vintage_id).values(is_active=False))
    vintage.is_active = True
    session.flush()
    if session.bind and session.bind.dialect.name == "postgresql":
        session.execute(text("REFRESH MATERIALIZED VIEW mv_country_month_rank"))
