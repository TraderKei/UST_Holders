import csv, io, re
from datetime import date
from .common import parse_month, parse_number
from ..types import ParsedHolding

def _pick(row: dict[str, str], *names: str) -> str:
    lowered = {str(k).strip().lower(): (v or "") for k, v in row.items()}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return ""

def parse_historical(content: bytes, cutoff: date | None = date(2020, 1, 1)) -> list[ParsedHolding]:
    rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
    result = []
    for row_number, values in enumerate(rows, 1):
        # The Treasury file has no machine header; logical rows are six positional columns.
        if len(values) < 6:
            continue
        row = {"country": values[0], "country_code": values[1], "date": values[2], "for_treas_pos": values[3], "for_lt_treas_pos": values[4], "for_st_treas_pos": values[5]}
        month_text = row["date"]
        if not re.fullmatch(r"\d{4}-\d{2}", month_text.strip()):
            continue
        month = parse_month(month_text)
        if cutoff is not None and month >= cutoff:
            continue
        payload = {str(k): (v or "").strip() for k, v in row.items()}
        result.append(ParsedHolding(row_number=row_number, country=_pick(row,"country","country_name").strip(), country_code=_pick(row,"country_code","code").strip(), reference_month=month, total_holdings_usd_mn=parse_number(_pick(row,"for_treas_pos")), long_term_holdings_usd_mn=parse_number(_pick(row,"for_lt_treas_pos")), short_term_holdings_usd_mn=parse_number(_pick(row,"for_st_treas_pos")), raw_payload=payload))
    return result
