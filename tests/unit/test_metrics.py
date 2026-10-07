from datetime import date
from decimal import Decimal
from src.services.metrics import exact_change,safe_percent,shift_month,table5_matches

def test_exact_lag_and_missing_month_null_semantics():
    assert shift_month(date(2024,3,1),-3)==date(2023,12,1)
    assert exact_change(Decimal("10"),None) is None

def test_zero_denominator_and_units():
    assert safe_percent(Decimal("1"),Decimal("0")) is None
    assert table5_matches(Decimal("1000"),Decimal("1.05")) is True
    assert table5_matches(Decimal("1000"),Decimal("1.052")) is False

