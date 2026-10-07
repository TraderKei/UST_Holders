from .common import parse_month, parse_number
from ..types import ParsedHolding

SOURCE_TO_DB = {
    "for_treas_pos": "total_holdings_usd_mn",
    "for_lt_treas_pos": "long_term_holdings_usd_mn",
    "for_st_treas_pos": "short_term_holdings_usd_mn",
    "for_treas_net": "net_transaction_usd_mn",
    "for_lt_treas_net": "long_term_net_transaction_usd_mn",
    "for_st_treas_net": "short_term_net_transaction_usd_mn",
    "for_lt_treas_valchg": "long_term_valuation_change_usd_mn",
}

def parse_table3(content: bytes) -> list[ParsedHolding]:
    lines = content.decode("utf-8-sig").splitlines()
    header_index = next((i for i, line in enumerate(lines) if [x.strip() for x in line.split("\t")][:3] == ["country","country_code","date"]), None)
    if header_index is None:
        raise ValueError("Table 3 system header not found")
    header = [x.strip() for x in lines[header_index].split("\t")]
    missing = {"country", "country_code", "date", *SOURCE_TO_DB} - set(header)
    if missing:
        raise ValueError(f"Table 3 required columns missing: {sorted(missing)}")
    result = []
    for row_number, line in enumerate(lines[header_index + 1:], header_index + 2):
        columns = line.split("\t")
        payload = {name: columns[i].strip() if i < len(columns) else "" for i, name in enumerate(header)}
        if not __import__("re").fullmatch(r"\d{4}-\d{2}", payload["date"]):
            continue
        values = {target: parse_number(payload[source]) for source, target in SOURCE_TO_DB.items()}
        result.append(ParsedHolding(row_number=row_number, country=payload["country"], country_code=payload["country_code"], reference_month=parse_month(payload["date"]), raw_payload=payload, **values))
    return result

