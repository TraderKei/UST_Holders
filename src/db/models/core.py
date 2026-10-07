from __future__ import annotations
import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, SmallInteger, String, Text, UniqueConstraint, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JsonType = JSON().with_variant(JSONB(), "postgresql")
BigIdentity = BigInteger().with_variant(Integer(), "sqlite")
SmallIdentity = SmallInteger().with_variant(Integer(), "sqlite")

class Base(DeclarativeBase): pass

class EntityType(Base):
    __tablename__ = "entity_type"
    entity_type_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    type_name_ko: Mapped[str] = mapped_column(String(50), unique=True)
    rank_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (CheckConstraint("entity_type_code in ('country','region','institution','total')"),)

class Region(Base):
    __tablename__ = "region"
    region_id: Mapped[int] = mapped_column(SmallIdentity, primary_key=True, autoincrement=True)
    region_code: Mapped[str] = mapped_column(String(20), unique=True)
    region_name_ko: Mapped[str] = mapped_column(String(50), unique=True)

class HoldingEntity(Base):
    __tablename__ = "holding_entity"
    entity_id: Mapped[int] = mapped_column(BigIdentity, primary_key=True, autoincrement=True)
    tic_country_code: Mapped[str] = mapped_column(String(10))
    entity_name: Mapped[str] = mapped_column(String(200))
    entity_type_code: Mapped[str] = mapped_column(ForeignKey("entity_type.entity_type_code"))
    region_id: Mapped[int | None] = mapped_column(ForeignKey("region.region_id"))
    valid_from: Mapped[date] = mapped_column(Date, default=date(1900,1,1))
    valid_to: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (CheckConstraint("valid_to is null or valid_to >= valid_from"), Index("ux_entity_tic_current", "tic_country_code", unique=True, postgresql_where=text("valid_to is null"), sqlite_where=text("valid_to is null")))

class SourceSystem(Base):
    __tablename__ = "source_system"
    source_system_id: Mapped[int] = mapped_column(SmallIdentity, primary_key=True, autoincrement=True)
    source_code: Mapped[str] = mapped_column(String(30), unique=True)
    source_name: Mapped[str] = mapped_column(String(100))
    official_url: Mapped[str] = mapped_column(Text)
    native_unit: Mapped[str] = mapped_column(String(30))

class IngestionRun(Base):
    __tablename__ = "ingestion_run"
    ingestion_run_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    run_status: Mapped[str] = mapped_column(String(20), default="RUNNING")
    trigger_type: Mapped[str] = mapped_column(String(20), default="SCHEDULED")
    error_message: Mapped[str | None] = mapped_column(Text)

class SourceFile(Base):
    __tablename__ = "source_file"
    source_file_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    source_system_id: Mapped[int] = mapped_column(ForeignKey("source_system.source_system_id"))
    ingestion_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ingestion_run.ingestion_run_id"))
    file_name: Mapped[str] = mapped_column(String(255))
    official_url: Mapped[str] = mapped_column(Text)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sha256_hex: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    storage_uri: Mapped[str] = mapped_column(Text, unique=True)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    __table_args__ = (Index("ix_source_file_hash", "source_system_id", "sha256_hex"),)

class DatasetVintage(Base):
    __tablename__ = "dataset_vintage"
    vintage_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    ingestion_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ingestion_run.ingestion_run_id"), unique=True)
    vintage_label: Mapped[str] = mapped_column(String(80), unique=True)
    latest_reference_month: Mapped[date] = mapped_column(Date)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validation_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    is_preliminary: Mapped[bool | None] = mapped_column(Boolean)
    schema_version: Mapped[int] = mapped_column(Integer, default=2)
    __table_args__ = (Index("ux_active_vintage", "is_active", unique=True, postgresql_where=text("is_active"), sqlite_where=text("is_active = 1")),)

class ReportingPeriod(Base):
    __tablename__ = "reporting_period"
    period_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reference_month: Mapped[date] = mapped_column(Date, unique=True)
    release_date: Mapped[date | None] = mapped_column(Date)
    calendar_year: Mapped[int] = mapped_column(SmallInteger)
    calendar_month: Mapped[int] = mapped_column(SmallInteger)
    __table_args__ = (CheckConstraint("calendar_month between 1 and 12"),)

class SourceRecord(Base):
    __tablename__ = "source_record"
    source_record_id: Mapped[int] = mapped_column(BigIdentity, primary_key=True, autoincrement=True)
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_file.source_file_id"))
    row_number: Mapped[int] = mapped_column(Integer)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("holding_entity.entity_id"))
    period_id: Mapped[int | None] = mapped_column(ForeignKey("reporting_period.period_id"))
    natural_key: Mapped[str | None] = mapped_column(String(120))
    row_sha256_hex: Mapped[str] = mapped_column(String(64))
    raw_payload: Mapped[dict] = mapped_column(JsonType)
    parse_status: Mapped[str] = mapped_column(String(20), default="PARSED")
    parse_error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (UniqueConstraint("source_file_id", "row_sha256_hex", name="ux_source_row"), Index("ix_source_natural", "natural_key", "source_file_id"))

class TreasuryHoldingFact(Base):
    __tablename__ = "treasury_holding_fact"
    holding_fact_id: Mapped[int] = mapped_column(BigIdentity, primary_key=True, autoincrement=True)
    vintage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dataset_vintage.vintage_id"))
    entity_id: Mapped[int] = mapped_column(ForeignKey("holding_entity.entity_id"))
    period_id: Mapped[int] = mapped_column(ForeignKey("reporting_period.period_id"))
    source_record_id: Mapped[int] = mapped_column(ForeignKey("source_record.source_record_id"))
    total_holdings_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    long_term_holdings_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    short_term_holdings_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    net_transaction_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    long_term_net_transaction_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    short_term_net_transaction_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    long_term_valuation_change_usd_mn: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    is_preliminary: Mapped[bool | None] = mapped_column(Boolean)
    loaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("vintage_id","entity_id","period_id",name="ux_fact_grain"), Index("ix_fact_entity_period","vintage_id","entity_id","period_id"), Index("ix_fact_period_total","vintage_id","period_id","total_holdings_usd_mn"))

class ValidationRule(Base):
    __tablename__ = "validation_rule"
    validation_rule_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_code: Mapped[str] = mapped_column(String(50), unique=True)
    rule_name: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(10), default="ERROR")
    tolerance_value: Mapped[Decimal | None] = mapped_column(Numeric(20,6))
    tolerance_unit: Mapped[str | None] = mapped_column(String(30))
    rule_version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class ValidationRun(Base):
    __tablename__ = "validation_run"
    validation_run_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    vintage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dataset_vintage.vintage_id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    overall_status: Mapped[str] = mapped_column(String(10), default="RUNNING")
    validator_version: Mapped[str | None] = mapped_column(String(50))
    __table_args__ = (Index("ix_validation_vintage", "vintage_id", "started_at"),)

class ValidationResult(Base):
    __tablename__ = "validation_result"
    validation_result_id: Mapped[int] = mapped_column(BigIdentity, primary_key=True, autoincrement=True)
    validation_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("validation_run.validation_run_id"))
    validation_rule_id: Mapped[int] = mapped_column(ForeignKey("validation_rule.validation_rule_id"))
    result_status: Mapped[str] = mapped_column(String(10))
    checked_count: Mapped[int | None] = mapped_column(BigInteger)
    failed_count: Mapped[int | None] = mapped_column(BigInteger)
    evidence: Mapped[dict | None] = mapped_column(JsonType)
    message: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (UniqueConstraint("validation_run_id","validation_rule_id",name="ux_validation_run_rule"),)

class Table5Crosscheck(Base):
    __tablename__ = "table5_crosscheck"
    crosscheck_id: Mapped[int] = mapped_column(BigIdentity, primary_key=True, autoincrement=True)
    vintage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dataset_vintage.vintage_id"))
    entity_id: Mapped[int] = mapped_column(ForeignKey("holding_entity.entity_id"))
    period_id: Mapped[int] = mapped_column(ForeignKey("reporting_period.period_id"))
    table5_source_record_id: Mapped[int] = mapped_column(ForeignKey("source_record.source_record_id"))
    table3_value_usd_mn: Mapped[Decimal] = mapped_column(Numeric(20,3))
    table5_value_usd_bn: Mapped[Decimal] = mapped_column(Numeric(20,3))
    difference_usd_bn: Mapped[Decimal] = mapped_column(Numeric(20,6))
    is_pass: Mapped[bool] = mapped_column(Boolean)
    __table_args__ = (UniqueConstraint("vintage_id","entity_id","period_id",name="ux_table5_crosscheck_grain"), Index("ix_crosscheck_lookup","vintage_id","period_id","is_pass"))

class VintageConflict(Base):
    __tablename__ = "vintage_conflict"
    conflict_id: Mapped[int] = mapped_column(BigIdentity, primary_key=True, autoincrement=True)
    vintage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dataset_vintage.vintage_id"))
    entity_id: Mapped[int] = mapped_column(ForeignKey("holding_entity.entity_id"))
    period_id: Mapped[int] = mapped_column(ForeignKey("reporting_period.period_id"))
    preferred_source_record_id: Mapped[int] = mapped_column(ForeignKey("source_record.source_record_id"))
    alternate_source_record_id: Mapped[int] = mapped_column(ForeignKey("source_record.source_record_id"))
    field_name: Mapped[str] = mapped_column(String(50))
    preferred_value: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    alternate_value: Mapped[Decimal | None] = mapped_column(Numeric(20,3))
    resolution_code: Mapped[str] = mapped_column(String(30), default="PREFER_TABLE3")
    __table_args__ = (UniqueConstraint("vintage_id","entity_id","period_id","field_name",name="ux_vintage_conflict"), Index("ix_conflict_lookup","vintage_id","entity_id","period_id"))
