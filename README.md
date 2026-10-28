# 국가별 미국 국채 보유현황

미국 재무부 Treasury International Capital(TIC) 공개 원본을 로컬 스냅샷으로 사용한 인터랙티브 단일 페이지 대시보드입니다. 백엔드와 데이터베이스 없이 브라우저에서 실행됩니다.

개발 문서는 [`docs/README.md`](docs/README.md)에서 시작합니다. 저장소 작업 규칙은 루트의 [`AGENTS.md`](AGENTS.md)에도 있으며 `/docs`에 사본을 보관합니다.

회사 Altibase에서 v2 화면을 운영하기 위한 [개발 담당자 전달용 설계서](docs/altibase/UST_Holders_Altibase_Design.md)와 [테이블 생성 SQL 초안](docs/altibase/create_tables.sql), [화면 데이터 예시](docs/altibase/v2-response-example.json)를 제공합니다. 현재 구현 완료 내역과 구분되는 운영 전환 설계이며 회사 환경에서의 구현·검수가 필요합니다.

설계서 1.2는 회사의 C언어 전용 서버·외부 코드 금지·전체 JSON 1회 전달 조건을 반영합니다. [JSON 생성부](docs/altibase/c-example/ust_v2_json.c)는 표준 C 함수만 사용하며 [회사 기존 DB 조회·응답 기능](docs/altibase/c-example/ust_v2_odbc.c)과 연결합니다. [브라우저 연결 예제](docs/altibase/c-example/v2-fetch-example.js)도 제공합니다. 외부 코드 금지를 운영 화면에도 적용하기 위해 기존 v2의 내장 Vue를 자체 JavaScript로 전환하는 작업을 설계에 명시했으며, 실제 화면 전환은 아직 구현하지 않았습니다.

## 실행

서버 없이 최종 화면을 보려면 프로젝트 루트의 [`UST_Holders_v2.html`](UST_Holders_v2.html)을 브라우저에서 엽니다. 이 파일에는 화면 코드, 스타일, TIC 데이터 스냅샷이 포함되어 있습니다. `npm run build:standalone`은 별도 v1 파일을 생성하며 v2를 갱신하지 않습니다.

Node.js 22.13 이상이 필요합니다. 프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
cd dashboard
npm install
npm run dev
```

터미널에 표시되는 `http://127.0.0.1:3000/`을 브라우저에서 엽니다.

프로덕션 정적 결과물을 만들려면 다음을 실행합니다.

```powershell
cd dashboard
npm run build
```

프로덕션 결과물은 `dashboard/dist`에 생성됩니다. 이번 단계에서는 빌드까지만 수행하며 배포하지 않습니다.

## 데이터 갱신

v2 HTML의 내장 데이터를 새 공식 원본으로 갱신하려면 다음 명령을 실행합니다.

```powershell
node scripts/update-v2-data.mjs
```

네트워크 없이 기존 원본으로 재현하거나 현재 v2 데이터와의 일치 여부만 확인할 수도 있습니다.

```powershell
node scripts/update-v2-data.mjs --from-directory data/raw --check
```

수집·검증·HTML 반영 순서와 출력 파일은 [v2 데이터 수집 설명서](docs/V2_DATA_COLLECTION.md)에 정리했습니다. 공식 원본 URL은 다음과 같습니다.

- [TIC Table 3](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt)
- [TIC Table 5](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt)
- [Historical SLT CSV](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt3d_globl.csv)

## 화면 기능

- 기준월, 1Y/3Y/5Y/10Y/MAX 기간, USD bn/USD mn, 비교 기준과 표시 지표 전환
- KPI, 자동 요약, 국가 순위, 최대 증가·감소, 점유율, 장·단기 구성, 잔액 변화 분해
- 국가 검색, 지역·합계 그룹, 다중 정렬, 열 표시 설정, 증가·감소 Top 10
- 최대 5개 국가 비교, 범례 숨김, 시작월=100, 차트 드래그 확대
- 국가 행 클릭 시 최근 12개월과 산식·주의사항을 포함한 상세 드로어
- 화면 상태를 반영한 CSV 내보내기

Excel·Image·새로고침 버튼은 요구사항에 따라 기능 모형으로 표시하며, CSV 내보내기는 실제로 작동합니다. 새 원본 수집은 위 데이터 갱신 절차로 수행합니다.

## 데이터 처리 기준

- Table 3의 시스템 헤더를 찾아 파싱하고 `n.a.`, 공백, 비정상 숫자는 `null`로 저장합니다.
- 2020-01 이후는 현재 Table 3를 우선합니다. Historical CSV는 2011-09~2019-12만 연결합니다.
- 겹치는 과거 CSV 행으로 현재 Table 3 값을 덮어쓰지 않습니다. 두 빈티지 사이의 수정 차이와 조사방법 변경 가능성을 화면에 표시합니다.
- `Grand Total`, `All Countries`, `Of Which`, `Total`, `Memo`, 국제·지역기구는 개별 국가 순위에서 제외합니다.
- 원본 단위는 USD million입니다. 화면에서 USD billion을 선택하면 1,000으로 나눕니다.
- Table 5는 최신 기준월과 주요 보유국 최근 보유액의 교차검증에만 사용합니다.
- 원본에 월별 잠정치 플래그가 없으므로 `is_preliminary`는 `null`입니다. 잠정 여부를 임의로 추정하지 않습니다.

상세 필드 매핑, 파생지표, 화면 의도는 [설계 및 데이터 메모](docs/DESIGN_AND_DATA.md)를 참고하세요.

## 검증 결과

- 수집된 최신 기준월: 2026-08
- Table 3 ↔ Table 5: 최근 13개월 주요 행 286개 교차검증 통과
- `Grand Total = All Countries + Total IROs` 일치
- 장기채 + 단기채 = 총보유액 검증 통과(허용 오차 1 USD million)
- TypeScript 검사 및 정적 프로덕션 빌드 통과
- 1920×1080에서 가로 넘침 없이 핵심 표·시계열이 첫 화면에 시작하며, 전체 문서 높이는 1,331px로 과도한 세로 스크롤이 없습니다.
- 기준월, USD mn/bn, 증감 기준, 검색, 국가 선택·상세, 기간·시작월=100, 증감액/증감률, CSV 실행 흐름을 로컬 브라우저에서 확인했습니다.

원본 데이터는 이후 수정될 수 있습니다. 화면의 기준월과 파일 수집 시각은 별도로 표시됩니다.

## 운영 DB 파이프라인

Python 3.12+, SQLAlchemy 2, Alembic, httpx 기반 백엔드가 `src/`에 있습니다. 동기식으로 구현했습니다. 입력은 월별 3개 파일뿐이며, 한 실행의 적재·검증·승격 트랜잭션을 명확히 추적하는 편이 비동기 다운로드의 이점보다 중요하기 때문입니다.

### 설치와 설정

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[postgres,test]"
Copy-Item .env.example .env
```

`.env`의 `TIC_DATABASE_URL`에 PostgreSQL 접속 문자열을 설정합니다. 접속 문자열과 자격증명은 로그나 manifest에 기록하지 않습니다.

### 마이그레이션과 실행

```powershell
python -m alembic upgrade head
python -m src.cli ingest --dry-run --from-directory data/raw
python -m src.cli ingest --from-directory data/raw
python -m src.cli ingest
python -m src.cli ingest --download-only
python -m src.cli validate --vintage-id <UUID>
python -m src.cli shadow-validate --vintage-id <UUID>
python -m src.cli current-vintage
python -m src.cli failed-run <INGESTION_RUN_UUID>
uvicorn src.api:app --host 127.0.0.1 --port 8000
```

`--dry-run`은 다운로드/로컬 파일 검증과 파싱만 수행하고 DB 및 원본 저장소를 변경하지 않습니다. `--from-directory`는 manifest의 URL과 SHA-256을 확인한 뒤 로컬 원본으로 재현합니다. 인자 없이 실행하면 공식 Treasury 파일 URL을 직접 사용합니다.

기본 설정에서 원본은 `TIC_RAW_STORAGE_DIR` 아래 실행 UUID별 경로에 변경 없이 저장합니다. `TIC_STORAGE_BACKEND=s3`와 `TIC_S3_BUCKET`을 설정하면 파이프라인이 S3 호환 저장 구현을 선택합니다. ETag/Last-Modified 조건부 응답은 `NotModified`로 명시적으로 반환하며, 캐시 원본을 재사용할 때도 SHA-256 검증을 생략하면 안 됩니다.

### 트랜잭션과 롤백

수집 실행 행은 먼저 확정해 후속 실패도 추적할 수 있게 합니다. 신규 원본·원본행·fact·crosscheck·conflict는 비활성 빈티지에 적재합니다. 12개 규칙 중 ERROR가 하나라도 실패하면 실행과 빈티지를 FAIL로 기록하고 기존 active 빈티지는 건드리지 않습니다. 모든 ERROR가 통과한 경우에만 행 잠금 아래 기존 active를 내리고 신규 빈티지를 올리는 단일 트랜잭션을 실행합니다. PostgreSQL에서는 같은 전환에서 국가 순위 MV를 갱신합니다.

롤백은 애플리케이션 버전을 되돌린 뒤 `python -m alembic downgrade <revision>`으로 수행합니다. 데이터 빈티지는 자동 삭제하지 않습니다. 잘못 승격한 빈티지는 검증된 이전 빈티지를 명시적으로 재승격해야 하며 행 삭제로 복구하지 않습니다.

### API

기본 시계열과 순위는 active이면서 `validation_status='PASS'`인 View/MV만 조회합니다. 과거 데이터는 명시적인 `vintage_id`가 있을 때만 fact를 조회합니다. 엔드포인트는 현재 빈티지, 기간, 엔터티, 월별 국가 순위, 엔터티 시계열, 최신 품질 상태, 빈티지별 검증 결과를 제공합니다.

### 운영 관측 항목

구조화 로그의 `run_id`로 수집 지연, HTTP/파싱 실패, SHA 변경, 검증 실패를 연결합니다. 운영 모니터링은 마지막 PASS 빈티지의 `validated_at` 경과시간, 최근 `ingestion_run` 실패율, source SHA 변경, Table 5 불일치 수를 경보 대상으로 삼습니다. 원본 payload 전체와 DB URL은 로그에 출력하지 않습니다.

### 테스트

```powershell
python -m pytest
```

단위 테스트는 외부 네트워크 없이 실행됩니다. PostgreSQL View/MV와 잠금 동작을 검증하려면 Docker가 있는 환경에서 Testcontainers 통합 테스트를 추가 실행해야 합니다. SQLite는 스키마·파서·로컬 전체 적재 재현용이며 PostgreSQL 무결성 기준을 대체하지 않습니다.
