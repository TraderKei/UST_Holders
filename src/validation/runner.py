from __future__ import annotations
import hashlib
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote, urlparse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from src.db.models import DatasetVintage, HoldingEntity, ReportingPeriod, SourceFile, SourceRecord, Table5Crosscheck, TreasuryHoldingFact, ValidationResult, ValidationRule, ValidationRun, VintageConflict
from .rules import RULE_SPECS, RuleOutcome, composition_identity, historical_warning

class ValidationFailed(RuntimeError): pass

def _local_path(uri: str) -> Path | None:
    parsed=urlparse(uri)
    if parsed.scheme != "file": return None
    path=unquote(parsed.path)
    if parsed.netloc: path=f"//{parsed.netloc}{path}"
    if len(path)>2 and path[0]=="/" and path[2]==":": path=path[1:]
    return Path(path)

class ValidationRunner:
    def __init__(self, session: Session): self.session=session

    def _seed_rules(self) -> dict[str,ValidationRule]:
        result={}
        for spec in RULE_SPECS:
            rule=self.session.scalar(select(ValidationRule).where(ValidationRule.rule_code==spec.code))
            if not rule:
                rule=ValidationRule(rule_code=spec.code,rule_name=spec.code.replace("_"," ").title(),severity=spec.severity,tolerance_value=spec.tolerance,tolerance_unit=spec.unit)
                self.session.add(rule);self.session.flush()
            result[spec.code]=rule
        return result

    def run(self, vintage_id, *, raise_on_error: bool=False) -> ValidationRun:
        vintage=self.session.get(DatasetVintage,vintage_id)
        if not vintage: raise ValueError("vintage not found")
        rules=self._seed_rules(); run=ValidationRun(vintage_id=vintage_id,validator_version="0.1.0")
        self.session.add(run);self.session.flush()
        outcomes=self._evaluate(vintage)
        error_failed=False
        for code,outcome in outcomes.items():
            rule=rules[code]
            status=outcome.status
            if rule.severity=="ERROR" and status!="PASS": error_failed=True
            self.session.add(ValidationResult(validation_run_id=run.validation_run_id,validation_rule_id=rule.validation_rule_id,result_status=status,checked_count=outcome.checked_count,failed_count=outcome.failed_count,evidence=outcome.evidence))
        run.finished_at=datetime.now(UTC);run.overall_status="FAIL" if error_failed else "PASS"
        vintage.validation_status=run.overall_status;vintage.validated_at=run.finished_at
        self.session.flush()
        if error_failed and raise_on_error: raise ValidationFailed(f"vintage {vintage_id} failed ERROR validation")
        return run

    def _evaluate(self,vintage:DatasetVintage) -> dict[str,RuleOutcome]:
        facts=self.session.execute(select(TreasuryHoldingFact,ReportingPeriod,HoldingEntity).join(ReportingPeriod,TreasuryHoldingFact.period_id==ReportingPeriod.period_id).join(HoldingEntity,TreasuryHoldingFact.entity_id==HoldingEntity.entity_id).where(TreasuryHoldingFact.vintage_id==vintage.vintage_id)).all()
        files=self.session.scalars(select(SourceFile).where(SourceFile.ingestion_run_id==vintage.ingestion_run_id)).all()
        sha_fail=[]
        for f in files:
            path=_local_path(f.storage_uri)
            if path and path.exists():
                actual=hashlib.sha256(path.read_bytes()).hexdigest().upper()
                if actual!=f.sha256_hex: sha_fail.append({"source_file":f.file_name,"actual":actual,"expected":f.sha256_hex})
        sha=RuleOutcome("PASS" if not sha_fail and len(files)==3 else "FAIL",len(files),len(sha_fail),{"failures":sha_fail,"files":len(files)})
        cross=self.session.scalars(select(Table5Crosscheck).where(Table5Crosscheck.vintage_id==vintage.vintage_id)).all()
        t5_records=self.session.scalars(select(SourceRecord).join(SourceFile).where(SourceFile.ingestion_run_id==vintage.ingestion_run_id,SourceFile.file_name=="slt_table5.txt")).all()
        cross_fail=[{"natural_key":f"{x.entity_id}|{x.period_id}","actual":str(x.difference_usd_bn),"expected":"absolute difference <= 0.051","difference":str(x.difference_usd_bn),"tolerance":"0.051 USD billion"} for x in cross if not x.is_pass]
        unmapped=[{"natural_key":x.natural_key,"source_file":"slt_table5.txt","reference_month":x.raw_payload.get("date"),"reason":x.parse_error} for x in t5_records if x.parse_status!="PARSED"]
        missing_comparisons=max(0,len(t5_records)-len(cross)-len(unmapped))
        cross_failure_count=len(cross_fail)+missing_comparisons
        cross_o=RuleOutcome("PASS" if t5_records and cross_failure_count==0 else "FAIL",len(cross),cross_failure_count,{"failures":cross_fail[:100],"unmapped_rows":unmapped[:100],"missing_comparisons":missing_comparisons})
        months_by_source={}
        for filename in ("slt_table3.txt","slt_table5.txt"):
            values=self.session.scalars(select(ReportingPeriod.reference_month).join(SourceRecord,SourceRecord.period_id==ReportingPeriod.period_id).join(SourceFile,SourceRecord.source_file_id==SourceFile.source_file_id).where(SourceFile.ingestion_run_id==vintage.ingestion_run_id,SourceFile.file_name==filename)).all()
            months_by_source[filename]=max(values) if values else None
        latest_ok=months_by_source.get("slt_table3.txt")==months_by_source.get("slt_table5.txt")==vintage.latest_reference_month
        latest=RuleOutcome("PASS" if latest_ok else "FAIL",3,0 if latest_ok else 1,{"table3":str(months_by_source.get("slt_table3.txt")),"table5":str(months_by_source.get("slt_table5.txt")),"vintage":str(vintage.latest_reference_month)})
        rows=[]; by_key={}
        for fact,period,entity in facts:
            row={"natural_key":f"{entity.tic_country_code}|{period.reference_month:%Y-%m}","reference_month":period.reference_month,"source_file":None,"total_holdings_usd_mn":fact.total_holdings_usd_mn,"long_term_holdings_usd_mn":fact.long_term_holdings_usd_mn,"short_term_holdings_usd_mn":fact.short_term_holdings_usd_mn}
            rows.append(row);by_key[(entity.tic_country_code,period.reference_month)]=fact
        comp=composition_identity(rows)
        gt_fail=[]
        for month in {p.reference_month for _,p,_ in facts}:
            gt,ac,iro=(by_key.get((code,month)) for code in ("99996","69995","79995"))
            if gt and ac and iro and None not in (gt.total_holdings_usd_mn,ac.total_holdings_usd_mn,iro.total_holdings_usd_mn):
                diff=gt.total_holdings_usd_mn-ac.total_holdings_usd_mn-iro.total_holdings_usd_mn
                if abs(diff)>1 and month!=date(2018,4,1): gt_fail.append({"natural_key":f"99996|{month:%Y-%m}","reference_month":str(month),"actual":str(gt.total_holdings_usd_mn),"expected":str(ac.total_holdings_usd_mn+iro.total_holdings_usd_mn),"difference":str(diff),"tolerance":"1 USD million"})
        gt_o=RuleOutcome("PASS" if not gt_fail else "FAIL",len({p.reference_month for _,p,_ in facts}),len(gt_fail),{"failures":gt_fail[:100]})
        source_rows=self.session.scalars(select(SourceRecord).join(SourceFile).where(SourceFile.ingestion_run_id==vintage.ingestion_run_id,SourceFile.file_name=="slt_table3.txt")).all()
        fidelity_fail=[];null_fail=[]
        mapping={"for_treas_pos":"total_holdings_usd_mn","for_lt_treas_pos":"long_term_holdings_usd_mn","for_st_treas_pos":"short_term_holdings_usd_mn","for_treas_net":"net_transaction_usd_mn","for_lt_treas_net":"long_term_net_transaction_usd_mn","for_st_treas_net":"short_term_net_transaction_usd_mn","for_lt_treas_valchg":"long_term_valuation_change_usd_mn"}
        from src.ingestion.parsers.common import parse_number
        facts_by_source={f.source_record_id:f for f,_,_ in facts}
        for sr in source_rows:
            fact=facts_by_source.get(sr.source_record_id)
            if not fact: fidelity_fail.append({"natural_key":sr.natural_key,"source_record_id":sr.source_record_id,"reason":"fact missing"});continue
            for raw,field in mapping.items():
                expected=parse_number(sr.raw_payload.get(raw));actual=getattr(fact,field)
                if expected!=actual: fidelity_fail.append({"natural_key":sr.natural_key,"source_file":"slt_table3.txt","reference_month":sr.raw_payload.get("date"),"field":raw,"actual":str(actual),"expected":str(expected)})
                if expected is None and actual is not None: null_fail.append({"natural_key":sr.natural_key,"field":raw,"actual":str(actual),"expected":None})
        fidelity=RuleOutcome("PASS" if not fidelity_fail else "FAIL",len(source_rows)*7,len(fidelity_fail),{"failures":fidelity_fail[:100]})
        nulls=RuleOutcome("PASS" if not null_fail else "FAIL",len(source_rows)*7,len(null_fail),{"failures":null_fail[:100]})
        rank_bad=sum(1 for _,_,e in facts if e.entity_type_code!="country" and self.session.get(__import__('src.db.models',fromlist=['EntityType']).EntityType,e.entity_type_code).rank_eligible)
        rank=RuleOutcome("PASS" if rank_bad==0 else "FAIL",len(facts),rank_bad,{"non_country_rank_eligible":rank_bad})
        grain_count=len(facts);grain_distinct=len({(f.entity_id,f.period_id) for f,_,_ in facts})
        natural=RuleOutcome("PASS" if grain_count==grain_distinct else "FAIL",grain_count,grain_count-grain_distinct,{"fact_rows":grain_count,"distinct_grain":grain_distinct})
        conflicts=self.session.scalar(select(func.count()).select_from(VintageConflict).where(VintageConflict.vintage_id==vintage.vintage_id)) or 0
        vint=RuleOutcome("WARN" if conflicts else "PASS",conflicts,0,{"conflict_fields":conflicts,"resolution":"PREFER_TABLE3"})
        prelim_bad=sum(1 for f,_,_ in facts if f.is_preliminary not in (True,False,None))
        prelim=RuleOutcome("PASS" if prelim_bad==0 else "FAIL",len(facts),prelim_bad,{"inferred":False})
        hist_diff=Decimal(0);gt,ac,iro=(by_key.get((code,date(2018,4,1))) for code in ("99996","69995","79995"))
        if gt and ac and iro: hist_diff=gt.total_holdings_usd_mn-ac.total_holdings_usd_mn-iro.total_holdings_usd_mn
        hist=historical_warning(date(2018,4,1),hist_diff)
        return {"SHA256_MATCH":sha,"LATEST_MONTH_MATCH":latest,"T3_T5_CROSSCHECK":cross_o,"GRAND_TOTAL_IDENTITY":gt_o,"COMPOSITION_IDENTITY":comp,"NULL_PRESERVED":nulls,"RANK_SCOPE":rank,"NATURAL_KEY_UNIQUE":natural,"VINTAGE_DIFFERENCE":vint,"PRELIM_NULLABLE":prelim,"SOURCE_FIDELITY":fidelity,"HIST_WARNING":hist}
