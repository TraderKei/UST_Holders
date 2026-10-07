import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'data', 'raw');
const outputPath = path.join(root, 'dashboard', 'public', 'data', 'tic.json');
const validationPath = path.join(root, 'data', 'validation.json');

const sourceFiles = ['slt_table3.txt', 'slt_table5.txt', 'slt3d_globl.csv'];
const sourceFields = [
  'for_treas_pos',
  'for_lt_treas_pos',
  'for_st_treas_pos',
  'for_treas_net',
  'for_lt_treas_net',
  'for_st_treas_net',
  'for_lt_treas_valchg',
];

const readRaw = (file) =>
  fs.readFileSync(path.join(rawDir, file), 'utf8').replace(/^\uFEFF/, '');

const sha256 = (file) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(rawDir, file)))
    .digest('hex')
    .toUpperCase();

export const numeric = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseCsvLine = (line) => {
  const output = [];
  let token = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        token += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      output.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  output.push(token);
  return output;
};

const classify = (name) => {
  if (/^(Grand Total|All Countries)$/i.test(name)) return 'total';
  if (/^(International|Total Regional Orgs\.|Total IROs|Of Which:|Of which )/i.test(name)) {
    return 'institution';
  }
  if (/^(Total |Memo:)/i.test(name)) return 'region';
  if (/^Country Unknown$/i.test(name)) return 'institution';
  return 'country';
};

const regionStarts = new Map([
  ['Austria', '유럽'],
  ['Canada', '북미'],
  ['Argentina', '중남미'],
  ['Barbados', '카리브'],
  ['Afghanistan', '아시아'],
  ['China, Mainland', '아시아'],
  ['Algeria', '아프리카'],
  ['Liberia', '아프리카'],
  ['Australia', '오세아니아'],
]);

const manifest = JSON.parse(readRaw('manifest.json'));
const manifestByFile = new Map(manifest.map((entry) => [entry.file, entry]));
const sources = sourceFiles.map((file) => {
  const entry = manifestByFile.get(file);
  if (!entry?.url || !entry?.downloaded_at || !entry?.sha256) {
    throw new Error(`Manifest entry is incomplete: ${file}`);
  }
  const actualHash = sha256(file);
  if (actualHash !== String(entry.sha256).toUpperCase()) {
    throw new Error(`SHA-256 mismatch: ${file}`);
  }
  return {...entry, sha256: actualHash};
});

const table3Lines = readRaw('slt_table3.txt').split(/\r?\n/);
const table3HeaderIndex = table3Lines.findIndex((line) => {
  const columns = line.split('\t').map((column) => column.trim());
  return columns[0] === 'country' && columns[1] === 'country_code' && columns[2] === 'date';
});
if (table3HeaderIndex < 0) throw new Error('Table 3 system header missing');

const table3Header = table3Lines[table3HeaderIndex]
  .split('\t')
  .map((column) => column.trim());
const table3Column = Object.fromEntries(
  table3Header.map((name, index) => [name, index]),
);
for (const field of ['country', 'country_code', 'date', ...sourceFields]) {
  if (table3Column[field] == null) throw new Error(`Table 3 field missing: ${field}`);
}

const table3Rows = table3Lines
  .slice(table3HeaderIndex + 1)
  .map((line) => line.split('\t'))
  .filter((columns) => /^\d{4}-\d{2}$/.test(columns[table3Column.date]?.trim()));

const entities = new Map();
const normalizeEntityName = (name) =>
  name.toLowerCase().replaceAll(':', '').replace(/\s+/g, ' ').trim();
const registerEntity = (name, code, region) => {
  const existing = entities.get(code);
  if (existing) {
    if (normalizeEntityName(existing.country_name) !== normalizeEntityName(name)) {
      throw new Error(
        `Conflicting entity name for TIC code ${code}: ${existing.country_name} / ${name}`,
      );
    }
    return;
  }
  const recordType = classify(name);
  entities.set(code, {
    country_name: name,
    country_code: code,
    region: recordType === 'country' ? region : null,
    record_type: recordType,
    rank_eligible: recordType === 'country',
  });
};

let table3Region = '유럽';
for (const columns of table3Rows) {
  const name = columns[table3Column.country].trim();
  const code = columns[table3Column.country_code].trim();
  table3Region = regionStarts.get(name) ?? table3Region;
  registerEntity(name, code, table3Region);
}

const records = table3Rows.map((columns) => [
  columns[table3Column.country_code].trim(),
  columns[table3Column.date].trim(),
  ...sourceFields.map((field) => numeric(columns[table3Column[field]])),
  0,
]);
const current = new Map(
  records.map((record) => [`${record[0]}|${record[1]}`, record]),
);

let historicalRegion = '유럽';
let overlapRows = 0;
let overlapDifferences = 0;
let historicalRows = 0;
const historicalOnlyEntities = new Set();

for (const line of readRaw('slt3d_globl.csv').split(/\r?\n/)) {
  const columns = parseCsvLine(line);
  const [name, code, month] = columns;
  if (!/^\d{4}-\d{2}$/.test(month ?? '') || !/^\d+$/.test(code ?? '')) continue;

  historicalRegion = regionStarts.get(name) ?? historicalRegion;
  if (!entities.has(code)) historicalOnlyEntities.add(code);
  registerEntity(name, code, historicalRegion);

  const key = `${code}|${month}`;
  if (current.has(key)) {
    overlapRows += 1;
    if (current.get(key)[2] !== numeric(columns[3])) overlapDifferences += 1;
    continue;
  }
  if (month >= '2020-01') continue;

  records.push([
    code,
    month,
    numeric(columns[3]),
    numeric(columns[4]),
    numeric(columns[5]),
    null,
    null,
    null,
    null,
    1,
  ]);
  historicalRows += 1;
}

records.sort(
  (left, right) =>
    String(left[1]).localeCompare(String(right[1])) ||
    String(left[0]).localeCompare(String(right[0])),
);
const months = [...new Set(records.map((record) => record[1]))].sort();

const table5Rows = readRaw('slt_table5.txt')
  .split(/\r?\n/)
  .map((line) => line.split('\t'));
const table5Header = table5Rows.find((columns) => columns[0]?.trim() === 'Country');
if (!table5Header) throw new Error('Table 5 header missing');
const table5Months = table5Header
  .slice(1)
  .map((month) => month.trim())
  .filter(Boolean);
if (!table5Months.length || table5Months.some((month) => !/^\d{4}-\d{2}$/.test(month))) {
  throw new Error('Table 5 month header is invalid');
}

const codeByName = new Map(
  [...entities.values()].map((entity) => [
    entity.country_name.toLowerCase(),
    entity.country_code,
  ]),
);
const crossChecks = [];
for (const columns of table5Rows) {
  const name = columns[0]?.trim();
  const code = codeByName.get(name?.toLowerCase());
  if (!code) continue;
  table5Months.forEach((month, index) => {
    const table3Record = current.get(`${code}|${month}`);
    const table5Value = numeric(columns[index + 1]);
    if (!table3Record || table3Record[2] == null || table5Value == null) return;
    const table3Value = table3Record[2] / 1000;
    crossChecks.push({
      country: name,
      country_code: code,
      month,
      table3_bn: table3Value,
      table5_bn: table5Value,
      difference_bn: table3Value - table5Value,
      pass: Math.abs(table3Value - table5Value) <= 0.051,
    });
  });
}

if (table5Months[0] !== months.at(-1)) {
  throw new Error(
    `Latest month mismatch: Table 3 ${months.at(-1)} / Table 5 ${table5Months[0]}`,
  );
}
if (!crossChecks.length || crossChecks.some((check) => !check.pass)) {
  throw new Error('Table 3 / Table 5 cross-check failed');
}

const countries = [...entities.values()];
const countsByRecordType = Object.fromEntries(
  ['country', 'region', 'institution', 'total'].map((type) => [
    type,
    countries.filter((entity) => entity.record_type === type).length,
  ]),
);

const data = {
  meta: {
    schema_version: 2,
    latest_month: months.at(-1),
    first_month: months[0],
    downloaded_at: sources[0].downloaded_at,
    source_mode: 'local_snapshot',
    sources,
    base_unit: 'USD million',
    table5_unit: 'USD billion',
    source_fields: sourceFields,
    record_columns: [
      'country_code',
      'reference_month',
      ...sourceFields,
      'source_index',
    ],
    comparison_lags_months: [1, 3, 6, 12],
    derived_fields: {
      change: 'current total holdings - exact lag-month total holdings',
      change_pct: 'change / exact lag-month total holdings * 100',
      share_of_grand_total_pct: 'entity total holdings / Grand Total * 100',
      long_term_share_pct: 'long-term holdings / total holdings * 100',
      short_term_share_pct: 'short-term holdings / total holdings * 100',
      rank: 'descending total holdings among record_type=country only',
      other_adjustment_usd_mn:
        'monthly change - net transactions - long-term valuation change',
      null_rule: 'missing comparison month, missing operand, or zero denominator => null',
    },
    ranking_record_type: 'country',
    is_preliminary: null,
    status: '최신 수집본 · 수정 가능 · 잠정 여부 미표기',
    history_join: '2020-01',
    transaction_start: '2023-02',
    overlap_rows: overlapRows,
    overlap_differences: overlapDifferences,
    cross_checks: crossChecks.length,
    row_counts_by_source: {
      table3: table3Rows.length,
      historical_before_2020: historicalRows,
    },
    historical_only_entities: historicalOnlyEntities.size,
  },
  countries,
  months,
  records,
};

const preparationReport = {
  status: 'PREPARED',
  latest_month: data.meta.latest_month,
  first_month: data.meta.first_month,
  rows: records.length,
  entities: countries.length,
  counts_by_record_type: countsByRecordType,
  overlap_rows: overlapRows,
  overlap_differences: overlapDifferences,
  table3_table5: {
    latest_month: table5Months[0],
    tolerance_bn: 0.051,
    comparisons: crossChecks,
  },
};

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, JSON.stringify(data));
fs.writeFileSync(validationPath, JSON.stringify(preparationReport, null, 2));

console.log(
  JSON.stringify({
    latest: data.meta.latest_month,
    first: data.meta.first_month,
    rows: records.length,
    entities: countries.length,
    crossChecks: crossChecks.length,
    overlapDifferences,
  }),
);
