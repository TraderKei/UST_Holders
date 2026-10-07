from datetime import date
from decimal import Decimal
from src.ingestion.parsers.common import parse_number
from src.ingestion.parsers.table3 import parse_table3
from src.ingestion.parsers.table5 import parse_table5
from src.ingestion.parsers.historical import parse_historical

def test_number_rules():
    assert parse_number("1,234.5")==Decimal("1234.5")
    assert parse_number("") is None and parse_number("n.a.") is None and parse_number("12x") is None

def test_table3_header_can_move():
    raw=b"title\nnotes\ncountry\tcountry_code\tdate\tfor_treas_pos\tfor_lt_treas_pos\tfor_st_treas_pos\tfor_treas_net\tfor_lt_treas_net\tfor_st_treas_net\tfor_lt_treas_valchg\nJapan\t001\t2024-01\t1,200\t1,000\t200\tn.a.\t\tbad\t3\n"
    row=parse_table3(raw)[0]
    assert row.country_code=="001" and row.total_holdings_usd_mn==Decimal("1200")
    assert row.net_transaction_usd_mn is None and row.short_term_net_transaction_usd_mn is None

def test_historical_cutoff_and_missing_transaction_fields():
    raw=b'"Japan",001,"2020-01",100,90,10\n"Japan",001,"2019-12",99,89,10\n'
    rows=parse_historical(raw)
    assert [x.reference_month for x in rows]==[date(2019,12,1)]
    assert rows[0].net_transaction_usd_mn is None

def test_table5_wide_to_long():
    rows=parse_table5(b"heading\nCountry\t2024-02\t2024-01\nJapan\t1.2\t1.1\n")
    assert len(rows)==2 and rows[1].value_usd_bn==Decimal("1.1")

