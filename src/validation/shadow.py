import json
from decimal import Decimal
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session
from src.db.models import HoldingEntity, ReportingPeriod, TreasuryHoldingFact

FIELDS=("total_holdings_usd_mn","long_term_holdings_usd_mn","short_term_holdings_usd_mn","net_transaction_usd_mn","long_term_net_transaction_usd_mn","short_term_net_transaction_usd_mn","long_term_valuation_change_usd_mn")
JSON_FIELDS=("for_treas_pos","for_lt_treas_pos","for_st_treas_pos","for_treas_net","for_lt_treas_net","for_st_treas_net","for_lt_treas_valchg")

def _number(value): return None if value is None else Decimal(str(value))

def validate_shadow(session:Session,vintage_id,json_path:Path) -> dict:
    doc=json.loads(json_path.read_text(encoding="utf-8"));columns={name:i for i,name in enumerate(doc["meta"]["record_columns"])}
    expected={(str(row[columns["country_code"]]),str(row[columns["reference_month"]])):tuple(_number(row[columns[name]]) for name in JSON_FIELDS) for row in doc["records"]}
    actual={}
    rows=session.execute(select(TreasuryHoldingFact,ReportingPeriod,HoldingEntity).join(ReportingPeriod).join(HoldingEntity).where(TreasuryHoldingFact.vintage_id==vintage_id)).all()
    for fact,period,entity in rows:
        actual[(entity.tic_country_code,period.reference_month.strftime("%Y-%m"))]=tuple(getattr(fact,name) for name in FIELDS)
    missing=sorted(expected.keys()-actual.keys());unexpected=sorted(actual.keys()-expected.keys());mismatches=[]
    for key in expected.keys()&actual.keys():
        if expected[key]!=actual[key]: mismatches.append({"natural_key":"|".join(key),"expected":[str(x) if x is not None else None for x in expected[key]],"actual":[str(x) if x is not None else None for x in actual[key]]})
    return {"status":"PASS" if not (missing or unexpected or mismatches) else "FAIL","expected_rows":len(expected),"actual_rows":len(actual),"missing":missing[:100],"unexpected":unexpected[:100],"mismatches":mismatches[:100],"failure_count":len(missing)+len(unexpected)+len(mismatches)}

