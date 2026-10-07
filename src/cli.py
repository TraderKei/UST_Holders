import json, uuid
from pathlib import Path
import typer
from sqlalchemy import select
from src.config import get_settings
from src.db.models import DatasetVintage, IngestionRun
from src.db.session import session_scope
from src.ingestion import IngestionPipeline
from src.logging import configure_logging
from src.validation.runner import ValidationRunner
from src.validation.shadow import validate_shadow

app=typer.Typer(no_args_is_help=True)

@app.command()
def ingest(dry_run:bool=False,from_directory:Path|None=None,download_only:bool=False):
    settings=get_settings();configure_logging(settings.log_level)
    with session_scope() as db:
        typer.echo(json.dumps(IngestionPipeline(db,settings).ingest(from_directory=from_directory,dry_run=dry_run,download_only=download_only),ensure_ascii=False,default=str,indent=2))

@app.command("current-vintage")
def current_vintage():
    with session_scope() as db:
        value=db.scalar(select(DatasetVintage).where(DatasetVintage.is_active.is_(True),DatasetVintage.validation_status=="PASS"))
        typer.echo(json.dumps({"vintage_id":value.vintage_id,"label":value.vintage_label,"latest_reference_month":value.latest_reference_month},default=str) if value else "null")

@app.command("failed-run")
def failed_run(ingestion_run_id:uuid.UUID):
    with session_scope() as db:
        run=db.get(IngestionRun,ingestion_run_id)
        if not run: raise typer.BadParameter("run not found")
        typer.echo(json.dumps({"ingestion_run_id":run.ingestion_run_id,"status":run.run_status,"started_at":run.started_at,"finished_at":run.finished_at,"error_message":run.error_message},default=str,indent=2))

@app.command()
def validate(vintage_id:uuid.UUID=typer.Option(...,"--vintage-id")):
    """Execute and persist all validation rules for a vintage."""
    with session_scope() as db:
        vintage=db.get(DatasetVintage,vintage_id)
        if not vintage: raise typer.BadParameter("vintage not found")
        run=ValidationRunner(db).run(vintage_id)
        typer.echo(json.dumps({"vintage_id":str(vintage_id),"validation_run_id":str(run.validation_run_id),"status":run.overall_status}))

@app.command("shadow-validate")
def shadow_validate(vintage_id:uuid.UUID=typer.Option(...,"--vintage-id"),json_path:Path=Path("dashboard/public/data/tic.json")):
    with session_scope() as db:
        result=validate_shadow(db,vintage_id,json_path)
        typer.echo(json.dumps(result,ensure_ascii=False,indent=2))
        if result["status"]!="PASS": raise typer.Exit(1)

if __name__=="__main__": app()
