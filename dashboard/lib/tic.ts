export type Value = number | null;
export type Country = {
  country_name: string;
  country_code: string;
  region: string | null;
  record_type: string;
};
export type Dataset = {
  meta: {
    latest_month: string;
    first_month: string;
    downloaded_at: string;
    status: string;
    cross_checks: number;
    base_unit?: string;
    table5_unit?: string;
    source_mode?: string;
    history_join?: string;
    transaction_start?: string;
    source_fields?: string[];
    record_columns?: string[];
    sources: {
      file: string;
      url: string;
      downloaded_at: string;
      sha256: string;
    }[];
  };
  countries: Country[];
  months: string[];
  records: (string | number | null)[][];
};
export type Row = Country & {
  reference_month: string;
  total_holdings_usd_mn: Value;
  long_term_holdings_usd_mn: Value;
  short_term_holdings_usd_mn: Value;
  net_transaction_usd_mn: Value;
  long_term_net_transaction_usd_mn: Value;
  short_term_net_transaction_usd_mn: Value;
  valuation_change_usd_mn: Value;
  source_table: string;
  source_file: string;
  source_url: string;
  source_unit: string;
  downloaded_at: string;
  is_preliminary: boolean | null;
  other_adjustment_usd_mn: Value;
  mom_change_usd_mn: Value;
  mom_change_pct: Value;
  yoy_change_usd_mn: Value;
  yoy_change_pct: Value;
  share_of_foreign_total_pct: Value;
  long_term_share_pct: Value;
  rank: number | null;
};
export const names: Record<string, string> = {
  Japan: '일본',
  'China, Mainland': '중국',
  'United Kingdom': '영국',
  'Korea, South': '한국',
  'Grand Total': '외국인 전체',
  Belgium: '벨기에',
  Canada: '캐나다',
  'Cayman Islands': '케이맨제도',
  Luxembourg: '룩셈부르크',
  France: '프랑스',
  Ireland: '아일랜드',
  Taiwan: '대만',
  Switzerland: '스위스',
  Singapore: '싱가포르',
  'Hong Kong': '홍콩',
  Norway: '노르웨이',
  India: '인도',
  Brazil: '브라질',
  'Saudi Arabia': '사우디아라비아',
  'United Arab Emirates': '아랍에미리트',
  Israel: '이스라엘',
  Germany: '독일',
  Australia: '호주',
  Mexico: '멕시코',
  Thailand: '태국',
  Bermuda: '버뮤다',
  'All Countries': '국가 전체',
  'Of Which: Foreign Official': '외국 공공부문',
  'Of Which: Foreign Non-Official': '외국 민간부문',
  International: '국제기구',
  'Total IROs': '국제·지역기구 합계',
};
export const label = (c: Country) => names[c.country_name] || c.country_name;
export const sub = (a: Value | undefined, b: Value | undefined): Value =>
  a == null || b == null ? null : a - b;
export const ratio = (a: Value | undefined, b: Value | undefined): Value =>
  a == null || b == null || b === 0 ? null : (a / b) * 100;
export function shift(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
export const colors: Record<string, string> = {
  '42609': '#65aaff',
  '41408': '#f2b75b',
  '13005': '#ab8df6',
  '43001': '#44d5bf',
  '99996': '#9aabba',
};
export function color(code: string) {
  return (
    colors[code] ||
    ['#65aaff', '#44d5bf', '#ab8df6', '#f2b75b', '#f18395', '#88bbd9'][
      Number(code) % 6
    ]
  );
}
export function makeModel(data: Dataset) {
  const countryMap = new Map(data.countries.map((c) => [c.country_code, c]));
  const map = new Map<string, Row>();
  for (const r of data.records) {
    const code = String(r[0]),
      month = String(r[1]),
      sourceIndex = r[9] === 1 ? 2 : 0,
      source = r[9] === 1 ? 'Historical SLT CSV' : 'TIC Table 3',
      sourceMeta = data.meta.sources[sourceIndex];
    map.set(code + '|' + month, {
      ...countryMap.get(code)!,
      reference_month: month,
      total_holdings_usd_mn: r[2] as Value,
      long_term_holdings_usd_mn: r[3] as Value,
      short_term_holdings_usd_mn: r[4] as Value,
      net_transaction_usd_mn: r[5] as Value,
      long_term_net_transaction_usd_mn: r[6] as Value,
      short_term_net_transaction_usd_mn: r[7] as Value,
      valuation_change_usd_mn: r[8] as Value,
      source_table: source,
      source_file: sourceMeta.file,
      source_url: sourceMeta.url,
      source_unit: 'USD million',
      downloaded_at: sourceMeta.downloaded_at,
      is_preliminary: null,
      other_adjustment_usd_mn: null,
      mom_change_usd_mn: null,
      mom_change_pct: null,
      yoy_change_usd_mn: null,
      yoy_change_pct: null,
      share_of_foreign_total_pct: null,
      long_term_share_pct: null,
      rank: null,
    });
  }
  const get = (code: string, month: string) => map.get(code + '|' + month);
  for (const r of map.values()) {
    const p = get(r.country_code, shift(r.reference_month, -1)),
      y = get(r.country_code, shift(r.reference_month, -12)),
      total = get('99996', r.reference_month);
    r.mom_change_usd_mn = sub(
      r.total_holdings_usd_mn,
      p?.total_holdings_usd_mn,
    );
    r.mom_change_pct = ratio(r.mom_change_usd_mn, p?.total_holdings_usd_mn);
    r.yoy_change_usd_mn = sub(
      r.total_holdings_usd_mn,
      y?.total_holdings_usd_mn,
    );
    r.yoy_change_pct = ratio(r.yoy_change_usd_mn, y?.total_holdings_usd_mn);
    r.share_of_foreign_total_pct = ratio(
      r.total_holdings_usd_mn,
      total?.total_holdings_usd_mn,
    );
    r.long_term_share_pct = ratio(
      r.long_term_holdings_usd_mn,
      r.total_holdings_usd_mn,
    );
    if (
      r.reference_month >= '2023-02' &&
      r.mom_change_usd_mn != null &&
      r.net_transaction_usd_mn != null &&
      r.valuation_change_usd_mn != null
    )
      r.other_adjustment_usd_mn =
        r.mom_change_usd_mn -
        r.net_transaction_usd_mn -
        r.valuation_change_usd_mn;
  }
  for (const m of data.months) {
    data.countries
      .map((c) => get(c.country_code, m))
      .filter(
        (r): r is Row =>
          !!r && r.record_type === 'country' && r.total_holdings_usd_mn != null,
      )
      .sort((a, b) => b.total_holdings_usd_mn! - a.total_holdings_usd_mn!)
      .forEach((r, i) => (r.rank = i + 1));
  }
  return {
    get,
    rows: (m: string) =>
      data.countries
        .map((c) => get(c.country_code, m))
        .filter((r): r is Row => !!r),
    series: (code: string, start: string, end: string) =>
      data.months
        .filter((m) => m >= start && m <= end)
        .map((m) => get(code, m)),
  };
}
