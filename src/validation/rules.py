from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Iterable

@dataclass(frozen=True)
class RuleSpec:
    code: str
    severity: str
    tolerance: Decimal | None = None
    unit: str | None = None

@dataclass(frozen=True)
class RuleOutcome:
    status: str
    checked_count: int
    failed_count: int
    evidence: dict[str, Any]

RULE_SPECS = [
    RuleSpec("SHA256_MATCH","ERROR"), RuleSpec("LATEST_MONTH_MATCH","ERROR"),
    RuleSpec("T3_T5_CROSSCHECK","ERROR",Decimal("0.051"),"USD billion"),
    RuleSpec("GRAND_TOTAL_IDENTITY","ERROR",Decimal("1"),"USD million"),
    RuleSpec("COMPOSITION_IDENTITY","ERROR",Decimal("1"),"USD million"),
    RuleSpec("NULL_PRESERVED","ERROR"), RuleSpec("RANK_SCOPE","ERROR"),
    RuleSpec("NATURAL_KEY_UNIQUE","ERROR"), RuleSpec("VINTAGE_DIFFERENCE","WARN"),
    RuleSpec("PRELIM_NULLABLE","ERROR"), RuleSpec("SOURCE_FIDELITY","ERROR"),
    RuleSpec("HIST_WARNING","WARN",Decimal("1"),"USD million"),
]

def composition_identity(rows: Iterable[dict]) -> RuleOutcome:
    checked, failures = 0, []
    for row in rows:
        vals = [row.get(x) for x in ("total_holdings_usd_mn","long_term_holdings_usd_mn","short_term_holdings_usd_mn")]
        if any(v is None for v in vals): continue
        checked += 1
        diff = Decimal(vals[0]) - Decimal(vals[1]) - Decimal(vals[2])
        if abs(diff) > 1:
            failures.append({"natural_key": row.get("natural_key"), "reference_month": str(row.get("reference_month")), "actual": str(vals[0]), "expected": str(Decimal(vals[1])+Decimal(vals[2])), "difference": str(diff), "tolerance": "1", "source_file": row.get("source_file")})
    return RuleOutcome("PASS" if not failures else "FAIL", checked, len(failures), {"failures": failures[:100]})

def historical_warning(month: date, difference: Decimal) -> RuleOutcome:
    known = month == date(2018,4,1) and difference == Decimal("-497")
    return RuleOutcome("WARN" if known else ("PASS" if abs(difference) <= 1 else "WARN"), 1, 1 if abs(difference) > 1 else 0, {"reference_month": str(month), "difference": str(difference), "known_official_exception": known, "corrected": False})

