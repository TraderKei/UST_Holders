import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'data', 'raw');
const dataPath = path.join(root, 'dashboard', 'public', 'data', 'tic.json');
const validationPath = path.join(root, 'data', 'validation.json');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(rawDir, 'manifest.json'), 'utf8'));
const preparation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));

const readRaw = (file) =>
  fs.readFileSync(path.join(rawDir, file), 'utf8').replace(/^\uFEFF/, '');
const sha256 = (file) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(rawDir, file)))
    .digest('hex')
    .toUpperCase();

const numeric = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const shift = (month, amount) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
    .toISOString()
    .slice(0, 7);
};
const subtract = (left, right) => (left == null || right == null ? null : left - right);
const ratio = (numerator, denominator) =>
  numerator == null || denominator == null || denominator === 0
    ? null
    : (numerator / denominator) * 100;

const recordColumn = Object.fromEntries(
  data.meta.record_columns.map((name, index) => [name, index]),
);
const recordKey = (code, month) => `${code}|${month}`;
const recordMap = new Map(
  data.records.map((record) => [
    recordKey(String(record[recordColumn.country_code]), String(record[recordColumn.reference_month])),
    record,
  ]),
);
const entityMap = new Map(
  data.countries.map((entity) => [entity.country_code, entity]),
);
const value = (record, field) =>
  record == null ? null : record[recordColumn[field]];
const get = (code, month) => recordMap.get(recordKey(code, month));

const checks = [];
const check = (name, condition, evidence) => {
  checks.push({name, pass: Boolean(condition), evidence});
};

const expectedSources = new Map([
  [
    'slt_table3.txt',
    'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt',
  ],
  [
    'slt_table5.txt',
    'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt',
  ],
  [
    'slt3d_globl.csv',
    'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt3d_globl.csv',
  ],
]);
const manifestChecks = manifest.map((entry) => ({
  file: entry.file,
  url_matches: expectedSources.get(entry.file) === entry.url,
  sha256_matches: sha256(entry.file) === String(entry.sha256).toUpperCase(),
  downloaded_at_present: Boolean(entry.downloaded_at),
}));
check(
  '원본 manifest URL·다운로드 시각·SHA-256',
  manifestChecks.length === expectedSources.size &&
    manifestChecks.every(
      (item) => item.url_matches && item.sha256_matches && item.downloaded_at_present,
    ),
  manifestChecks,
);

const sourceFields = data.meta.source_fields;
const table3Lines = readRaw('slt_table3.txt').split(/\r?\n/);
const table3HeaderIndex = table3Lines.findIndex((line) => {
  const columns = line.split('\t').map((column) => column.trim());
  return columns[0] === 'country' && columns[1] === 'country_code' && columns[2] === 'date';
});
check('Table 3 시스템 헤더 탐색', table3HeaderIndex >= 0, table3HeaderIndex);

const table3Header =
  table3HeaderIndex >= 0
    ? table3Lines[table3HeaderIndex].split('\t').map((column) => column.trim())
    : [];
const table3Column = Object.fromEntries(
  table3Header.map((name, index) => [name, index]),
);
const requiredTable3Fields = ['country', 'country_code', 'date', ...sourceFields];
check(
  'Table 3 필수 필드',
  requiredTable3Fields.every((field) => table3Column[field] != null),
  requiredTable3Fields.filter((field) => table3Column[field] == null),
);

const table3Rows =
  table3HeaderIndex < 0
    ? []
    : table3Lines
        .slice(table3HeaderIndex + 1)
        .map((line) => line.split('\t'))
        .filter((columns) => /^\d{4}-\d{2}$/.test(columns[table3Column.date]?.trim()));
const table3Months = table3Rows
  .map((columns) => columns[table3Column.date].trim())
  .sort();
const table3Latest = table3Months.at(-1);

const table5Rows = readRaw('slt_table5.txt')
  .split(/\r?\n/)
  .map((line) => line.split('\t'));
const table5Header = table5Rows.find((columns) => columns[0]?.trim() === 'Country');
const table5Months = (table5Header ?? [])
  .slice(1)
  .map((month) => month.trim())
  .filter(Boolean);
const table5Latest = table5Months[0];
check(
  '최신 기준월 Table 3 = Table 5 = tic.json',
  Boolean(table3Latest) &&
    table3Latest === table5Latest &&
    table3Latest === data.meta.latest_month &&
    data.meta.latest_month === data.months.at(-1),
  {
    table3: table3Latest,
    table5: table5Latest,
    tic_json: data.meta.latest_month,
  },
);

let rawNullValues = 0;
let fidelityMismatches = 0;
for (const columns of table3Rows) {
  const code = columns[table3Column.country_code].trim();
  const month = columns[table3Column.date].trim();
  const outputRecord = get(code, month);
  if (!outputRecord || value(outputRecord, 'source_index') !== 0) {
    fidelityMismatches += 1;
    continue;
  }
  for (const field of sourceFields) {
    const expected = numeric(columns[table3Column[field]]);
    if (expected == null) rawNullValues += 1;
    if (value(outputRecord, field) !== expected) fidelityMismatches += 1;
  }
}
check(
  'Table 3 원본 값과 출력 레코드 일치',
  table3Rows.length > 0 && fidelityMismatches === 0,
  {rows: table3Rows.length, mismatches: fidelityMismatches},
);
check(
  '결측값 null 보존 및 0 비대체',
  rawNullValues > 0 &&
    data.records.some((record) =>
      sourceFields.some((field) => value(record, field) === null),
    ),
  {table3_null_values: rawNullValues},
);

const currentNameToCode = new Map(
  table3Rows.map((columns) => [
    columns[table3Column.country].trim().toLowerCase(),
    columns[table3Column.country_code].trim(),
  ]),
);
const crossChecks = [];
for (const columns of table5Rows) {
  const countryName = columns[0]?.trim();
  const code = currentNameToCode.get(countryName?.toLowerCase());
  if (!code) continue;
  table5Months.forEach((month, index) => {
    const table3Value = value(get(code, month), 'for_treas_pos');
    const table5Value = numeric(columns[index + 1]);
    if (table3Value == null || table5Value == null) return;
    const difference = table3Value / 1000 - table5Value;
    crossChecks.push({
      country: countryName,
      country_code: code,
      month,
      table3_bn: table3Value / 1000,
      table5_bn: table5Value,
      difference_bn: difference,
      pass: Math.abs(difference) <= 0.051,
    });
  });
}
const failedCrossChecks = crossChecks.filter((item) => !item.pass);
check(
  'Table 3 ↔ Table 5 주요 값',
  crossChecks.length > 0 &&
    failedCrossChecks.length === 0 &&
    data.meta.cross_checks === crossChecks.length,
  {
    comparisons: crossChecks.length,
    failures: failedCrossChecks.length,
    tolerance_bn: 0.051,
  },
);

const totalCodes = {
  grandTotal: '99996',
  allCountries: '69995',
  totalIros: '79995',
};
let grandTotalComparisons = 0;
const grandTotalMismatches = [];
for (const month of data.months) {
  const grandTotal = value(get(totalCodes.grandTotal, month), 'for_treas_pos');
  const allCountries = value(get(totalCodes.allCountries, month), 'for_treas_pos');
  const totalIros = value(get(totalCodes.totalIros, month), 'for_treas_pos');
  if (grandTotal == null || allCountries == null || totalIros == null) continue;
  grandTotalComparisons += 1;
  if (Math.abs(grandTotal - allCountries - totalIros) > 1) {
    grandTotalMismatches.push({month, grandTotal, allCountries, totalIros});
  }
}
const latestGrandTotal = value(
  get(totalCodes.grandTotal, data.meta.latest_month),
  'for_treas_pos',
);
const latestAllCountries = value(
  get(totalCodes.allCountries, data.meta.latest_month),
  'for_treas_pos',
);
const latestTotalIros = value(
  get(totalCodes.totalIros, data.meta.latest_month),
  'for_treas_pos',
);
check(
  '최신월 Grand Total = All Countries + Total IROs',
  latestGrandTotal != null &&
    latestAllCountries != null &&
    latestTotalIros != null &&
    Math.abs(latestGrandTotal - latestAllCountries - latestTotalIros) <= 1,
  {
    month: data.meta.latest_month,
    grand_total: latestGrandTotal,
    all_countries: latestAllCountries,
    total_iros: latestTotalIros,
    tolerance_usd_mn: 1,
  },
);
const warnings = [];
if (grandTotalMismatches.length) {
  warnings.push({
    name: 'Historical 원본 Grand Total 항등식 예외',
    evidence: {
      comparisons: grandTotalComparisons,
      mismatches: grandTotalMismatches,
      note: '공식 Historical CSV 값을 보정하지 않고 원문 그대로 보존',
    },
  });
}

const compositionRows = data.records.filter(
  (record) =>
    value(record, 'for_treas_pos') != null &&
    value(record, 'for_lt_treas_pos') != null &&
    value(record, 'for_st_treas_pos') != null,
);
const compositionMismatches = compositionRows.filter(
  (record) =>
    Math.abs(
      value(record, 'for_treas_pos') -
        value(record, 'for_lt_treas_pos') -
        value(record, 'for_st_treas_pos'),
    ) > 1,
);
check(
  '장기채 + 단기채 = 총보유액',
  compositionRows.length > 0 && compositionMismatches.length === 0,
  {
    comparisons: compositionRows.length,
    mismatches: compositionMismatches.length,
    tolerance_usd_mn: 1,
  },
);

const expectedTypes = ['country', 'region', 'institution', 'total'];
const countsByRecordType = Object.fromEntries(
  expectedTypes.map((type) => [
    type,
    data.countries.filter((entity) => entity.record_type === type).length,
  ]),
);
check(
  '국가·지역·기관·합계 분류',
  expectedTypes.every((type) => countsByRecordType[type] > 0),
  countsByRecordType,
);
check(
  '국가명과 TIC 코드 보존',
  data.countries.every(
    (entity) =>
      typeof entity.country_name === 'string' &&
      entity.country_name.length > 0 &&
      /^\d+$/.test(entity.country_code),
  ) &&
    data.records.every((record) =>
      entityMap.has(String(value(record, 'country_code'))),
    ),
  {entities: data.countries.length, records: data.records.length},
);

const rankEligibilityMismatches = data.countries.filter(
  (entity) => entity.rank_eligible !== (entity.record_type === 'country'),
);
const latestRankCandidates = data.records.filter((record) => {
  const entity = entityMap.get(String(value(record, 'country_code')));
  return (
    value(record, 'reference_month') === data.meta.latest_month &&
    entity?.rank_eligible &&
    value(record, 'for_treas_pos') != null
  );
});
const aggregateRankCandidates = latestRankCandidates.filter(
  (record) =>
    entityMap.get(String(value(record, 'country_code')))?.record_type !== 'country',
);
check(
  '합계·지역·기관 행은 국가 순위에서 제외',
  data.meta.ranking_record_type === 'country' &&
    rankEligibilityMismatches.length === 0 &&
    aggregateRankCandidates.length === 0,
  {
    latest_country_candidates: latestRankCandidates.length,
    eligibility_mismatches: rankEligibilityMismatches.length,
    aggregate_candidates: aggregateRankCandidates.length,
  },
);

check(
  '기준 단위와 잠정치 메타데이터',
  data.meta.base_unit === 'USD million' &&
    data.meta.table5_unit === 'USD billion' &&
    data.meta.is_preliminary === null,
  {
    base_unit: data.meta.base_unit,
    table5_unit: data.meta.table5_unit,
    is_preliminary: data.meta.is_preliminary,
  },
);
check(
  '시계열 연결 및 거래·평가 시작 메타데이터',
  /^\d{4}-\d{2}$/.test(data.meta.history_join) &&
    /^\d{4}-\d{2}$/.test(data.meta.transaction_start),
  {
    history_join: data.meta.history_join,
    transaction_start: data.meta.transaction_start,
  },
);
check(
  '파생지표 지연월과 null 규칙',
  JSON.stringify(data.meta.comparison_lags_months) === JSON.stringify([1, 3, 6, 12]) &&
    Boolean(data.meta.derived_fields?.other_adjustment_usd_mn) &&
    ratio(1, 0) === null &&
    subtract(1, null) === null,
  {
    comparison_lags_months: data.meta.comparison_lags_months,
    zero_denominator_result: ratio(1, 0),
    missing_comparison_result: subtract(1, null),
  },
);

const derivedCoverage = {
  changes: {},
  share_of_grand_total_pct: {values: 0, nulls: 0},
  long_term_share_pct: {values: 0, nulls: 0},
  short_term_share_pct: {values: 0, nulls: 0},
  other_adjustment_usd_mn: {values: 0, nulls: 0},
};
for (const lag of data.meta.comparison_lags_months) {
  derivedCoverage.changes[lag] = {
    amount_values: 0,
    amount_nulls: 0,
    pct_values: 0,
    pct_nulls: 0,
  };
}

for (const record of data.records) {
  const code = String(value(record, 'country_code'));
  const month = String(value(record, 'reference_month'));
  const holdings = value(record, 'for_treas_pos');
  for (const lag of data.meta.comparison_lags_months) {
    const previous = value(get(code, shift(month, -lag)), 'for_treas_pos');
    const amount = subtract(holdings, previous);
    const percent = ratio(amount, previous);
    derivedCoverage.changes[lag][amount == null ? 'amount_nulls' : 'amount_values'] += 1;
    derivedCoverage.changes[lag][percent == null ? 'pct_nulls' : 'pct_values'] += 1;
  }

  const grandTotal = value(get(totalCodes.grandTotal, month), 'for_treas_pos');
  const share = ratio(holdings, grandTotal);
  derivedCoverage.share_of_grand_total_pct[share == null ? 'nulls' : 'values'] += 1;

  const longTermShare = ratio(value(record, 'for_lt_treas_pos'), holdings);
  derivedCoverage.long_term_share_pct[longTermShare == null ? 'nulls' : 'values'] += 1;

  const shortTermShare = ratio(value(record, 'for_st_treas_pos'), holdings);
  derivedCoverage.short_term_share_pct[shortTermShare == null ? 'nulls' : 'values'] += 1;

  const monthlyChange = subtract(
    holdings,
    value(get(code, shift(month, -1)), 'for_treas_pos'),
  );
  const residual =
    month >= data.meta.transaction_start &&
    monthlyChange != null &&
    value(record, 'for_treas_net') != null &&
    value(record, 'for_lt_treas_valchg') != null
      ? monthlyChange -
        value(record, 'for_treas_net') -
        value(record, 'for_lt_treas_valchg')
      : null;
  derivedCoverage.other_adjustment_usd_mn[residual == null ? 'nulls' : 'values'] += 1;
}
check(
  '파생지표 계산 구조',
  Object.values(derivedCoverage.changes).every(
    (coverage) => coverage.amount_values > 0 && coverage.pct_values > 0,
  ) &&
    derivedCoverage.share_of_grand_total_pct.values > 0 &&
    derivedCoverage.long_term_share_pct.values > 0 &&
    derivedCoverage.short_term_share_pct.values > 0 &&
    derivedCoverage.other_adjustment_usd_mn.values > 0,
  derivedCoverage,
);

const status = checks.every((item) => item.pass) ? 'PASS' : 'FAIL';
const report = {
  status,
  validated_at: new Date().toISOString(),
  latest_month: data.meta.latest_month,
  first_month: data.meta.first_month,
  rows: data.records.length,
  entities: data.countries.length,
  counts_by_record_type: countsByRecordType,
  overlap_rows: data.meta.overlap_rows,
  overlap_differences: data.meta.overlap_differences,
  manifest: manifestChecks,
  checks,
  warnings,
  derived_metric_coverage: derivedCoverage,
  table3_table5: {
    latest_month: table5Latest,
    tolerance_bn: 0.051,
    comparisons: crossChecks,
  },
  preparation_status: preparation.status,
};

fs.writeFileSync(validationPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      status,
      latest: report.latest_month,
      first: report.first_month,
      rows: report.rows,
      entities: report.entities,
      checks: checks.map(({name, pass, evidence}) => ({name, pass, evidence})),
    },
    null,
    2,
  ),
);

if (status !== 'PASS') {
  const failed = checks.filter((item) => !item.pass).map((item) => item.name);
  throw new Error(`Data validation failed: ${failed.join(', ')}`);
}
