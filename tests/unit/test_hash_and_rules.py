from datetime import date
from decimal import Decimal
from src.ingestion.hash_utils import row_sha256, sha256_bytes
from src.validation.rules import composition_identity, historical_warning

def test_sha_is_deterministic_and_order_independent_for_rows():
    assert sha256_bytes(b"abc")=="BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
    assert row_sha256({"b":2,"a":1})==row_sha256({"a":1,"b":2})

def test_composition_and_known_historical_warning():
    assert composition_identity([{"natural_key":"x","total_holdings_usd_mn":3,"long_term_holdings_usd_mn":2,"short_term_holdings_usd_mn":1}]).status=="PASS"
    result=historical_warning(date(2018,4,1),Decimal("-497"))
    assert result.status=="WARN" and result.evidence["corrected"] is False

