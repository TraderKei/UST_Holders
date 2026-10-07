import re
from .common import parse_month, parse_number
from ..types import Table5Value

def parse_table5(content: bytes) -> list[Table5Value]:
    lines = content.decode("utf-8-sig").splitlines()
    header_index = next((i for i, line in enumerate(lines) if line.split("\t")[0].strip() == "Country"), None)
    if header_index is None:
        raise ValueError("Table 5 header not found")
    header = [x.strip() for x in lines[header_index].split("\t")]
    month_columns = [(i, parse_month(value)) for i, value in enumerate(header[1:], 1) if re.fullmatch(r"\d{4}-\d{2}", value)]
    if not month_columns:
        raise ValueError("Table 5 contains no month columns")
    result = []
    for row_number, line in enumerate(lines[header_index + 1:], header_index + 2):
        columns = line.split("\t")
        country = columns[0].strip() if columns else ""
        if not country:
            continue
        parsed_values = [(index, month, parse_number(columns[index].strip() if index < len(columns) else "")) for index, month in month_columns]
        if not any(value is not None for _, _, value in parsed_values):
            continue
        for index, month, value in parsed_values:
            raw = columns[index].strip() if index < len(columns) else ""
            result.append(Table5Value(row_number=row_number, country=country, reference_month=month, value_usd_bn=value, raw_payload={"country": country, "date": month.strftime("%Y-%m"), "value": raw}))
    return result
