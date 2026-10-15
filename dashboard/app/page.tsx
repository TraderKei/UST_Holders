'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ChartNoAxesCombined,
  ChevronRight,
  Database,
  ExternalLink,
  Info,
  RefreshCw,
  Search,
  Settings2,
  X,
  Maximize2,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  makeModel,
  label,
  color,
  shift,
  sub,
  ratio,
  type Dataset,
  type Row,
  type Value,
} from '@/lib/tic';
import { Spark, TimeChart, Waterfall } from '@/components/tic-charts';
const initial = ['42609', '41408', '13005', '43001', '99996'];
const periods = [
  ['1Y', '12'],
  ['3Y', '36'],
  ['5Y', '60'],
  ['10Y', '120'],
  ['MAX', '999'],
];
const metrics = [
  ['hold', '보유액'],
  ['change', '증감액'],
  ['pct', '증감률'],
  ['share', '전체 대비 비중'],
  ['net', '순매입·순매도'],
];
function Pick({
  value,
  onChange,
  options,
  aria,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[][];
  aria: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
    >
      <SelectTrigger aria-label={aria}>
        <SelectValue>
          {options.find((o) => o[0] === value)?.[1] || value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger aria-label="지표 설명" className="info-trigger">
        <Info size={13} />
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}
const sign = (v: Value | undefined) =>
  v == null ? 'neutral' : v > 0 ? 'up' : v < 0 ? 'down' : 'neutral';
const direction = (v: Value | undefined) =>
  v == null ? '' : v > 0 ? '▲ +' : v < 0 ? '▼ −' : '─ ';
export default function Home() {
  const [data, setData] = useState<Dataset | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    fetch('/data/tic.json')
      .then((r) => {
        if (!r.ok) throw Error('데이터 스냅샷을 읽지 못했습니다.');
        return r.json();
      })
      .then((d) => setData(d as Dataset))
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <TooltipProvider>
      {data ? (
        <Dashboard data={data} />
      ) : (
        <main className="loading">
          <Activity />
          <h1>국가별 미국 국채 보유현황</h1>
          <p>{error || '미국 재무부 TIC 스냅샷을 불러오는 중입니다.'}</p>
          {error && (
            <button onClick={() => location.reload()}>다시 시도</button>
          )}
        </main>
      )}
    </TooltipProvider>
  );
}
export function DashboardPage({ data }: { data: Dataset }) {
  return <TooltipProvider><Dashboard data={data} /></TooltipProvider>;
}

function Dashboard({ data }: { data: Dataset }) {
  const model = useMemo(() => makeModel(data), [data]);
  const [month, setMonth] = useState(data.meta.latest_month),
    [period, setPeriod] = useState('60'),
    [unit, setUnit] = useState('bn'),
    [lag, setLag] = useState('1'),
    [metric, setMetric] = useState('hold'),
    [query, setQuery] = useState(''),
    [region, setRegion] = useState('all'),
    [group, setGroup] = useState('country'),
    [mover, setMover] = useState('all');
  const [selected, setSelected] = useState(initial),
    [hidden, setHidden] = useState<string[]>([]),
    [indexed, setIndexed] = useState(false),
    [zoom, setZoom] = useState<string[] | null>(null),
    [drawer, setDrawer] = useState<string | null>(null),
    [sort, setSort] = useState('hold'),
    [asc, setAsc] = useState(false),
    [flowCode, setFlowCode] = useState('42609'),
    [rankPct, setRankPct] = useState(false),
    [expanded, setExpanded] = useState(false),
    [notice, setNotice] = useState(''),
    [columns, setColumns] = useState([
      'hold',
      'change',
      'pct',
      'yoypct',
      'share',
      'spark',
    ]);
  const divisor = unit === 'bn' ? 1000 : 1,
    unitLabel = `USD ${unit}`,
    compare = shift(month, -Number(lag));
  const collectedAt = new Date(data.meta.downloaded_at).toLocaleString(
    'sv-SE',
    { timeZone: 'Asia/Seoul' },
  );
  const fmt = (v: Value | undefined, percent = false) =>
    v == null
      ? 'N/A'
      : (percent ? v : v / divisor).toLocaleString('en-US', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  const signed = (v: Value | undefined, percent = false) =>
    v == null
      ? 'N/A'
      : direction(v) + fmt(Math.abs(v), percent) + (percent ? '%' : '');
  const all = model.rows(month),
    countryRows = all.filter((r) => r.record_type === 'country');
  const total = model.get('99996', month)!,
    official = model.get('99990', month);
  const amount = (r: Row) =>
    sub(
      r.total_holdings_usd_mn,
      model.get(r.country_code, compare)?.total_holdings_usd_mn,
    );
  const changePct = (r: Row) =>
    ratio(amount(r), model.get(r.country_code, compare)?.total_holdings_usd_mn);
  const window12 = (r: Row) =>
    model
      .series(r.country_code, shift(month, -11), month)
      .map((x) => x?.total_holdings_usd_mn ?? null);
  const extremes = (r: Row, high: boolean) => {
    const v = window12(r).filter((v): v is number => v != null);
    return v.length ? (high ? Math.max(...v) : Math.min(...v)) : null;
  };
  const metricVal = (r: Row): Value =>
    metric === 'hold'
      ? r.total_holdings_usd_mn
      : metric === 'change'
        ? amount(r)
        : metric === 'pct'
          ? changePct(r)
          : metric === 'share'
            ? r.share_of_foreign_total_pct
            : r.net_transaction_usd_mn;
  const defs = [
    {
      id: 'hold',
      name: '현재 보유액',
      get: (r: Row) => r.total_holdings_usd_mn,
    },
    {
      id: 'prev',
      name: '전월 보유액',
      get: (r: Row) =>
        model.get(r.country_code, shift(month, -1))?.total_holdings_usd_mn ??
        null,
    },
    {
      id: 'change',
      name: `비교 기준 증감 (${lag === '1' ? '전월' : lag + '개월'})`,
      get: amount,
      delta: true,
    },
    {
      id: 'pct',
      name: `비교 기준 증감률 (${lag === '1' ? '전월' : lag + '개월'})`,
      get: changePct,
      pct: true,
      delta: true,
    },
    {
      id: 'mom',
      name: '전월 증감',
      get: (r: Row) => r.mom_change_usd_mn,
      delta: true,
    },
    {
      id: 'mompct',
      name: '전월 증감률',
      get: (r: Row) => r.mom_change_pct,
      pct: true,
      delta: true,
    },
    {
      id: 'year',
      name: '전년 동월 보유액',
      get: (r: Row) =>
        model.get(r.country_code, shift(month, -12))?.total_holdings_usd_mn ??
        null,
    },
    {
      id: 'yoy',
      name: '전년 증감',
      get: (r: Row) => r.yoy_change_usd_mn,
      delta: true,
    },
    {
      id: 'yoypct',
      name: '전년 증감률',
      get: (r: Row) => r.yoy_change_pct,
      pct: true,
      delta: true,
    },
    {
      id: 'share',
      name: '점유율',
      get: (r: Row) => r.share_of_foreign_total_pct,
      pct: true,
    },
    { id: 'lt', name: '장기채', get: (r: Row) => r.long_term_holdings_usd_mn },
    { id: 'st', name: '단기채', get: (r: Row) => r.short_term_holdings_usd_mn },
    {
      id: 'ltpct',
      name: '장기채 비중',
      get: (r: Row) => r.long_term_share_pct,
      pct: true,
    },
    { id: 'high', name: '12M 최고', get: (r: Row) => extremes(r, true) },
    { id: 'low', name: '12M 최저', get: (r: Row) => extremes(r, false) },
    {
      id: 'net',
      name: '월 순거래',
      get: (r: Row) => r.net_transaction_usd_mn,
      delta: true,
    },
    { id: 'spark', name: '12M 추세', get: () => null },
  ];
  const matches = (r: Row) =>
    (region === 'all' || r.region === region || r.record_type !== 'country') &&
    (!query ||
      `${label(r)} ${r.country_name} ${r.country_code}`
        .toLowerCase()
        .includes(query.toLowerCase())) &&
    (group !== 'selected' || selected.includes(r.country_code));
  const scope = countryRows.filter(matches);
  const filtered = all.filter((r) => {
    const inGroup =
      group === 'regions'
        ? r.record_type === 'region'
        : group === 'aggregates'
          ? r.record_type === 'institution' || r.record_type === 'total'
          : r.record_type === 'country';
    return inGroup && matches(r);
  });
  const sorting = (a: Row, b: Row) => {
    const def = defs.find((c) => c.id === sort);
    const av = sort === 'metric' ? metricVal(a) : def?.get(a),
      bv = sort === 'metric' ? metricVal(b) : def?.get(b);
    if (av == null && bv == null)
      return a.country_name.localeCompare(b.country_name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * (asc ? 1 : -1);
  };
  let tableRows = [...filtered].sort(sorting);
  if (mover !== 'all')
    tableRows = filtered
      .filter(
        (r) =>
          amount(r) != null &&
          (mover === 'up' ? amount(r)! > 0 : amount(r)! < 0),
      )
      .sort((a, b) => (amount(a)! - amount(b)!) * (mover === 'up' ? -1 : 1))
      .slice(0, 10);
  const tableTitle =
    group === 'regions'
      ? '지역 합계'
      : group === 'aggregates'
        ? '기관·전체 합계'
        : group === 'selected'
          ? '선택 국가'
          : '국가별 보유 순위';
  const leader = [...countryRows]
    .filter((r) => r.rank != null)
    .sort((a, b) => a.rank! - b.rank!)[0];
  const monthly = [...countryRows]
    .filter((r) => r.mom_change_usd_mn != null)
    .sort((a, b) => b.mom_change_usd_mn! - a.mom_change_usd_mn!);
  const gain = monthly.find((r) => r.mom_change_usd_mn! > 0),
    loss = [...monthly].reverse().find((r) => r.mom_change_usd_mn! < 0);
  const start =
      zoom?.[0] ||
      (period === '999'
        ? data.meta.first_month
        : shift(month, -Number(period) + 1)),
    end = zoom?.[1] || month;
  const chartMonths = data.months.filter((m) => m >= start && m <= end);
  const active = selected.filter((c) => !hidden.includes(c));
  const plots = active.map((code) => {
    const rows = chartMonths.map((m) => model.get(code, m));
    const metricValues = rows.map((r, i) => {
      if (!r) return null;
      const base = model.get(
        code,
        shift(chartMonths[i], -Number(lag)),
      )?.total_holdings_usd_mn;
      const change = sub(r.total_holdings_usd_mn, base);
      return metric === 'hold'
        ? r.total_holdings_usd_mn
        : metric === 'change'
          ? change
          : metric === 'pct'
            ? ratio(change, base)
            : metric === 'share'
              ? r.share_of_foreign_total_pct
              : r.net_transaction_usd_mn;
    });
    const first = metricValues[0];
    const display = metricValues.map((v) =>
      v == null
        ? null
        : metric === 'pct' || metric === 'share'
          ? v
          : v / divisor,
    );
    return {
      code,
      name: label(data.countries.find((c) => c.country_code === code)!),
      display,
      changePct: rows.map((r, i) => {
        if (!r) return null;
        const base = model.get(
          code,
          shift(chartMonths[i], -Number(lag)),
        )?.total_holdings_usd_mn;
        return ratio(sub(r.total_holdings_usd_mn, base), base);
      }),
      statuses: rows.map((r) => (!r ? '데이터 없음' : r.source_table)),
      preliminary: rows.map((r) => r?.is_preliminary === true),
      values: indexed ? metricValues.map((v) => ratio(v, first)) : display,
    };
  });
  function tell(s: string) {
    setNotice(s);
    window.setTimeout(() => setNotice(''), 6500);
  }
  function toggle(code: string) {
    if (selected.includes(code)) {
      setSelected(selected.filter((c) => c !== code));
      return;
    }
    if (selected.length >= 5) {
      tell(
        '최대 5개까지 비교할 수 있습니다. 상단 비교 목록에서 한 국가를 해제하세요.',
      );
      return;
    }
    setSelected([...selected, code]);
    setHidden(hidden.filter((c) => c !== code));
  }
  function selectMetric(v: string) {
    setMetric(v);
    setIndexed(false);
    setSort('metric');
    setAsc(false);
  }
  function csv() {
    const fields = [
      'country_name',
      'country_code',
      'reference_month',
      'record_type',
      'rank',
      'for_treas_pos',
      'for_lt_treas_pos',
      'for_st_treas_pos',
      'for_treas_net',
      'for_lt_treas_net',
      'for_st_treas_net',
      'for_lt_treas_valchg',
      'comparison_lag_months',
      'comparison_month',
      'comparison_change_usd_mn',
      'comparison_change_pct',
      'mom_change_usd_mn',
      'mom_change_pct',
      'yoy_change_usd_mn',
      'yoy_change_pct',
      'share_of_foreign_total_pct',
      'long_term_share_pct',
      'other_adjustment_usd_mn',
      'source_table',
      'source_file',
      'source_url',
      'source_unit',
      'downloaded_at',
      'is_preliminary',
    ];
    const rows = tableRows.map((r) => ({
      country_name: r.country_name,
      country_code: r.country_code,
      reference_month: r.reference_month,
      record_type: r.record_type,
      rank: r.rank,
      for_treas_pos: r.total_holdings_usd_mn,
      for_lt_treas_pos: r.long_term_holdings_usd_mn,
      for_st_treas_pos: r.short_term_holdings_usd_mn,
      for_treas_net: r.net_transaction_usd_mn,
      for_lt_treas_net: r.long_term_net_transaction_usd_mn,
      for_st_treas_net: r.short_term_net_transaction_usd_mn,
      for_lt_treas_valchg: r.valuation_change_usd_mn,
      comparison_lag_months: Number(lag),
      comparison_month: compare,
      comparison_change_usd_mn: amount(r),
      comparison_change_pct: changePct(r),
      mom_change_usd_mn: r.mom_change_usd_mn,
      mom_change_pct: r.mom_change_pct,
      yoy_change_usd_mn: r.yoy_change_usd_mn,
      yoy_change_pct: r.yoy_change_pct,
      share_of_foreign_total_pct: r.share_of_foreign_total_pct,
      long_term_share_pct: r.long_term_share_pct,
      other_adjustment_usd_mn: r.other_adjustment_usd_mn,
      source_table: r.source_table,
      source_file: r.source_file,
      source_url: r.source_url,
      source_unit: 'USD million',
      downloaded_at: r.downloaded_at,
      is_preliminary: r.is_preliminary,
    }));
    const text =
      '\uFEFF' +
      fields.join(',') +
      '\r\n' +
      rows
        .map((r) =>
          fields
            .map(
              (k) =>
                '"' +
                String((r as Record<string, unknown>)[k] ?? 'N/A').replaceAll(
                  '"',
                  '""',
                ) +
                '"',
            )
            .join(','),
        )
        .join('\r\n');
    const a = document.createElement('a');
    const url = URL.createObjectURL(
      new Blob([text], { type: 'text/csv;charset=utf-8' }),
    );
    a.href = url;
    a.download = `TIC_${month}_USD_million.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    tell(
      `CSV 저장 완료 · 현재 필터/정렬 ${rows.length}행 · 원본 단위 USD million`,
    );
  }
  const flow = model.get(flowCode, month) || leader,
    detail = drawer ? model.get(drawer, month) : undefined;
  const rankValue = (r: Row) => (rankPct ? changePct(r) : amount(r));
  const rises = [...scope]
    .filter((r) => rankValue(r) != null && rankValue(r)! > 0)
    .sort((a, b) => rankValue(b)! - rankValue(a)!)
    .slice(0, 10);
  const falls = [...scope]
    .filter((r) => rankValue(r) != null && rankValue(r)! < 0)
    .sort((a, b) => rankValue(a)! - rankValue(b)!)
    .slice(0, 10);
  const rankMax = Math.max(
    1,
    ...[...rises, ...falls].map((r) => Math.abs(rankValue(r)!)),
  );
  const shareTop = [...scope]
    .filter((r) => r.total_holdings_usd_mn != null)
    .sort((a, b) => b.total_holdings_usd_mn! - a.total_holdings_usd_mn!)
    .slice(0, 10);
  const shareTopSum = shareTop.reduce(
    (s, r) => s + r.total_holdings_usd_mn!,
    0,
  );
  const other = sub(total.total_holdings_usd_mn, shareTopSum);
  const shareCheck =
    total.total_holdings_usd_mn == null || other == null
      ? null
      : ((shareTopSum + other) / total.total_holdings_usd_mn) * 100;
  const compositionRows = selected
    .filter((c) => c !== '99996')
    .map((code) => model.get(code, month))
    .filter((r): r is Row => !!r && matches(r));
  const kpis = [
    {
      title: '외국인 총보유액',
      value: fmt(total.total_holdings_usd_mn),
      sub: signed(total.mom_change_pct, true) + ' MoM',
      unit: unitLabel,
      values: window12(total),
      tip: 'Grand Total. 국가·국제기구를 포함하며 지역 합계를 다시 더하지 않습니다.',
      v: total.mom_change_pct,
    },
    {
      title: '전월 대비 총증감',
      value: signed(total.mom_change_usd_mn),
      sub: `${shift(month, -1)} 대비`,
      unit: unitLabel,
      values: model
        .series('99996', shift(month, -11), month)
        .map((r) => r?.mom_change_usd_mn ?? null),
      tip: '당월 총보유액 − 정확히 한 달 전 총보유액. 순거래와 다릅니다.',
      v: total.mom_change_usd_mn,
    },
    {
      title: '전년 동월 대비',
      value: signed(total.yoy_change_pct, true),
      sub: signed(total.yoy_change_usd_mn) + ' ' + unitLabel,
      unit: 'YoY',
      values: model
        .series('99996', shift(month, -11), month)
        .map((r) => r?.yoy_change_pct ?? null),
      tip: '(당월 − 전년 동월) ÷ 전년 동월 × 100. 파생지표.',
      v: total.yoy_change_pct,
    },
    {
      title: '최대 보유국',
      value: leader ? label(leader) : 'N/A',
      sub: leader ? fmt(leader.total_holdings_usd_mn) + ' ' + unitLabel : 'N/A',
      unit: leader
        ? '#1 · ' + fmt(leader.share_of_foreign_total_pct, true) + '%'
        : '',
      values: leader ? window12(leader) : [],
      tip: '개별 국가·관할지역 중 총보유액 1위. 기관·지역·합계 제외.',
    },
    {
      title: '이번 달 최대 증가국',
      value: gain ? label(gain) : 'N/A',
      sub: gain
        ? signed(gain.mom_change_usd_mn) + ' ' + unitLabel
        : '데이터 미제공',
      unit: 'MoM',
      values: gain ? window12(gain) : [],
      tip: '전월 대비 보유액 증가폭 최대 국가. 보유액 증가를 순매수로 해석하지 않습니다.',
      v: gain?.mom_change_usd_mn,
    },
    {
      title: '이번 달 최대 감소국',
      value: loss ? label(loss) : 'N/A',
      sub: loss
        ? signed(loss.mom_change_usd_mn) + ' ' + unitLabel
        : '데이터 미제공',
      unit: 'MoM',
      values: loss ? window12(loss) : [],
      tip: '전월 대비 보유액 감소폭 최대 국가. 순매도와 다릅니다.',
      v: loss?.mom_change_usd_mn,
    },
    {
      title: '외국 공공부문 비중',
      value:
        fmt(
          ratio(official?.total_holdings_usd_mn, total.total_holdings_usd_mn),
          true,
        ) + '%',
      sub: fmt(official?.total_holdings_usd_mn) + ' ' + unitLabel,
      unit: 'Foreign Official',
      values: data.months
        .filter((m) => m >= shift(month, -11) && m <= month)
        .map((m) =>
          ratio(
            model.get('99990', m)?.total_holdings_usd_mn,
            model.get('99996', m)?.total_holdings_usd_mn,
          ),
        ),
      tip: '원본 Of Which: Foreign Official ÷ Grand Total. 합계의 부분집합입니다.',
    },
    {
      title: '장기채 / 단기채 비중',
      value:
        fmt(total.long_term_share_pct, true) +
        ' / ' +
        fmt(
          ratio(total.short_term_holdings_usd_mn, total.total_holdings_usd_mn),
          true,
        ),
      sub: 'Treasury notes & bonds / bills',
      unit: '%',
      values: model
        .series('99996', shift(month, -11), month)
        .map((r) => r?.long_term_share_pct ?? null),
      tip: '장기채 및 단기채 보유액 각각 ÷ 총보유액. 반올림 차이가 있을 수 있습니다.',
    },
  ];
  return (
    <main className="terminal">
      <header className="masthead">
        <div className="brandmark">
          <ChartNoAxesCombined size={25} />
        </div>
        <div>
          <div className="eyebrow">
            TIC MONITOR <span>/</span> SOVEREIGN DEBT
          </div>
          <h1>
            국가별 미국 국채 보유현황{' '}
            <span>Foreign Holdings of U.S. Treasury Securities</span>
          </h1>
          <p>미국 재무부 TIC 기준 월별 국가별 보유액 및 수요 변화 분석</p>
        </div>
        <div className="header-right">
          <Database size={17} />
          <span>
            <small>OFFICIAL SOURCE</small>
            <strong>U.S. Treasury TIC</strong>
          </span>
          <button
            className="icon-btn"
            aria-label="데이터 출처 및 주석"
            onClick={() => setDrawer('sources')}
          >
            <Info size={18} />
          </button>
        </div>
      </header>
      <section className="toolbar">
        <div className="control">
          <label>기준월</label>
          <Pick
            value={month}
            onChange={(m) => {
              setMonth(m);
              setZoom(null);
            }}
            options={[...data.months].reverse().map((m) => [m, m])}
            aria="기준월"
          />
        </div>
        <div className="control">
          <label>조회 기간</label>
          <div className="segmented">
            {periods.map(([l, v]) => (
              <button
                key={v}
                className={period === v && !zoom ? 'active' : ''}
                onClick={() => {
                  setPeriod(v);
                  setZoom(null);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="control">
          <label>금액 단위</label>
          <Pick
            value={unit}
            onChange={setUnit}
            options={[
              ['bn', 'USD bn'],
              ['mn', 'USD mn'],
            ]}
            aria="금액 단위"
          />
        </div>
        <div className="control">
          <label>증감 기준</label>
          <Pick
            value={lag}
            onChange={(v) => {
              setLag(v);
              setSort('change');
              setAsc(false);
            }}
            options={[
              ['1', '전월 대비'],
              ['3', '3개월 대비'],
              ['6', '6개월 대비'],
              ['12', '전년 동월 대비'],
            ]}
            aria="증감 기준"
          />
        </div>
        <div className="control">
          <label>표시 지표</label>
          <Pick
            value={metric}
            onChange={selectMetric}
            options={metrics}
            aria="표시 지표"
          />
        </div>
        <div className="toolbar-actions">
          <button
            onClick={() => {
              setMonth(data.meta.latest_month);
              setZoom(null);
              tell(
                '저장된 최신 스냅샷을 다시 표시했습니다. 새 원본 수집은 README의 수동 업데이트 명령을 사용하세요.',
              );
            }}
          >
            <RefreshCw size={14} /> 새로고침 <small>모형</small>
          </button>
          <button onClick={csv}>
            <ArrowDownToLine size={14} /> CSV
          </button>
          <button
            onClick={() =>
              tell(
                'Excel 내보내기 버튼 모형입니다. CSV를 Excel에서 열어 사용할 수 있습니다.',
              )
            }
          >
            Excel <small>모형</small>
          </button>
          <button
            onClick={() =>
              tell(
                'Image 내보내기 버튼 모형입니다. 인쇄 기능 또는 화면 캡처를 이용하세요.',
              )
            }
          >
            Image <small>모형</small>
          </button>
        </div>
      </section>
      <section className="freshness" aria-label="데이터 기준 정보">
        <div className="data-meta">
          <div>
            <span>기준월</span>
            <strong>{month}</strong>
            <small>
              {month === data.meta.latest_month ? '최신 기준월' : '과거 기준월'}
            </small>
          </div>
          <div>
            <span>원본 수집 시각</span>
            <strong>{collectedAt}</strong>
            <small>Asia/Seoul · KST</small>
          </div>
          <div>
            <span>데이터 상태</span>
            <strong>
              {month === data.meta.latest_month ? '최신 수집본' : '과거 스냅샷'}
            </strong>
            <small>수정 가능 · 잠정 여부 미표기</small>
          </div>
        </div>
        <button className="method-link" onClick={() => setDrawer('sources')}>
          로컬 스냅샷 · 출처 및 방법론 <ChevronRight size={14} />
        </button>
      </section>
      <section className="kpis">
        {kpis.map((k, i) => (
          <article
            className={'kpi ' + (i === 0 ? 'primary' : '')}
            key={k.title}
          >
            <div className="kpi-label">
              {k.title}
              <Tip>
                {k.tip} 기준 {month} · {k.unit}
              </Tip>
            </div>
            <div
              className={'kpi-value ' + (i === 1 || i === 2 ? sign(k.v) : '')}
            >
              {k.value}
            </div>
            <div className="kpi-unit">{k.unit}</div>
            <div className="kpi-foot">
              <span className={sign(k.v)}>{k.sub}</span>
              <Spark
                values={k.values}
                stroke={k.v != null && k.v < 0 ? '#f18395' : '#65aaff'}
              />
            </div>
          </article>
        ))}
      </section>
      <div className="filterline">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="국가 검색"
            placeholder="국가명 또는 TIC 코드 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="검색 지우기" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <Pick
          value={region}
          onChange={setRegion}
          options={[
            ['all', '전체 지역'],
            ...[
              '유럽',
              '북미',
              '중남미',
              '카리브',
              '아시아',
              '아프리카',
              '오세아니아',
            ].map((r) => [r, r]),
          ]}
          aria="지역 필터"
        />
        <Pick
          value={group}
          onChange={setGroup}
          options={[
            ['country', '국가·관할지역'],
            ['selected', '선택 국가'],
            ['regions', '지역 합계'],
            ['aggregates', '기관·전체 합계'],
          ]}
          aria="국가 그룹"
        />
        <span className="compare-label">
          비교 <b>{selected.length}/5</b>
        </span>
        {selected.map((code) => (
          <button
            className="chip"
            style={{ borderColor: color(code) + '66' }}
            key={code}
            onClick={() => toggle(code)}
          >
            <i style={{ background: color(code) }} />
            {label(data.countries.find((c) => c.country_code === code)!)}
            <X size={12} />
          </button>
        ))}
        <button
          className="reset"
          onClick={() => {
            setRegion('all');
            setGroup('country');
            setQuery('');
            setMover('all');
            setSelected(initial);
            setHidden([]);
          }}
        >
          필터 초기화
        </button>
      </div>
      <section className="summary">
        <Activity size={15} />
        <b>데이터 기반 자동 요약</b>
        <span>
          {month} 외국인 총보유액{' '}
          <strong>
            {fmt(total.total_holdings_usd_mn)} {unitLabel}
          </strong>{' '}
          · 전월 대비{' '}
          <em className={sign(total.mom_change_usd_mn)}>
            {signed(total.mom_change_usd_mn)} {unitLabel}
          </em>
          .{' '}
          {gain && (
            <>
              최대 증가 <b>{label(gain)}</b> ({signed(gain.mom_change_usd_mn)}
              ),{' '}
            </>
          )}
          {loss && (
            <>
              최대 감소 <b>{label(loss)}</b> ({signed(loss.mom_change_usd_mn)}
              ).{' '}
            </>
          )}{' '}
          보유잔액 변화는 순거래와 다릅니다.
        </span>
      </section>
      <section className="main-grid">
        <article className="panel rankings">
          <div className="panel-head">
            <h2>
              {tableTitle} <span>{tableRows.length}개</span>
            </h2>
            <div className="panel-tools">
              <div className="segmented small">
                {[
                  ['all', '전체'],
                  ['up', '증가 Top 10'],
                  ['down', '감소 Top 10'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={mover === v ? 'active' : ''}
                    onClick={() => setMover(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <button
                className="column-button"
                aria-label="열 표시 설정"
                onClick={() => setDrawer('columns')}
              >
                <Settings2 size={15} /> 열 설정
              </button>
            </div>
          </div>
          <div className="table-meta">
            <span>금액 {unitLabel} · 비중/증감률 % · 행 클릭: 상세</span>
            <span>
              정렬:{' '}
              {sort === 'metric'
                ? metrics.find((m) => m[0] === metric)?.[1]
                : defs.find((d) => d.id === sort)?.name}{' '}
              {asc ? '↑' : '↓'}
            </span>
          </div>
          <div className="rank-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="checkcell">비교</TableHead>
                  <TableHead>#</TableHead>
                  <TableHead className="country-cell">
                    국가 / TIC 코드
                  </TableHead>
                  {metric !== 'hold' && (
                    <TableHead>
                      <button
                        onClick={() => {
                          setSort('metric');
                          setAsc(!asc);
                        }}
                      >
                        {metrics.find((m) => m[0] === metric)?.[1]} ↕
                      </button>
                    </TableHead>
                  )}
                  {defs
                    .filter((c) => columns.includes(c.id))
                    .map((c) => (
                      <TableHead
                        key={c.id}
                        aria-sort={
                          sort === c.id
                            ? asc
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        <button
                          onClick={() => {
                            if (c.id === 'spark') return;
                            setSort(c.id);
                            setAsc(sort === c.id ? !asc : false);
                          }}
                        >
                          {c.name}{' '}
                          {sort === c.id
                            ? asc
                              ? '↑'
                              : '↓'
                            : c.id === 'spark'
                              ? ''
                              : '↕'}
                        </button>
                      </TableHead>
                    ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((r) => (
                  <TableRow
                    key={r.country_code}
                    className={
                      selected.includes(r.country_code) ? 'selected-row' : ''
                    }
                    onClick={() => {
                      setDrawer(r.country_code);
                      setFlowCode(r.country_code);
                    }}
                  >
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      className="checkcell"
                    >
                      <Checkbox
                        aria-label={`${label(r)} 비교 선택`}
                        checked={selected.includes(r.country_code)}
                        onCheckedChange={() => toggle(r.country_code)}
                      />
                    </TableCell>
                    <TableCell className="ranknum">{r.rank ?? '—'}</TableCell>
                    <TableCell className="country-cell">
                      <button
                        className="country-link"
                        onClick={() => setDrawer(r.country_code)}
                      >
                        <i style={{ background: color(r.country_code) }} />
                        <b>{label(r)}</b>
                        <span>{r.country_name}</span>
                        <small>
                          {r.country_code}
                          {r.record_type !== 'country'
                            ? ' · ' + r.record_type
                            : ''}
                        </small>
                      </button>
                    </TableCell>
                    {metric !== 'hold' && (
                      <TableCell className="metric-cell">
                        {fmt(
                          metricVal(r),
                          metric === 'pct' || metric === 'share',
                        )}
                        {(metric === 'pct' || metric === 'share') &&
                        metricVal(r) != null
                          ? '%'
                          : ''}
                      </TableCell>
                    )}
                    {defs
                      .filter((c) => columns.includes(c.id))
                      .map((c) => (
                        <TableCell
                          key={c.id}
                          className={c.delta ? sign(c.get(r)) : ''}
                        >
                          {c.id === 'spark' ? (
                            <Spark
                              values={window12(r)}
                              stroke={color(r.country_code)}
                            />
                          ) : (
                            <span
                              className={c.id === 'hold' ? 'holding-cell' : ''}
                            >
                              {c.id === 'hold' &&
                                r.total_holdings_usd_mn != null && (
                                  <i
                                    style={{
                                      width:
                                        Math.min(
                                          100,
                                          (r.total_holdings_usd_mn /
                                            (leader?.total_holdings_usd_mn ||
                                              1)) *
                                            100,
                                        ) + '%',
                                    }}
                                  />
                                )}
                              <span>
                                {c.delta
                                  ? signed(c.get(r), c.pct)
                                  : fmt(c.get(r), c.pct) +
                                    (c.pct && c.get(r) != null ? '%' : '')}
                              </span>
                            </span>
                          )}
                        </TableCell>
                      ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!tableRows.length && (
              <div className="empty">
                조건에 맞는 국가가 없습니다.
                <button
                  onClick={() => {
                    setQuery('');
                    setRegion('all');
                    setMover('all');
                  }}
                >
                  필터 초기화
                </button>
              </div>
            )}
          </div>
          <div className="panel-foot">
            <span>국가 순위에서 지역·기관·합계 제외</span>
            <span>전체 합계 기준 점유율 · 결측값 N/A</span>
          </div>
        </article>
        <article className="panel trends">
          <div className="panel-head">
            <h2>
              국가별 {metrics.find((m) => m[0] === metric)?.[1]}
              {indexed ? ' 지수' : ''} 추이
            </h2>
            <div className="segmented small">
              <button
                className={!indexed ? 'active' : ''}
                onClick={() => setIndexed(false)}
              >
                절대값
              </button>
              <button
                className={indexed ? 'active' : ''}
                onClick={() => setIndexed(true)}
              >
                시작월 = 100
              </button>
            </div>
          </div>
          <div className="chart-legend">
            {selected.map((code) => (
              <button
                key={code}
                className={hidden.includes(code) ? 'off' : ''}
                onClick={() =>
                  setHidden(
                    hidden.includes(code)
                      ? hidden.filter((c) => c !== code)
                      : [...hidden, code],
                  )
                }
              >
                <i style={{ background: color(code) }} />
                {label(data.countries.find((c) => c.country_code === code)!)}
              </button>
            ))}
            <span>
              {chartMonths[0]} — {chartMonths.at(-1)}
            </span>
          </div>
          <TimeChart
            months={chartMonths}
            series={plots}
            indexed={indexed}
            unit={metric === 'pct' || metric === 'share' ? '%' : unitLabel}
            onZoom={(a, b) => setZoom([a, b])}
          />
          <div className="chart-foot">
            <span>
              드래그로 기간 확대 · 범례 클릭으로 숨김 · 결측 구간은 선을
              연결하지 않음
            </span>
            <button onClick={() => setZoom(null)} disabled={!zoom}>
              확대 초기화 ↗
            </button>
          </div>
          <div className="flow-head">
            <h3>
              보유잔액 변화 ≠ 자금 흐름(순매입·순매도){' '}
              <Tip>
                보유액 변화와 자금 흐름은 다른 개념입니다. 평가변동은 장기채만
                제공되며, 나머지는 기타 조정/잔차로 구분합니다.
              </Tip>
            </h3>
            <Pick
              value={flowCode}
              onChange={setFlowCode}
              options={all
                .filter(
                  (r) =>
                    (r.record_type === 'country' && matches(r)) ||
                    r.country_code === '99996',
                )
                .map((r) => [r.country_code, label(r)])}
              aria="보유잔액 분해 국가"
            />
          </div>
          <Waterfall
            row={flow}
            previous={
              model.get(flow.country_code, shift(month, -1))
                ?.total_holdings_usd_mn ?? null
            }
            divisor={divisor}
            unit={unitLabel}
          />
        </article>
      </section>
      <section className="bottom-grid">
        <article className={'panel movers ' + (expanded ? 'expanded' : '')}>
          <div className="panel-head">
            <h2>
              증감 순위{' '}
              <span>
                {lag}개월 대비 · {rankPct ? '%' : unitLabel}
              </span>
            </h2>
            <div className="panel-tools">
              <div className="segmented small">
                <button
                  className={!rankPct ? 'active' : ''}
                  onClick={() => setRankPct(false)}
                >
                  증감액
                </button>
                <button
                  className={rankPct ? 'active' : ''}
                  onClick={() => setRankPct(true)}
                >
                  증감률
                </button>
              </div>
              <button
                aria-label="증감 순위 확대"
                onClick={() => setExpanded(!expanded)}
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          <div className="movers-headers">
            <span className="down">▼ 감소 Top 10</span>
            <span>0</span>
            <span className="up">▲ 증가 Top 10</span>
          </div>
          <div className="diverging">
            {Array.from(
              { length: Math.max(falls.length, rises.length) },
              (_, i) => (
                <div className="div-row" key={i}>
                  {[falls[i], rises[i]].map((r, j) => (
                    <button
                      key={j}
                      className={
                        'div-side ' +
                        (j === 0 ? 'negative' : 'positive') +
                        (r && selected.includes(r.country_code)
                          ? ' chosen'
                          : '')
                      }
                      onClick={() => r && setDrawer(r.country_code)}
                      title={
                        r
                          ? `${label(r)}: ${signed(rankValue(r), rankPct)} ${rankPct ? '' : unitLabel} · ${compare} → ${month}`
                          : ''
                      }
                    >
                      {r && (
                        <>
                          <span className="bar-name">{label(r)}</span>
                          <span className="bar-track">
                            <i
                              style={{
                                width:
                                  (Math.abs(rankValue(r)!) / rankMax) * 100 +
                                  '%',
                              }}
                            />
                          </span>
                          <strong className={j === 0 ? 'down' : 'up'}>
                            {signed(rankValue(r), rankPct)}
                          </strong>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              ),
            )}
          </div>
          {!falls.length && !rises.length && (
            <div className="empty">비교 가능한 데이터 없음</div>
          )}
          <div className="panel-foot">
            {compare} → {month} · 보유액 변화 기준 · 동일한 선형 축
          </div>
        </article>
        <article className="panel shares">
          <div className="panel-head">
            <h2>
              국가별 점유율 <span>Top 10 + 기타 · 전월 순위 Δ</span>
            </h2>
            <Tip>
              분모는 Grand Total. 기타는 Grand Total에서 표시된 10개 국가를 뺀
              값으로 미표시 국가·기구·미배분 잔액을 포함합니다. 지역 합계는
              더하지 않습니다.
            </Tip>
          </div>
          <div className="share-list">
            {shareTop.map((r) => {
              const prev = model.get(r.country_code, shift(month, -1))?.rank;
              const move =
                prev != null && r.rank != null ? prev - r.rank : null;
              return (
                <button
                  key={r.country_code}
                  className={selected.includes(r.country_code) ? 'chosen' : ''}
                  onClick={() => setDrawer(r.country_code)}
                  title={`${label(r)} · 현재 #${r.rank ?? 'N/A'} · 전월 #${prev ?? 'N/A'} · Grand Total 대비 ${fmt(r.share_of_foreign_total_pct, true)}%`}
                >
                  <span className="ranknum">{r.rank}</span>
                  <span>{label(r)}</span>
                  <div className="share-track">
                    {r.share_of_foreign_total_pct != null && (
                      <i
                        style={{
                          width:
                            (r.share_of_foreign_total_pct /
                              Math.max(
                                1,
                                shareTop[0].share_of_foreign_total_pct || 0,
                              )) *
                              100 +
                            '%',
                          background: color(r.country_code),
                        }}
                      />
                    )}
                  </div>
                  <b>{fmt(r.share_of_foreign_total_pct, true)}%</b>
                  <small className={sign(move)}>
                    {move == null
                      ? 'N/A'
                      : move === 0
                        ? '─'
                        : (move > 0 ? '▲' : '▼') + Math.abs(move)}
                  </small>
                </button>
              );
            })}
            <div className="other-share">
              <span>기타 국가·기구·미배분</span>
              <strong>
                {fmt(ratio(other, total.total_holdings_usd_mn), true)}%
              </strong>
              <span
                className={
                  shareCheck != null && Math.abs(shareCheck - 100) < 1e-9
                    ? 'check-pass'
                    : 'down'
                }
              >
                합계 {shareCheck == null ? 'N/A' : shareCheck.toFixed(6) + '%'}
              </span>
              <Tip>
                상위 10개 보유액 + 기타 = Grand Total로 산출해 반올림 전
                100%인지 검증합니다. 원본 지역 합계를 국가와 중복 합산하지
                않습니다.
              </Tip>
            </div>
          </div>
        </article>
        <article className="panel composition">
          <div className="panel-head">
            <h2>
              장기채·단기채 구성 <span>{month} · 선택/필터 반영</span>
            </h2>
            <span className="composition-key">
              <i />
              장기 <i />
              단기
            </span>
          </div>
          <div className="composition-list">
            {compositionRows.map((r) => {
              const stShare = ratio(
                  r.short_term_holdings_usd_mn,
                  r.total_holdings_usd_mn,
                ),
                partsOk =
                  r.total_holdings_usd_mn != null &&
                  r.long_term_holdings_usd_mn != null &&
                  r.short_term_holdings_usd_mn != null &&
                  Math.abs(
                    r.long_term_holdings_usd_mn +
                      r.short_term_holdings_usd_mn -
                      r.total_holdings_usd_mn,
                  ) <= 1;
              return (
                <button
                  key={r.country_code}
                  onClick={() => setDrawer(r.country_code)}
                  title={`총 ${fmt(r.total_holdings_usd_mn)} · 장기 ${fmt(r.long_term_holdings_usd_mn)} · 단기 ${fmt(r.short_term_holdings_usd_mn)} ${unitLabel} · 합계 ${partsOk ? '일치' : 'N/A'}`}
                >
                  <div>
                    <b>{label(r)}</b>
                    <span>
                      {fmt(r.total_holdings_usd_mn)} {unitLabel}
                    </span>
                  </div>
                  <div className="stack">
                    {r.long_term_share_pct != null && stShare != null && (
                      <>
                        <i style={{ width: r.long_term_share_pct + '%' }} />
                        <i style={{ width: stShare + '%' }} />
                      </>
                    )}
                  </div>
                  <small>
                    장기 {fmt(r.long_term_share_pct, true)}% · 단기{' '}
                    {fmt(stShare, true)}%
                    <span>
                      장기 비중 Δ{' '}
                      {signed(
                        sub(
                          r.long_term_share_pct,
                          model.get(r.country_code, shift(month, -1))
                            ?.long_term_share_pct,
                        ),
                        true,
                      ).replace('%', 'pp')}
                    </span>
                  </small>
                  <span className="composition-values">
                    총 {fmt(r.total_holdings_usd_mn)} · 장기{' '}
                    {fmt(r.long_term_holdings_usd_mn)} · 단기{' '}
                    {fmt(r.short_term_holdings_usd_mn)} {unitLabel} ·{' '}
                    {partsOk ? '합계 일치' : '합계 N/A'}
                  </span>
                </button>
              );
            })}
            {!compositionRows.length && (
              <div className="empty">선택 국가가 현재 필터에 없습니다.</div>
            )}
          </div>
          <div className="panel-foot">
            100% 누적 · 장기+단기=총보유액 검증 · 결측값 N/A
          </div>
        </article>
      </section>
      <footer>
        <div>
          <Database size={14} />
          <b>
            U.S. Department of the Treasury · Treasury International Capital
            System
          </b>
          {data.meta.sources.map((s, i) => (
            <a key={s.file} href={s.url} target="_blank" rel="noreferrer">
              {['Table 3', 'Table 5', 'Historical CSV'][i]}{' '}
              <ExternalLink size={11} />
            </a>
          ))}
          <button onClick={() => setDrawer('sources')}>
            방법론 및 주의사항
          </button>
        </div>
        <p>
          국가별 수치는 최종 실소유자의 국적과 다를 수 있습니다. 해외 수탁
          소재국 및 금융센터의 보유액 해석에 유의하세요. 보유액 변화에는
          가격·평가변동이 포함됩니다. 과거 자료 연결: 2020-01 · 거래/평가 제공:
          2023-02.
        </p>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <Sheet
        open={drawer !== null}
        onOpenChange={(open) => !open && setDrawer(null)}
      >
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <div className="eyebrow">
              TIC MONITOR /{' '}
              {drawer === 'sources'
                ? 'DATA NOTES'
                : drawer === 'columns'
                  ? 'TABLE SETTINGS'
                  : 'COUNTRY DETAIL'}
            </div>
            <SheetTitle>
              {drawer === 'sources'
                ? '데이터 출처 및 방법론'
                : drawer === 'columns'
                  ? '테이블 열 설정'
                  : detail
                    ? label(detail)
                    : '데이터 미제공'}
            </SheetTitle>
            <SheetDescription>
              {detail
                ? `${detail.country_name} · TIC ${detail.country_code} · 기준 ${month}`
                : '실제 원본 데이터와 계산 기준을 확인합니다.'}
            </SheetDescription>
          </SheetHeader>
          {drawer === 'columns' ? (
            <div className="column-options">
              {defs.map((c) => (
                <label key={c.id}>
                  <Checkbox
                    checked={columns.includes(c.id)}
                    onCheckedChange={() =>
                      setColumns(
                        columns.includes(c.id)
                          ? columns.filter((x) => x !== c.id)
                          : [...columns, c.id],
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : drawer === 'sources' ? (
            <SourceNotes data={data} month={month} unit={unitLabel} />
          ) : (
            detail && (
              <div className="detail-body">
                <div className="detail-main">
                  <span>
                    현재 보유액{' '}
                    <span className="pill">
                      {detail.rank
                        ? '국가 순위 #' + detail.rank
                        : detail.record_type}
                    </span>
                  </span>
                  <strong>
                    {fmt(detail.total_holdings_usd_mn)}{' '}
                    <small>{unitLabel}</small>
                  </strong>
                  <div>
                    <span className={sign(detail.mom_change_usd_mn)}>
                      MoM {signed(detail.mom_change_usd_mn)} (
                      {signed(detail.mom_change_pct, true)})
                    </span>
                    <span className={sign(detail.yoy_change_usd_mn)}>
                      YoY {signed(detail.yoy_change_usd_mn)} (
                      {signed(detail.yoy_change_pct, true)})
                    </span>
                  </div>
                </div>
                <button
                  className="compare-add"
                  onClick={() => toggle(detail.country_code)}
                >
                  {selected.includes(detail.country_code)
                    ? '비교 국가에서 해제'
                    : '＋ 비교 국가에 추가'}{' '}
                  <span>{selected.length}/5</span>
                </button>
                <div className="detail-stats">
                  {[
                    [
                      '전체 대비 비중',
                      fmt(detail.share_of_foreign_total_pct, true) + '%',
                    ],
                    [
                      '장기채 비중',
                      fmt(detail.long_term_share_pct, true) + '%',
                    ],
                    [
                      '장기채',
                      fmt(detail.long_term_holdings_usd_mn) + ' ' + unitLabel,
                    ],
                    [
                      '단기채',
                      fmt(detail.short_term_holdings_usd_mn) + ' ' + unitLabel,
                    ],
                    ...[12, 36, 60].map((n) => [
                      `${n / 12}년 변화`,
                      signed(
                        sub(
                          detail.total_holdings_usd_mn,
                          model.get(detail.country_code, shift(month, -n))
                            ?.total_holdings_usd_mn,
                        ),
                      ) +
                        ' ' +
                        unitLabel,
                    ]),
                    [
                      '선택 기간 최고',
                      fmt(
                        (() => {
                          const v = model
                            .series(detail.country_code, start, end)
                            .map((r) => r?.total_holdings_usd_mn)
                            .filter((v): v is number => v != null);
                          return v.length ? Math.max(...v) : null;
                        })(),
                      ) +
                        ' ' +
                        unitLabel,
                    ],
                    [
                      '선택 기간 최저',
                      fmt(
                        (() => {
                          const v = model
                            .series(detail.country_code, start, end)
                            .map((r) => r?.total_holdings_usd_mn)
                            .filter((v): v is number => v != null);
                          return v.length ? Math.min(...v) : null;
                        })(),
                      ) +
                        ' ' +
                        unitLabel,
                    ],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <span>{l}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
                <h3>
                  최근 12개월 <span>{unitLabel}</span>
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>기준월</TableHead>
                      <TableHead>보유액</TableHead>
                      <TableHead>MoM</TableHead>
                      <TableHead>순거래</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model
                      .series(detail.country_code, shift(month, -11), month)
                      .reverse()
                      .map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r?.reference_month || 'N/A'}</TableCell>
                          <TableCell>{fmt(r?.total_holdings_usd_mn)}</TableCell>
                          <TableCell className={sign(r?.mom_change_usd_mn)}>
                            {signed(r?.mom_change_usd_mn)}
                          </TableCell>
                          <TableCell
                            className={sign(r?.net_transaction_usd_mn)}
                          >
                            {signed(r?.net_transaction_usd_mn)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <div className="detail-notes">
                  <b>
                    {detail.source_table} · {detail.source_file} · 기준월{' '}
                    {month}
                  </b>
                  <p>
                    원본 USD million → 화면 {unitLabel}. 증감·비중·순위는
                    파생지표입니다. 분모가 0이거나 비교월이 없으면 N/A입니다.
                  </p>
                  <p>
                    수탁기관 소재국 기준 집계로 최종 실소유자의 국적과 다를 수
                    있습니다. 수정 가능 · 잠정 여부 원본 미표기.
                  </p>
                  <p>
                    수집{' '}
                    {new Date(detail.downloaded_at).toLocaleString('sv-SE', {
                      timeZone: 'Asia/Seoul',
                    })}{' '}
                    KST
                  </p>
                  <a href={detail.source_url} target="_blank" rel="noreferrer">
                    U.S. Treasury 원본 파일 <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            )
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
function SourceNotes({
  data,
  month,
  unit,
}: {
  data: Dataset;
  month: string;
  unit: string;
}) {
  return (
    <div className="source-notes">
      <h3>공개 원본 · 로컬 스냅샷</h3>
      <p>
        기준월 {month} / 수집된 최신월 {data.meta.latest_month}
      </p>
      <p>
        수집{' '}
        {new Date(data.meta.downloaded_at).toLocaleString('sv-SE', {
          timeZone: 'Asia/Seoul',
        })}{' '}
        KST. 발표일과 기준월, 파일 수집 시각은 다릅니다. 이후 발표 여부는 별도
        업데이트 확인이 필요합니다.
      </p>
      <p>
        화면 {unit}. Table 3 및 Historical CSV 원본 USD million, Table 5 원본
        USD billion. mn → bn 변환은 1,000으로 나눕니다.
      </p>
      <p>
        수정 가능. 원본에 월별 잠정치 플래그가 없어 is_preliminary=null이며
        잠정치 여부를 추정하지 않습니다. 확인된 잠정 구간이 없어 잠정치 점선을
        임의로 추가하지 않습니다. 전체 시계열의 점선은 우측 축 구분입니다.
      </p>
      <p>
        로컬 스냅샷 방식: 아래 공식 파일의 바이트를 수정하지 않고 저장한 뒤
        SHA-256과 수집 시각을 manifest에 기록합니다. 화면의 새로고침(모형)은
        네트워크를 호출하지 않습니다.
      </p>
      {data.meta.sources.map((s) => (
        <a
          className="source-link"
          key={s.file}
          href={s.url}
          target="_blank"
          rel="noreferrer"
        >
          {s.file}
          <ExternalLink size={14} />
        </a>
      ))}
      <h3>정제 및 검증</h3>
      <p>
        원본 → 화면 필드: for_treas_pos → 총보유액, for_lt_treas_pos → 장기채,
        for_st_treas_pos → 단기채, for_treas_net → 순거래, for_lt_treas_valchg →
        장기채 평가변동. 원본 필드명은 CSV에도 함께 보존합니다.
      </p>
      <p>
        Table 3의 시스템 헤더를 탐색해 파싱했습니다. Table 5와{' '}
        {data.meta.cross_checks}개 값을 USD bn으로 비교하고 0.051 bn 이내의
        반올림 차이를 확인했습니다.
      </p>
      <p>
        2011-09~2019-12는 Historical CSV, 2020-01 이후는 현재 Table 3를
        우선합니다. 겹치는 수정 전 데이터를 덮어쓰지 않습니다. 2020-01 연결부와
        2023-02 거래·평가 제공 시작부에 마커를 표시합니다. 장기 비교는 빈티지 및
        조사방법 차이를 포함할 수 있습니다.
      </p>
      <p>
        n.a., 공백, 비정상 값은 null → N/A. Grand Total, All Countries, Of
        Which, Total, Memo, 국제·지역기구를 국가 순위에서 제외합니다. 지역은 TIC
        표의 원본 구획을 따릅니다.
      </p>
      <h3>파생지표</h3>
      <ul>
        <li>증감액 = 당월 − 정확한 비교월 보유액</li>
        <li>증감률 = 증감액 ÷ 비교월 × 100</li>
        <li>점유율 = 국가 보유액 ÷ Grand Total × 100</li>
        <li>장·단기 비중 = 해당 보유액 ÷ 총보유액 × 100</li>
        <li>기타 조정/잔차 = 당월 − 전월 − 순거래 − 장기채 평가변동</li>
        <li>지수 = 해당 월 보유액 ÷ 시작월 보유액 × 100</li>
      </ul>
      <p>
        분모 0 또는 결측이면 N/A. 잔차는 2023-02 이후 필수 값이 모두 있는 기간만
        계산하며 원인 자체를 추정하지 않습니다. 단기채 순거래는 월말 잔액 차이로
        추정된 원본 값입니다.
      </p>
      <h3>해석상 주의사항</h3>
      <ol>
        <li>국가별 보유액은 최종 실소유자 국적과 일치하지 않을 수 있습니다.</li>
        <li>해외 수탁기관 보유는 수탁 소재국으로 집계될 수 있습니다.</li>
        <li>
          케이맨제도·벨기에·룩셈부르크 등 금융센터 수치 해석에 유의하세요.
        </li>
        <li>보유액 변화에는 순거래 외 가격·평가변동이 포함됩니다.</li>
        <li>최신 월은 잠정치일 수 있고 이후 수정될 수 있습니다.</li>
        <li>기간별 조사·집계방법 변경에 따른 시계열 단절 가능성이 있습니다.</li>
        <li>발표일과 데이터 기준월은 서로 다릅니다.</li>
      </ol>
    </div>
  );
}
