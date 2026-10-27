# 설계 및 데이터 메모

## 화면 구성 의도

첫 화면에서 5초 안에 최대 보유국, 월간 최대 증가·감소국, 전체 방향을 읽을 수 있도록 KPI를 상단에 고정된 정보 띠처럼 배치했습니다. 핵심 작업인 국가 순위와 다국가 시계열을 같은 높이의 양쪽 패널에 놓아 탐색 동선을 짧게 만들었습니다. 증감 순위는 0을 중심으로 감소와 증가를 같은 선형 축에 비교하고, 점유율과 장·단기 구성은 도넛 대신 길이 비교가 쉬운 가로 막대를 사용합니다.

색은 가치 판단이 아니라 방향과 선택 상태에 사용합니다. 증가에는 청록색과 `▲`, 감소에는 코랄색과 `▼`, 변화 없음에는 회색과 `─`, 결측에는 `N/A`를 병행합니다. 선택 국가는 모든 차트에서 같은 색을 사용합니다.

총보유액 변화와 실제 거래를 혼동하지 않도록 시계열 아래에 별도의 워터폴을 두었습니다. 장기채 평가변동만 제공되고 단기채 거래는 잔액 차이로 추정된다는 TIC 정의를 툴팁과 방법론 패널에 표시합니다.

## 실제 데이터 연결 구조

```text
data/raw/slt_table3.txt ─┐
data/raw/slt_table5.txt ─┼─ scripts/prepare-data.mjs
data/raw/slt3d_globl.csv ┘          │
                                    ├─ dashboard/public/data/tic.json
                                    └─ data/validation.json
                                               │
dashboard/lib/tic.ts ─ 파생지표·분류·순위 ─────┘
dashboard/app/page.tsx ─ 필터·표·상세·내보내기
dashboard/components/tic-charts.tsx ─ 시각화
```

실행 중 외부 네트워크를 호출하지 않습니다. 화면은 다운로드된 공식 원본의 정제 스냅샷을 읽습니다.

## 원본 필드 → 화면 필드

| TIC 원본 | 화면용 필드 | 처리 |
|---|---|---|
| `country` | `country_name` | 원문 보존, 일부 한국어 표시명 별도 적용 |
| `country_code` | `country_code` | 문자열 보존 |
| `date` | `reference_month` | `YYYY-MM` |
| `for_treas_pos` | `total_holdings_usd_mn` | 숫자 또는 `null` |
| `for_lt_treas_pos` | `long_term_holdings_usd_mn` | 숫자 또는 `null` |
| `for_st_treas_pos` | `short_term_holdings_usd_mn` | 숫자 또는 `null` |
| `for_treas_net` | `net_transaction_usd_mn` | 2023-02 이후 제공, 이전 `null` |
| `for_lt_treas_net` | `long_term_net_transaction_usd_mn` | 숫자 또는 `null` |
| `for_st_treas_net` | `short_term_net_transaction_usd_mn` | 숫자 또는 `null` |
| `for_lt_treas_valchg` | `valuation_change_usd_mn` | 장기채 평가변동, 숫자 또는 `null` |
| 행 이름/표 구획 | `record_type` | `country`, `region`, `institution`, `total` |
| 표 구획 | `region` | 유럽, 북미, 중남미, 카리브, 아시아, 아프리카, 오세아니아 |
| 원본 파일 | `source_table`, `source_url`, `source_unit` | 출처 추적 |
| manifest | `downloaded_at` | 파일 수집 시각 |
| 원본 미제공 | `is_preliminary` | `null` |

## 파생지표

| 화면 필드 | 산식 |
|---|---|
| `mom_change_usd_mn` | 당월 총보유액 − 전월 총보유액 |
| `mom_change_pct` | 전월 증감액 ÷ 전월 총보유액 × 100 |
| `yoy_change_usd_mn` | 당월 총보유액 − 전년 동월 총보유액 |
| `yoy_change_pct` | 전년 동월 증감액 ÷ 전년 동월 총보유액 × 100 |
| `share_of_foreign_total_pct` | 국가 총보유액 ÷ Grand Total × 100 |
| `long_term_share_pct` | 장기채 보유액 ÷ 총보유액 × 100 |
| 단기채 비중 | 단기채 보유액 ÷ 총보유액 × 100 |
| `other_adjustment_usd_mn` | 당월 − 전월 − 순거래 − 장기채 평가변동 |
| `rank` | 해당 월 `country` 행을 총보유액 내림차순 정렬 |
| 시작월=100 | 해당 월 보유액 ÷ 선택 기간 시작월 보유액 × 100 |

비교월이 정확히 존재하지 않거나 분모가 0, 원본 값이 결측이면 결과는 `null`이며 화면에는 `N/A`를 표시합니다. `0`은 실제 0으로 유지합니다.

## 합계와 점유율

개별 국가 순위의 모집단은 `record_type=country`입니다. 지역 합계와 기관·메모·Grand Total을 순위에 넣지 않습니다. 점유율 분모는 항상 `Grand Total`입니다. 점유율 패널의 `기타`는 Grand Total에서 표시된 상위 10개 국가를 차감하여 계산하므로 미표시 국가, 국제·지역기구, 미배분 부분을 포함합니다. 지역 합계를 국가 값과 다시 더하지 않습니다.

## 시계열 연결

Historical CSV와 현재 Table 3는 일부 기간에서 수정 빈티지가 다릅니다. 현재 원본을 우선하기 위해 CSV는 2019-12까지만 사용하고 2020-01부터 Table 3로 전환합니다. 화면의 2020-01 마커는 이 연결과 정의 차이 가능성을 나타냅니다. 순거래와 평가변동은 2023-02부터 사용 가능하므로 그 이전 워터폴은 `분해 불가`로 표시합니다.

## 해석상 주의사항

국가별 보유액은 최종 실소유자 국적과 다를 수 있습니다. 해외 수탁기관을 통한 보유는 실제 소유국이 아닌 수탁 소재국으로 집계될 수 있으며 케이맨제도, 벨기에, 룩셈부르크 등 금융센터 수치는 특히 주의가 필요합니다. 보유액 변화에는 순매수·순매도뿐 아니라 가격·평가변동이 포함됩니다. 최신 월은 이후 수정될 수 있고, 조사·집계방법 변경에 따른 시계열 단절 가능성이 있습니다. 발표일, 기준월, 파일 수집 시각은 서로 다릅니다.

## 제한사항

- 화면의 최신 기준월은 원본 Table 3과 Table 5가 공통으로 제공하는 `2026-08`이며, 수집일을 기준으로 임의의 최신 월을 만들지 않습니다.
- Excel·Image 내보내기와 네트워크 원본 재수집은 기능 모형입니다. CSV 내보내기만 실제 동작합니다.
- 월별 잠정치 여부는 원본이 제공하지 않아 `is_preliminary=null`입니다.
- Historical CSV의 `2018-04`에는 `Grand Total`과 하위 합계 사이에 원본 기준 −497 USD million 차이가 있습니다. 원본 값을 보정하지 않고 경고로 보존합니다.
- 자동 브라우저 E2E 테스트 파일은 없으며 최종 검수는 로컬 브라우저의 실제 상호작용으로 수행했습니다.

## 최종 검증 결과

2026-09-11 KST에 데이터 준비·16개 데이터 검증, TypeScript 검사, 보조 차트·상세/CSV 계약 검증, Vinext 프로덕션 빌드(5/5 및 정적 `/` 프리렌더)를 모두 통과했습니다. 1920×1080에서는 가로 넘침이 없고 문서 높이는 1,331px였습니다. 다크 배경 `rgb(11, 16, 23)`과 기본 문자 `rgb(226, 234, 243)` 조합 및 숫자 표시를 육안 확인했습니다.

브라우저에서는 기준월 `2026-06 → 2026-05`, USD bn → USD mn, 전월 → 3개월 비교, 국가 검색, 비교 국가 해제·추가와 시계열 반영, 국가 상세 드로어, 1Y와 시작월=100, 증감액/증감률, CSV 버튼 실행을 확인했습니다. CSV 열 22개와 화면 필터·정렬 연동은 `npm run validate:detail`로도 검증했습니다.
