import uuid
from datetime import date
from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from src.db.models import DatasetVintage, HoldingEntity, ReportingPeriod, ValidationResult, ValidationRun
from src.db.session import session_scope

app = FastAPI(title="TIC Holdings Read API", version="0.1.0")

def get_session():
    with session_scope() as session: yield session

@app.get("/v1/vintages/current")
def current_vintage(db: Session = Depends(get_session)):
    value=db.scalar(select(DatasetVintage).where(DatasetVintage.is_active.is_(True),DatasetVintage.validation_status=="PASS"))
    if not value: raise HTTPException(404,"No active PASS vintage")
    return {"vintage_id":value.vintage_id,"label":value.vintage_label,"latest_reference_month":value.latest_reference_month,"validated_at":value.validated_at}

@app.get("/v1/periods")
def periods(db: Session=Depends(get_session), start:date|None=None, end:date|None=None):
    query=select(ReportingPeriod.reference_month).order_by(ReportingPeriod.reference_month)
    if start: query=query.where(ReportingPeriod.reference_month>=start)
    if end: query=query.where(ReportingPeriod.reference_month<=end)
    return db.scalars(query).all()

@app.get("/v1/entities")
def entities(db:Session=Depends(get_session),entity_type:str|None=None,region_id:int|None=None,limit:int=Query(100,le=500),offset:int=0):
    query=select(HoldingEntity).where(HoldingEntity.is_active.is_(True)).order_by(HoldingEntity.entity_name).limit(limit).offset(offset)
    if entity_type: query=query.where(HoldingEntity.entity_type_code==entity_type)
    if region_id: query=query.where(HoldingEntity.region_id==region_id)
    return [{"entity_id":x.entity_id,"tic_country_code":x.tic_country_code,"entity_name":x.entity_name,"entity_type":x.entity_type_code,"region_id":x.region_id} for x in db.scalars(query)]

@app.get("/v1/rankings/{reference_month}")
def rankings(reference_month:date,db:Session=Depends(get_session),limit:int=Query(100,le=500),offset:int=0):
    rows=db.execute(text("SELECT r.*,e.tic_country_code,e.entity_name FROM mv_country_month_rank r JOIN holding_entity e USING(entity_id) JOIN reporting_period p USING(period_id) WHERE p.reference_month=:month ORDER BY country_rank LIMIT :limit OFFSET :offset"),{"month":reference_month,"limit":limit,"offset":offset}).mappings()
    return [dict(x) for x in rows]

@app.get("/v1/entities/{entity_id}/series")
def series(entity_id:int,db:Session=Depends(get_session),start:date|None=None,end:date|None=None,vintage_id:str|None=None,limit:int=Query(500,le=2000),offset:int=0):
    source="vw_holding_metrics" if vintage_id is None else "treasury_holding_fact"
    where=["f.entity_id=:entity_id"]; params={"entity_id":entity_id,"limit":limit,"offset":offset}
    if vintage_id: where.append("f.vintage_id=:vintage_id");params["vintage_id"]=vintage_id
    if start: where.append("p.reference_month>=:start");params["start"]=start
    if end: where.append("p.reference_month<=:end");params["end"]=end
    rows=db.execute(text(f"SELECT f.*,p.reference_month FROM {source} f JOIN reporting_period p USING(period_id) WHERE {' AND '.join(where)} ORDER BY p.reference_month LIMIT :limit OFFSET :offset"),params).mappings()
    return [dict(x) for x in rows]

@app.get("/v1/validations/latest")
def latest_validation(db:Session=Depends(get_session)):
    run=db.scalar(select(ValidationRun).join(DatasetVintage).where(DatasetVintage.is_active.is_(True),DatasetVintage.validation_status=="PASS").order_by(ValidationRun.started_at.desc()).limit(1))
    if not run: raise HTTPException(404,"No validation run")
    return validation_results(run.validation_run_id,db)

@app.get("/v1/validations/{validation_run_id}")
def validation_results(validation_run_id:uuid.UUID,db:Session=Depends(get_session)):
    run=db.get(ValidationRun,validation_run_id)
    if not run: raise HTTPException(404,"Validation run not found")
    results=db.scalars(select(ValidationResult).where(ValidationResult.validation_run_id==run.validation_run_id)).all()
    return {"validation_run_id":run.validation_run_id,"vintage_id":run.vintage_id,"status":run.overall_status,"results":[{"status":r.result_status,"checked":r.checked_count,"failed":r.failed_count,"evidence":r.evidence,"message":r.message} for r in results]}

@app.get("/v1/vintages/{vintage_id}/validations")
def vintage_validations(vintage_id:uuid.UUID,db:Session=Depends(get_session)):
    run=db.scalar(select(ValidationRun).where(ValidationRun.vintage_id==vintage_id).order_by(ValidationRun.started_at.desc()).limit(1))
    if not run: raise HTTPException(404,"No validation run for vintage")
    return validation_results(run.validation_run_id,db)
