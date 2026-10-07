from calendar import monthrange
from datetime import date
from decimal import Decimal

def shift_month(month: date, offset: int) -> date:
    absolute=month.year*12+month.month-1+offset
    year,zero_month=divmod(absolute,12)
    return date(year,zero_month+1,1)

def exact_change(current: Decimal | None, prior: Decimal | None) -> Decimal | None:
    return None if current is None or prior is None else current-prior

def safe_percent(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    return None if numerator is None or denominator in (None,0) else numerator/denominator*100

def table5_matches(table3_usd_mn: Decimal | None, table5_usd_bn: Decimal | None, tolerance: Decimal=Decimal("0.051")) -> bool | None:
    if table3_usd_mn is None or table5_usd_bn is None: return None
    return abs(table3_usd_mn/1000-table5_usd_bn)<=tolerance

