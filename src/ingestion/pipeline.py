from __future__ import annotations
import json, logging, uuid
from datetime import UTC, date, datetime
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session
from src.config.settings import Settings, get_settings
from src.db.models import DatasetVintage, EntityType, HoldingEntity, IngestionRun, Region, ReportingPeriod, SourceFile, SourceRecord, SourceSystem, Table5Crosscheck, TreasuryHoldingFact, VintageConflict
from src.services.vintage_service import promote_vintage
from src.validation.runner import ValidationFailed, ValidationRunner
from .downloader import Downloader
from .hash_utils import row_sha256, sha256_bytes
from .parsers import parse_historical, parse_table3, parse_table5
from .storage import LocalRawStorage, S3RawStorage

log = logging.getLogger(__name__)
SOURCES = {
 "slt_table3.txt": ("TIC_TABLE3","TIC Table 3","USD million","https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt"),
 "slt_table5.txt": ("TIC_TABLE5","TIC Table 5","USD billion","https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt"),
 "slt3d_globl.csv": ("HISTORICAL_CSV","Historical SLT CSV","USD million","https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt3d_globl.csv"),
}

class IngestionPipeline:
    def __init__(self, session: Session, settings: Settings | None = None):
        self.session, self.settings = session, settings or get_settings()
        if self.settings.storage_backend=="local":
            self.storage=LocalRawStorage(self.settings.raw_storage_dir)
        elif self.settings.storage_backend=="s3" and self.settings.s3_bucket:
            self.storage=S3RawStorage(self.settings.s3_bucket,self.settings.s3_prefix,self.settings.s3_endpoint_url)
        else:
            raise ValueError("storage_backend must be local, or s3 with TIC_S3_BUCKET")

    def _seed(self) -> None:
        names = {"country":"국가·관할지역","region":"지역","institution":"기관·비국가 버킷","total":"합계"}
        for code, name in names.items():
            if not self.session.get(EntityType, code): self.session.add(EntityType(entity_type_code=code,type_name_ko=name,rank_eligible=code=="country"))
        for filename, (code,name,unit,url) in SOURCES.items():
            if not self.session.scalar(select(SourceSystem).where(SourceSystem.source_code==code)):
                self.session.add(SourceSystem(source_code=code,source_name=name,official_url=url,native_unit=unit))
        self.session.flush()

    def _load_entity_seed(self, seed_path: Path) -> dict[str, HoldingEntity]:
        data = json.loads(seed_path.read_text(encoding="utf-8"))
        region_codes={"유럽":"EUROPE","북미":"NORTH_AMERICA","중남미":"LATIN_AMERICA","카리브":"CARIBBEAN","아시아":"ASIA","아프리카":"AFRICA","오세아니아":"OCEANIA"}
        regions={}
        for label in sorted({x.get("region") for x in data["countries"] if x.get("region")}):
            code=region_codes.get(label)
            if not code: raise ValueError(f"review required: unknown region label {label!r}")
            region=self.session.scalar(select(Region).where(Region.region_code==code))
            if not region:
                region=Region(region_code=code,region_name_ko=label);self.session.add(region);self.session.flush()
            regions[label]=region
        result = {}
        for item in data["countries"]:
            code, name, kind = str(item["country_code"]), item["country_name"], item["record_type"]
            entity = self.session.scalar(select(HoldingEntity).where(HoldingEntity.tic_country_code==code,HoldingEntity.valid_to.is_(None)))
            if entity and (entity.entity_name != name or entity.entity_type_code != kind):
                raise ValueError(f"review required: TIC code/name classification conflict for {code}")
            if not entity:
                entity = HoldingEntity(tic_country_code=code,entity_name=name,entity_type_code=kind,region_id=regions[item.get("region")].region_id if item.get("region") else None,valid_from=date(1900,1,1),is_active=True)
                self.session.add(entity)
            elif kind=="country" and item.get("region"):
                expected_region_id=regions[item["region"]].region_id
                if entity.region_id is None: entity.region_id=expected_region_id
                elif entity.region_id!=expected_region_id: raise ValueError(f"review required: region mapping conflict for TIC code {code}")
            result[code] = entity
        self.session.flush()
        return result

    def ingest(self, *, from_directory: Path | None = None, dry_run: bool = False, download_only: bool = False, entity_seed: Path = Path("dashboard/public/data/tic.json")) -> dict:
        downloaded_at={name:datetime.now(UTC) for name in SOURCES}
        if from_directory:
            blobs = {name:(from_directory/name).read_bytes() for name in SOURCES}
            manifest_path=from_directory/"manifest.json"
            if manifest_path.exists():
                manifest={x["file"]:x for x in json.loads(manifest_path.read_text(encoding="utf-8-sig"))}
                for name,(_,_,_,url) in SOURCES.items():
                    entry=manifest.get(name)
                    if not entry or entry.get("url")!=url or str(entry.get("sha256","")).upper()!=sha256_bytes(blobs[name]):
                        raise ValueError(f"local manifest URL/SHA mismatch: {name}")
                    downloaded_at[name]=datetime.fromisoformat(entry["downloaded_at"].replace("Z","+00:00"))
        else:
            downloader = Downloader(self.settings)
            blobs = {name:downloader.download(meta[3]).content for name,meta in SOURCES.items()}
        parsed_t3, parsed_hist_all, parsed_t5 = parse_table3(blobs["slt_table3.txt"]), parse_historical(blobs["slt3d_globl.csv"], cutoff=None), parse_table5(blobs["slt_table5.txt"])
        adopted_hist = [x for x in parsed_hist_all if x.reference_month < date(2020,1,1)]
        latest = max(x.reference_month for x in parsed_t3)
        summary = {"table3_rows":len(parsed_t3),"historical_source_rows":len(parsed_hist_all),"historical_adopted_rows":len(adopted_hist),"table5_values":len(parsed_t5),"latest_reference_month":str(latest),"sha256":{k:sha256_bytes(v) for k,v in blobs.items()}}
        if dry_run: return summary
        run = IngestionRun(trigger_type="REPROCESS" if from_directory else "MANUAL")
        self.session.add(run); self.session.commit()
        try:
            self._seed()
            entities = self._load_entity_seed(entity_seed)
            source_files = {}
            for name, content in blobs.items():
                source = self.session.scalar(select(SourceSystem).where(SourceSystem.source_code==SOURCES[name][0]))
                key = f"{datetime.now(UTC):%Y/%m/%d}/{run.ingestion_run_id}/{name}"
                uri = self.storage.put(key, content)
                if sha256_bytes(self.storage.get(uri))!=sha256_bytes(content):
                    raise ValueError(f"stored source SHA mismatch: {name}")
                sf = SourceFile(source_system_id=source.source_system_id,ingestion_run_id=run.ingestion_run_id,file_name=name,official_url=SOURCES[name][3],downloaded_at=downloaded_at[name],sha256_hex=sha256_bytes(content),byte_size=len(content),storage_uri=uri,mime_type="text/csv" if name.endswith(".csv") else "text/plain")
                self.session.add(sf); source_files[name]=sf
            self.session.flush()
            if download_only:
                run.run_status="PASS";run.finished_at=datetime.now(UTC);self.session.commit();return summary|{"ingestion_run_id":str(run.ingestion_run_id)}
            label = f"tic-{latest:%Y-%m}-{sha256_bytes(b''.join(blobs.values()))[:12].lower()}"
            existing = self.session.scalar(select(DatasetVintage).where(DatasetVintage.vintage_label==label))
            if existing:
                run.run_status="PASS";run.finished_at=datetime.now(UTC);self.session.commit();return summary|{"ingestion_run_id":str(run.ingestion_run_id),"vintage_id":str(existing.vintage_id),"reused":True}
            vintage = DatasetVintage(ingestion_run_id=run.ingestion_run_id,vintage_label=label,latest_reference_month=latest,is_preliminary=None)
            self.session.add(vintage);self.session.flush()
            records_by_key = {}
            for filename, rows in (("slt_table3.txt",parsed_t3),("slt3d_globl.csv",parsed_hist_all)):
                for item in rows:
                    entity = entities.get(item.country_code)
                    period = self.session.scalar(select(ReportingPeriod).where(ReportingPeriod.reference_month==item.reference_month))
                    if not period:
                        period=ReportingPeriod(reference_month=item.reference_month,calendar_year=item.reference_month.year,calendar_month=item.reference_month.month);self.session.add(period);self.session.flush()
                    payload=item.raw_payload; digest=row_sha256(payload)
                    sr=SourceRecord(source_file_id=source_files[filename].source_file_id,row_number=item.row_number,entity_id=entity.entity_id if entity else None,period_id=period.period_id,natural_key=item.natural_key,row_sha256_hex=digest,raw_payload=payload,parse_status="PARSED" if entity else "WARNING",parse_error=None if entity else "unmapped entity; review required")
                    self.session.add(sr);self.session.flush();records_by_key[(filename,item.natural_key)]=(sr,item,entity,period)
            name_to_entity={entity.entity_name.casefold():entity for entity in entities.values()}
            table5_records=[]
            for item in parsed_t5:
                entity=name_to_entity.get(item.country.casefold())
                period=self.session.scalar(select(ReportingPeriod).where(ReportingPeriod.reference_month==item.reference_month))
                if not period:
                    period=ReportingPeriod(reference_month=item.reference_month,calendar_year=item.reference_month.year,calendar_month=item.reference_month.month);self.session.add(period);self.session.flush()
                sr=SourceRecord(source_file_id=source_files["slt_table5.txt"].source_file_id,row_number=item.row_number,entity_id=entity.entity_id if entity else None,period_id=period.period_id,natural_key=f"{entity.tic_country_code if entity else item.country}|{item.reference_month:%Y-%m}",row_sha256_hex=row_sha256(item.raw_payload),raw_payload=item.raw_payload,parse_status="PARSED" if entity else "WARNING",parse_error=None if entity else "unmapped Table 5 entity; review required")
                self.session.add(sr);self.session.flush();table5_records.append((sr,item,entity,period))
            for filename, adopted in (("slt3d_globl.csv",adopted_hist),("slt_table3.txt",parsed_t3)):
              for item in adopted:
                sr,_,entity,period=records_by_key[(filename,item.natural_key)]
                if not entity: continue
                self.session.add(TreasuryHoldingFact(vintage_id=vintage.vintage_id,entity_id=entity.entity_id,period_id=period.period_id,source_record_id=sr.source_record_id,total_holdings_usd_mn=item.total_holdings_usd_mn,long_term_holdings_usd_mn=item.long_term_holdings_usd_mn,short_term_holdings_usd_mn=item.short_term_holdings_usd_mn,net_transaction_usd_mn=item.net_transaction_usd_mn,long_term_net_transaction_usd_mn=item.long_term_net_transaction_usd_mn,short_term_net_transaction_usd_mn=item.short_term_net_transaction_usd_mn,long_term_valuation_change_usd_mn=item.long_term_valuation_change_usd_mn,is_preliminary=None))
            self.session.flush()
            fact_by_key={(entity.tic_country_code,period.reference_month):fact for fact,period,entity in self.session.execute(select(TreasuryHoldingFact,ReportingPeriod,HoldingEntity).join(ReportingPeriod).join(HoldingEntity).where(TreasuryHoldingFact.vintage_id==vintage.vintage_id))}
            for sr,item,entity,period in table5_records:
                fact=fact_by_key.get((entity.tic_country_code,item.reference_month)) if entity else None
                if not fact or fact.total_holdings_usd_mn is None or item.value_usd_bn is None: continue
                difference=fact.total_holdings_usd_mn/1000-item.value_usd_bn
                self.session.add(Table5Crosscheck(vintage_id=vintage.vintage_id,entity_id=entity.entity_id,period_id=period.period_id,table5_source_record_id=sr.source_record_id,table3_value_usd_mn=fact.total_holdings_usd_mn,table5_value_usd_bn=item.value_usd_bn,difference_usd_bn=difference,is_pass=abs(difference)<=__import__('decimal').Decimal("0.051")))
            conflict_fields=("total_holdings_usd_mn","long_term_holdings_usd_mn","short_term_holdings_usd_mn")
            for key,(preferred_sr,preferred,entity,period) in [(key,value) for key,value in records_by_key.items() if key[0]=="slt_table3.txt"]:
                alternate_tuple=records_by_key.get(("slt3d_globl.csv",key[1]))
                if not alternate_tuple or not entity: continue
                alternate_sr,alternate,_,_=alternate_tuple
                for field in conflict_fields:
                    left,right=getattr(preferred,field),getattr(alternate,field)
                    if left!=right:
                        self.session.add(VintageConflict(vintage_id=vintage.vintage_id,entity_id=entity.entity_id,period_id=period.period_id,preferred_source_record_id=preferred_sr.source_record_id,alternate_source_record_id=alternate_sr.source_record_id,field_name=field,preferred_value=left,alternate_value=right))
            self.session.flush()
            validation=ValidationRunner(self.session).run(vintage.vintage_id)
            if validation.overall_status != "PASS":
                run.run_status="FAIL";run.finished_at=datetime.now(UTC);run.error_message="ERROR validation failed; vintage not promoted";self.session.commit()
                raise ValidationFailed(run.error_message)
            promote_vintage(self.session,vintage.vintage_id)
            run.run_status="PASS";run.finished_at=datetime.now(UTC);self.session.commit()
            return summary|{"ingestion_run_id":str(run.ingestion_run_id),"vintage_id":str(vintage.vintage_id),"reused":False}
        except Exception as exc:
            self.session.rollback()
            failed=self.session.get(IngestionRun,run.ingestion_run_id)
            if failed: failed.run_status="FAIL";failed.finished_at=datetime.now(UTC);failed.error_message=str(exc)[:4000];self.session.commit()
            log.exception("ingestion_failed",extra={"run_id":str(run.ingestion_run_id)})
            raise
