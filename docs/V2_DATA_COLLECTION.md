# v2 화면 데이터 수집 및 갱신

`UST_Holders_v2.html`은 서버에 요청하지 않는 독립 실행형 파일이다. 화면 데이터는 HTML 안의 `<script id="tic-data" type="application/json">`에 내장되어 있다. 현재 내장 데이터와 `dashboard/public/data/tic.json`은 동일하다. 따라서 원본 다운로드만으로 화면이 바뀌지 않으며, 정제·검증·HTML 반영까지 실행해야 한다.

## 빠른 실행

프로젝트 루트에서 Node.js 22.13 이상으로 실행한다. DB, Python, npm 설치는 이 경로에 필요하지 않다.

```powershell
# 공식 Treasury 원본 3개를 새로 수집하고 v2 HTML까지 갱신
node scripts/update-v2-data.mjs

# 기존 data/raw 스냅샷만으로 전체 경로를 오프라인 재현
node scripts/update-v2-data.mjs --from-directory data/raw

# 파일을 변경하지 않고 현재 v2 내장 데이터와 원본의 일치 여부 확인
node scripts/update-v2-data.mjs --from-directory data/raw --check
```

수집 결과는 `data/raw`의 원본 3개와 `manifest.json`, 정제 데이터 `dashboard/public/data/tic.json`, 검증 결과 `data/validation.json`, 최종 화면 `UST_Holders_v2.html`에 기록된다. 실행 후 HTML을 브라우저에서 다시 열면 새 기준월이 표시된다. 스크립트가 최신 월을 만들어내지는 않는다. Treasury가 새 파일을 게시해야 기준월이 늘어난다.

## 원본과 처리 순서

| 원본 | 용도 |
|---|---|
| [TIC Table 3](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt) | 2020-01 이후 월별 국가·지역·합계 보유액과 거래·평가변동 |
| [TIC Table 5](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt) | 최신 월과 주요 보유국 값 교차검증 |
| [Historical SLT CSV](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt3d_globl.csv) | 2011-09~2019-12 시계열 연결 |

1. `update-v2-data.mjs`가 공식 URL에서 원본 바이트를 내려받고, 각 파일의 수집 시각과 SHA-256을 manifest에 기록한다. `--from-directory`에서는 지정한 디렉터리의 원본과 manifest를 사용한다.
2. `prepare-data.mjs`가 SHA-256을 검사하고 Table 3과 Historical CSV를 파싱한다. 겹치는 기간은 Table 3을 우선하며, 결측값은 `null`로 보존한다. Table 5는 화면 레코드로 섞지 않고 대조에 사용한다.
3. `validate-data.mjs`가 원본/정제 값, 기준월, Table 3↔Table 5, 합계와 산식 등을 검사한다. 하나라도 실패하면 갱신을 중단한다.
4. 검증을 통과한 JSON만 v2 HTML의 `tic-data` 태그 안에 삽입한다. HTML의 화면 코드와 스타일은 유지한다.

다운로드와 파싱은 임시 디렉터리에서 수행한다. 검증 전에는 프로젝트 파일을 바꾸지 않는다. 최종 파일 쓰기 오류가 나면 기존 파일을 복원한다. 수집 URL과 형식이 Treasury 측에서 변경되면 오류로 중단되므로 원본 형식과 파서 매핑을 확인해야 한다.

## 데이터 계약과 운영상 주의

- 원본 보유액 단위는 **USD million**이다. Table 5는 **USD billion**이므로 비교 시 1,000으로 나눈다.
- 내장 JSON의 `meta.sources`에 파일 URL·수집 시각·SHA-256이 남는다. `meta.latest_month`는 자료 기준월이고 다운로드 날짜와 다르다.
- `records`의 열 순서는 `meta.record_columns`에 정의된다. 국가명·분류는 `countries`에 있고 월 목록은 `months`에 있다.
- 이 스크립트는 실행할 때만 수집한다. 브라우저의 새로고침 버튼으로 네트워크 수집하지 않는다.
- DB 운영 파이프라인은 별도로 `python -m src.cli ingest`를 사용한다. v2 HTML 갱신에는 위 Node 스크립트를 사용한다.

갱신 후에는 `node scripts/update-v2-data.mjs --from-directory data/raw --check`로 동일성을 다시 확인하고, `git diff`로 새 기준월·변경 범위를 검토한다.
