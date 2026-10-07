from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict

class ParsedHolding(BaseModel):
    model_config = ConfigDict(frozen=True)
    row_number: int
    country: str
    country_code: str
    reference_month: date
    total_holdings_usd_mn: Decimal | None = None
    long_term_holdings_usd_mn: Decimal | None = None
    short_term_holdings_usd_mn: Decimal | None = None
    net_transaction_usd_mn: Decimal | None = None
    long_term_net_transaction_usd_mn: Decimal | None = None
    short_term_net_transaction_usd_mn: Decimal | None = None
    long_term_valuation_change_usd_mn: Decimal | None = None
    raw_payload: dict

    @property
    def natural_key(self) -> str:
        return f"{self.country_code}|{self.reference_month:%Y-%m}"

class Table5Value(BaseModel):
    model_config = ConfigDict(frozen=True)
    row_number: int
    country: str
    reference_month: date
    value_usd_bn: Decimal | None
    raw_payload: dict

