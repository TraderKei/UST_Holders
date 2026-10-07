import re
from datetime import date
from decimal import Decimal, InvalidOperation

NUMBER = re.compile(r"^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")

def parse_number(value: object) -> Decimal | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or not NUMBER.fullmatch(text):
        return None
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None

def parse_month(value: str) -> date:
    return date.fromisoformat(value.strip() + "-01")

