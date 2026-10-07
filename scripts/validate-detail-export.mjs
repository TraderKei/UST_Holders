import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(new URL('dashboard/public/data/tic.json', root), 'utf8'));
const page = await readFile(new URL('dashboard/app/page.tsx', root), 'utf8');

assert.equal(data.meta.sources.length, 3, 'Table 3, Table 5, Historical CSV links');
for (const source of data.meta.sources) {
  assert.match(source.url, /^https:\/\/ticdata\.treasury\.gov\//);
  assert.ok(source.file && source.downloaded_at && source.sha256);
}

const latest = data.meta.latest_month;
const recent = data.months.filter((month) => month <= latest).slice(-12).reverse();
assert.equal(recent.length, 12);
assert.equal(recent[0], latest);
for (let i = 1; i < recent.length; i += 1) assert.ok(recent[i] < recent[i - 1]);

const requiredCsvColumns = [
  'country_name', 'country_code', 'reference_month', 'for_treas_pos',
  'for_lt_treas_pos', 'for_st_treas_pos', 'for_treas_net',
  'for_lt_treas_net', 'for_st_treas_net', 'for_lt_treas_valchg',
  'comparison_change_usd_mn', 'comparison_change_pct', 'mom_change_usd_mn',
  'yoy_change_usd_mn', 'share_of_foreign_total_pct', 'long_term_share_pct',
  'other_adjustment_usd_mn', 'source_file', 'source_url', 'source_unit',
  'reference_month', 'is_preliminary',
];
for (const column of requiredCsvColumns) assert.ok(page.includes(`'${column}'`), `CSV column ${column}`);

for (const text of [
  '행 클릭: 상세', '비교 국가에 추가', '비교 국가에서 해제', '최대 5개까지',
  '최근 12개월', 'is_preliminary=null', '원본 → 화면 필드',
  '실소유자 국적', '수탁 소재국', '금융센터', '보유액 변화에는 순거래 외',
  '이후 수정', '시계열 단절', '발표일과 데이터 기준월',
  '새로고침 <small>모형</small>', 'Excel <small>모형</small>', 'Image <small>모형</small>',
  "v == null\n      ? 'N/A'",
]) assert.ok(page.includes(text), `UI contract: ${text}`);

console.log(`PASS detail/export: sources=3, recentMonths=${recent.length}, CSV columns=${requiredCsvColumns.length}`);
