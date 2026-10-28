# 미국 국채 보유현황 Altibase 운영 설계서

개발 담당자 전달용 · 설계 기준일 2026년 10월 28일 · 설계 버전 1.2 외부 코드 없는 C언어 운영


UST_Holders_v2.html의 화면을 유지하면서 데이터 입수와 저장 및 조회를 회사 시스템으로 옮기는 설계

**결정 사항** 숫자와 기준정보는 Altibase의 일반 테이블에 저장한다. 회사 서버는 검증 완료 자료를 조회해 현재 v2 화면과 같은 JSON으로 전달한다. JSON 전용 DB 기능과 4,000byte 조각 저장은 기본 경로에서 사용하지 않는다.

대상 독자는 업무 담당자와 개발 담당자 및 DBA이다. 쉬운 설명은 업무 흐름을, 표와 규격은 구현 기준을 설명한다. 이 문서와 SQL은 신규 Altibase 운영 설계이며 실제 회사 DB 접속이나 운영 프로그램 구현 완료를 의미하지 않는다. 기존 v2 HTML과 원본 데이터는 변경하지 않는다.

## 목차

- [1 운영 방식과 용어](#1-운영-방식과-용어)
- [2 현재 구현과 전환 범위](#2-현재-구현과-전환-범위)
- [3 테이블과 항목 정의](#3-테이블과-항목-정의)
- [4 입수와 적재 절차](#4-입수와-적재-절차)
- [5 데이터 검증과 서비스 전환](#5-데이터-검증과-서비스-전환)
- [6 화면 데이터 전달 규격](#6-화면-데이터-전달-규격)
- [7 C언어 조회와 JSON 생성](#7-c언어-조회와-json-생성)
- [8 v2 화면 연결 방법](#8-v2-화면-연결-방법)
- [9 장애 대응과 운영](#9-장애-대응과-운영)
- [10 개발 순서와 인수 기준](#10-개발-순서와-인수-기준)
- [11 전달 파일과 참고 자료](#11-전달-파일과-참고-자료)

## 1 운영 방식과 용어

**쉽게 이해하기** DB는 정리된 장부, 회사 서버는 전달 담당자, HTML은 표시판이다. DB가 JSON을 몰라도 전달 담당자가 장부의 내용을 화면 양식에 맞게 포장할 수 있다.

> 공식 원본 입수 → 정리와 검사 → 새 버전으로 DB 적재 → 검증 통과 → 서비스 버전 지정 → 서버가 JSON 생성 → v2 화면 표시

| 용어 | 업무 담당자를 위한 뜻 |
| --- | --- |
| 테이블과 컬럼 | 엑셀의 표와 열에 해당한다. 국가 기준월 금액 등을 각각 저장한다. |
| 자료 버전 DATASET | 같은 시점에 입수한 전체 기간 자료의 묶음이다. 같은 기준월도 나중에 수정될 수 있어 버전이 필요하다. |
| PK 기본키 | 각 줄이 중복되지 않게 하는 식별번호 또는 식별항목 조합이다. |
| FK 외래키 | 다른 표의 어느 자료와 연결되는지 나타내는 연결번호이다. |
| NULL | 자료가 없다는 뜻이다. 실제 금액 0과 다르다. |
| API | 화면이 회사 서버에 데이터를 요청하는 창구이다. |
| 트랜잭션 | 여러 DB 변경을 모두 완료하거나 모두 취소하는 하나의 작업 단위이다. |
| SHA256 | 파일 내용이 같은지 확인하는 64자리 확인값이다. |
| 직렬화 | DB의 날짜 숫자 목록을 화면이 읽는 JSON 문서로 바꾸는 작업이다. |

## 2 현재 구현과 전환 범위

저장소 확인 기준 현재 데이터는 2011-09부터 2026-08까지 178개월, 국가·지역·기관·합계 132개 항목, 수치 19,815행이다. JSON 크기는 1,162,110byte이다. 이는 현재 스냅샷의 값이며 고정 운영 조건이나 향후 수집 건수로 하드코딩하지 않는다.

| 구분 | 현재 확인된 상태 | 운영 전환 기준 |
| --- | --- | --- |
| v2 화면 | HTML의 tic-data 태그에서 JSON을 읽는다. | 사내 HTTPS 조회 주소에서 JSON을 받은 다음 화면을 시작한다. |
| 화면 기능 | 순위 차트 검색 국가 비교 CSV가 구현되어 있다. | 기존 계산과 외형을 유지하고 동일성 검수한다. |
| 데이터 수집 | scripts/update-v2-data.mjs가 원본 수집 정제 검증 HTML 삽입을 수행한다. | 원본 수집 정제 검증 규칙을 재사용하되 출력 대상을 Altibase로 바꾼다. |
| 기존 DB 프로그램 | src에는 PostgreSQL 중심 스키마와 API가 있다. | JSON 자료형 UUID Boolean 부분 인덱스 날짜 계산 MV 등을 그대로 실행하지 않는다. |
| 버튼 범위 | Excel Image 원본 새 수집은 기존 문서상 기능 모형이다. | CSV는 유지한다. 새로고침은 DB 최신 검증본 재조회로 구현하며 원본 수집과 구별한다. Excel Image의 실기능 추가는 별도 범위이다. |

확정된 회사 전제는 서버 프로그램에 C언어만 사용 가능, JSON 자료형 미지원, 문자 필드당 최대 4,000byte이다. 화면 전달 방식과 한 번의 응답 용량에는 별도 제한이 없다. 따라서 전체 기간 JSON을 한 번에 보내며 조각 저장이나 분할 호출은 설계에 넣지 않는다. 본 설계의 문자 필드는 최대 2,000byte이며 JSON이나 CLOB을 필요로 하지 않는다. 실제 버전 문자체계 접속 드라이버 테이블스페이스는 개발 착수 시 DBA가 확인한다. 공식 7.1 문서는 문법 검토 참고용이며 회사 버전을 7.1로 가정하지 않는다.

서버의 원본 입수·파싱·검증·적재·조회·JSON 생성은 모두 C언어로 구현한다. 기존 Python과 Node 스크립트는 규칙 및 결과 비교용 참고 자료이며 회사 운영 서버의 실행 의존성으로 사용하지 않는다. 브라우저는 HTML CSS 표준 JavaScript를 사용한다. 외부 코드 금지를 운영 화면에도 적용하면 현재 v2에 포함된 Vue도 제거하고 DOM 이벤트와 SVG 차트를 자체 코드로 구현해야 한다. 기존 v2는 디자인과 계산 규칙의 비교 기준으로 보존하며 운영용 화면의 전환은 별도 구현 항목이다. 서버 언어가 C라는 조건이 브라우저 화면 코드까지 C로 바뀐다는 의미는 아니다.

## 3 테이블과 항목 정의

**쉽게 이해하기** 8개 표 중 핵심은 월별 수치 표이다. 나머지는 국가 구분 출처 검사 이력과 현재 서비스 대상을 관리한다. 월과 지역만을 위한 별도 표는 초기 규모에서 필수가 아니다.

| 테이블 | 역할 |
| --- | --- |
| `UST_LOAD_RUN` | 수집 실행 이력 |
| `UST_DATASET` | 자료 버전 |
| `UST_SOURCE_FILE` | 원본 파일 이력 |
| `UST_ENTITY` | 버전별 국가와 구분 |
| `UST_HOLDING` | 월별 보유액과 거래 |
| `UST_TABLE5` | Table 5 대조 값 |
| `UST_VALID_RESULT` | 검증 결과 |
| `UST_SERVICE_STATE` | 현재 서비스 지정 |

연결 관계: 실행 1건 → 자료 버전 → 원본 3개와 국가 목록 → 국가별 월별 수치. 검증 결과는 자료 버전에 연결된다. 현재 서비스 지정 표는 검증 완료 버전 1개만 가리킨다. 원본 파일 이력은 수집 실패와 변경 없음 실행도 남길 수 있도록 버전 번호를 선택 항목으로 둔다.

### 공통 저장 규칙

- 모든 ID는 회사 서버에서 생성한 36자리 UUID 문자열이다. 특정 DB의 UUID 자료형이나 자동 증가 기능에 의존하지 않는다.
- 기준월은 CHAR(7)의 YYYY-MM으로 통일한다. 01~12 범위와 유효 연월을 적재 프로그램에서 검증한다. 숫자가 아닌 국가코드는 VARCHAR로 저장해 앞자리 0을 보존한다.
- DATE에는 UTC 시각을 넣고 읽는다. DB 자체의 시간대 정보가 있다고 가정하지 않는다. JSON 시각은 ISO 8601의 Z로 끝나는 UTC 문자열이고 화면은 KST로 표시한다.
- 금액 NUMERIC(20,3)은 백만 달러 단위이다. 원본의 n.a. 공백 등 결측은 NULL이며 0으로 바꾸지 않는다. 순거래와 평가변동은 음수가 가능하다.
- Y N 플래그는 서버에서 JSON의 true false로 변환한다. 문자 길이는 회사 DB 문자체계의 byte 기준으로 확인하며 초과 시 조용히 자르지 않고 검증 실패로 처리한다.
- 초기에는 전체 기간을 버전별로 저장한다. 현재 규모가 작고 과거 수정의 재현이 중요하다. 보관 기간 용량 테이블스페이스는 운영 정책으로 정한다.
- 필수값은 NOT NULL, PK와 FK 및 고유 순번은 SQL에 포함한다. 상태 코드 Y/N record_type 유효 연월 및 교차 테이블 조건은 적재 시 필수 검사한다. 회사 버전에서 지원을 확인하면 CHECK 제약도 추가한다.

### UST_LOAD_RUN 수집 실행 이력

언제 수집을 시도했고 어디에서 실패했는지 남기는 작업 일지입니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `RUN_ID` | `VARCHAR(36)` | 예 | 실행 고유번호 UUID 문자열 PK |
| `STARTED_AT` | `DATE` | 예 | 실행 시작 UTC |
| `FINISHED_AT` | `DATE` | 아니오 | 실행 종료 UTC |
| `RUN_STATUS` | `VARCHAR(16)` | 예 | RUNNING SUCCESS FAIL NO_CHANGE |
| `TRIGGER_TYPE` | `VARCHAR(16)` | 예 | SCHEDULED MANUAL |
| `INPUT_DIGEST` | `CHAR(64)` | 아니오 | 세 원본 SHA와 변환 규칙 버전을 결합한 SHA256 |
| `RESULT_DATASET_ID` | `VARCHAR(36)` | 아니오 | 신규 또는 재사용한 자료 버전 논리 참조 |
| `ERROR_CODE` | `VARCHAR(40)` | 아니오 | 실패 분류 코드 |
| `ERROR_MESSAGE` | `VARCHAR(2000)` | 아니오 | 요약 오류 비밀정보 제외 상세는 사내 로그 |

제약: `CONSTRAINT PK_UST_RUN PRIMARY KEY (RUN_ID)`

조회 인덱스: `IX_UST_RUN_TIME (STARTED_AT)`

### UST_DATASET 자료 버전

새 자료를 담는 별도 묶음입니다. 이전 묶음을 지우지 않으므로 되돌릴 수 있습니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `DATASET_ID` | `VARCHAR(36)` | 예 | 자료 버전 UUID 문자열 PK |
| `RUN_ID` | `VARCHAR(36)` | 예 | 생성한 실행 FK UST_LOAD_RUN |
| `INPUT_DIGEST` | `CHAR(64)` | 예 | 입력과 규칙의 결합 SHA256 성공 버전 기준 중복 확인 |
| `RULE_VERSION` | `VARCHAR(40)` | 예 | 파서 분류 매핑 검증 및 직렬화 규칙 묶음 버전 |
| `SCHEMA_VERSION` | `INTEGER` | 예 | 화면 데이터 규격 현재 2 |
| `FIRST_MONTH` | `CHAR(7)` | 예 | 첫 기준월 YYYY-MM |
| `LATEST_MONTH` | `CHAR(7)` | 예 | 최신 기준월 YYYY-MM |
| `DATA_STATUS` | `VARCHAR(16)` | 예 | LOADING VALIDATING PASS FAIL |
| `CREATED_AT` | `DATE` | 예 | 생성 UTC |
| `VALIDATED_AT` | `DATE` | 아니오 | 검증 완료 UTC |
| `PUBLISHED_AT` | `DATE` | 아니오 | 최초 서비스 적용 UTC |
| `IS_PRELIMINARY` | `CHAR(1)` | 아니오 | Y N 또는 NULL 미제공은 NULL |
| `HISTORY_JOIN` | `CHAR(7)` | 예 | 과거와 현재 연결월 현재 2020-01 |
| `TRANSACTION_START` | `CHAR(7)` | 예 | 분해 계산 시작월 현재 2023-02 |
| `OVERLAP_ROWS` | `INTEGER` | 예 | 원본 간 겹치는 행 수 |
| `OVERLAP_DIFFS` | `INTEGER` | 예 | 겹치는 행 중 값 차이 행 수 |
| `CROSS_CHECKS` | `INTEGER` | 예 | Table 5 실제 비교 건수 |
| `HIST_ONLY_ENTITIES` | `INTEGER` | 예 | 과거 원본에만 존재하는 항목 수 |
| `ENTITY_COUNT` | `INTEGER` | 예 | 항목 수 |
| `MONTH_COUNT` | `INTEGER` | 예 | 월 수 |
| `RECORD_COUNT` | `INTEGER` | 예 | 최종 수치 행 수 |

제약: `CONSTRAINT PK_UST_DATA PRIMARY KEY (DATASET_ID)`; `CONSTRAINT FK_UST_DATA_RUN FOREIGN KEY (RUN_ID) REFERENCES UST_LOAD_RUN (RUN_ID)`

조회 인덱스: `IX_UST_DATA_INPUT (INPUT_DIGEST)`

### UST_SOURCE_FILE 원본 파일 이력

원본은 승인된 파일 보관소에 그대로 보관하고 DB에는 위치와 확인값을 남깁니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `SOURCE_FILE_ID` | `VARCHAR(36)` | 예 | 파일 이력 UUID PK |
| `RUN_ID` | `VARCHAR(36)` | 예 | 실행 FK |
| `DATASET_ID` | `VARCHAR(36)` | 아니오 | 자료 버전 FK 실패 및 NO_CHANGE 수집은 NULL 가능 |
| `SOURCE_CODE` | `VARCHAR(8)` | 예 | T3 T5 HIST |
| `FILE_NAME` | `VARCHAR(255)` | 예 | 원본 파일명 |
| `OFFICIAL_URL` | `VARCHAR(1000)` | 예 | 공식 주소 |
| `STORAGE_URI` | `VARCHAR(1000)` | 예 | 승인된 원본 보관 위치 |
| `DOWNLOADED_AT` | `DATE` | 예 | 실제 입수 UTC |
| `PUBLISHED_AT` | `DATE` | 아니오 | 공식 발표시각 확인 가능할 때만 |
| `SHA256_HEX` | `CHAR(64)` | 예 | 원본 바이트 내용 확인값 |
| `BYTE_SIZE` | `BIGINT` | 예 | 원본 크기 |
| `NATIVE_UNIT` | `VARCHAR(24)` | 예 | USD million 또는 USD billion |
| `SOURCE_LATEST_MONTH` | `CHAR(7)` | 아니오 | 파일의 최신 기준월 |

제약: `CONSTRAINT PK_UST_SOURCE PRIMARY KEY (SOURCE_FILE_ID)`; `CONSTRAINT FK_UST_SOURCE_RUN FOREIGN KEY (RUN_ID) REFERENCES UST_LOAD_RUN (RUN_ID)`; `CONSTRAINT FK_UST_SOURCE_DATA FOREIGN KEY (DATASET_ID) REFERENCES UST_DATASET (DATASET_ID)`; `CONSTRAINT UQ_UST_SOURCE_RUN UNIQUE (RUN_ID, SOURCE_CODE)`

조회 인덱스: `IX_UST_SOURCE_DATA (DATASET_ID, SOURCE_CODE)`

### UST_ENTITY 버전별 국가와 구분

국가명이나 분류가 바뀌어도 이전 화면을 재현할 수 있도록 자료 버전별로 함께 보관합니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `DATASET_ID` | `VARCHAR(36)` | 예 | 자료 버전 복합 PK FK |
| `COUNTRY_CODE` | `VARCHAR(10)` | 예 | TIC 코드 문자열 복합 PK |
| `COUNTRY_NAME` | `VARCHAR(600)` | 예 | 공식 원문 이름 한글 별칭은 기존 화면 사전 유지 |
| `REGION_NAME` | `VARCHAR(120)` | 아니오 | 현재 JSON의 지역명 NULL 허용 |
| `RECORD_TYPE` | `VARCHAR(16)` | 예 | country region institution total |
| `RANK_ELIGIBLE` | `CHAR(1)` | 예 | Y 국가 순위 포함 N 제외 |
| `DISPLAY_ORDER` | `INTEGER` | 예 | 현재 countries 배열 순서 재현 고유 순번 |

제약: `CONSTRAINT PK_UST_ENTITY PRIMARY KEY (DATASET_ID, COUNTRY_CODE)`; `CONSTRAINT FK_UST_ENTITY_DATA FOREIGN KEY (DATASET_ID) REFERENCES UST_DATASET (DATASET_ID)`; `CONSTRAINT UQ_UST_ENTITY_ORD UNIQUE (DATASET_ID, DISPLAY_ORDER)`

### UST_HOLDING 월별 보유액과 거래

자료 버전 국가 기준월마다 한 줄입니다. 여기의 숫자가 모든 차트와 계산의 기준입니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `DATASET_ID` | `VARCHAR(36)` | 예 | 자료 버전 복합 PK |
| `COUNTRY_CODE` | `VARCHAR(10)` | 예 | TIC 코드 복합 PK |
| `REFERENCE_MONTH` | `CHAR(7)` | 예 | 기준월 YYYY-MM 복합 PK |
| `TOTAL_USD_MN` | `NUMERIC(20,3)` | 아니오 | 총보유액 for_treas_pos |
| `LT_USD_MN` | `NUMERIC(20,3)` | 아니오 | 장기채 보유액 for_lt_treas_pos |
| `ST_USD_MN` | `NUMERIC(20,3)` | 아니오 | 단기채 보유액 for_st_treas_pos |
| `NET_USD_MN` | `NUMERIC(20,3)` | 아니오 | 총 순거래 for_treas_net |
| `LT_NET_USD_MN` | `NUMERIC(20,3)` | 아니오 | 장기채 순거래 for_lt_treas_net |
| `ST_NET_USD_MN` | `NUMERIC(20,3)` | 아니오 | 단기채 순거래 for_st_treas_net |
| `LT_VAL_USD_MN` | `NUMERIC(20,3)` | 아니오 | 장기채 평가변동 for_lt_treas_valchg |
| `SOURCE_FILE_ID` | `VARCHAR(36)` | 예 | 채택 원본 FK T3 또는 HIST |
| `SOURCE_ROW_NO` | `INTEGER` | 예 | 원본에서의 행 번호 1부터 |

제약: `CONSTRAINT PK_UST_HOLD PRIMARY KEY (DATASET_ID, COUNTRY_CODE, REFERENCE_MONTH)`; `CONSTRAINT FK_UST_HOLD_ENTITY FOREIGN KEY (DATASET_ID, COUNTRY_CODE) REFERENCES UST_ENTITY (DATASET_ID, COUNTRY_CODE)`; `CONSTRAINT FK_UST_HOLD_SOURCE FOREIGN KEY (SOURCE_FILE_ID) REFERENCES UST_SOURCE_FILE (SOURCE_FILE_ID)`

조회 인덱스: `IX_UST_HOLD_MONTH (DATASET_ID, REFERENCE_MONTH)`

### UST_TABLE5 Table 5 대조 값

다른 공식 표와 숫자가 맞는지 확인하기 위한 자료이며 화면 보유액에 섞지 않습니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `SOURCE_FILE_ID` | `VARCHAR(36)` | 예 | T5 원본 복합 PK FK |
| `SOURCE_ROW_NO` | `INTEGER` | 예 | 원본 행 번호 복합 PK |
| `REFERENCE_MONTH` | `CHAR(7)` | 예 | 기준월 복합 PK |
| `SOURCE_NAME` | `VARCHAR(600)` | 예 | 원본 행 이름 |
| `COUNTRY_CODE` | `VARCHAR(10)` | 아니오 | 매핑한 TIC 코드 해당 없음은 NULL |
| `VALUE_USD_BN` | `NUMERIC(20,3)` | 아니오 | 원본 단위 십억 달러 |
| `MAP_STATUS` | `VARCHAR(16)` | 예 | MAPPED EXCLUDED UNMAPPED |

제약: `CONSTRAINT PK_UST_T5 PRIMARY KEY (SOURCE_FILE_ID, SOURCE_ROW_NO, REFERENCE_MONTH)`; `CONSTRAINT FK_UST_T5_SOURCE FOREIGN KEY (SOURCE_FILE_ID) REFERENCES UST_SOURCE_FILE (SOURCE_FILE_ID)`

### UST_VALID_RESULT 검증 결과

검사별 성공 실패와 문제 값을 남깁니다. 긴 JSON 증거 칸을 만들지 않습니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `VALID_RESULT_ID` | `VARCHAR(36)` | 예 | 검증 결과 UUID PK |
| `DATASET_ID` | `VARCHAR(36)` | 예 | 자료 버전 FK |
| `RULE_CODE` | `VARCHAR(40)` | 예 | 검증 규칙 |
| `SEVERITY` | `VARCHAR(8)` | 예 | ERROR WARN |
| `RESULT_STATUS` | `VARCHAR(8)` | 예 | PASS FAIL SKIP |
| `CHECKED_COUNT` | `INTEGER` | 예 | 확인 건수 |
| `FAILED_COUNT` | `INTEGER` | 예 | 실패 건수 |
| `COUNTRY_CODE` | `VARCHAR(10)` | 아니오 | 문제 항목 상세 행일 때 |
| `REFERENCE_MONTH` | `CHAR(7)` | 아니오 | 문제 기준월 |
| `EXPECTED_VALUE` | `NUMERIC(20,6)` | 아니오 | 기대 값 |
| `ACTUAL_VALUE` | `NUMERIC(20,6)` | 아니오 | 실제 값 |
| `MESSAGE` | `VARCHAR(2000)` | 아니오 | 요약 또는 상세 로그 위치 |
| `CHECKED_AT` | `DATE` | 예 | 검사 UTC |

제약: `CONSTRAINT PK_UST_VALID PRIMARY KEY (VALID_RESULT_ID)`; `CONSTRAINT FK_UST_VALID_DATA FOREIGN KEY (DATASET_ID) REFERENCES UST_DATASET (DATASET_ID)`

조회 인덱스: `IX_UST_VALID_DATA (DATASET_ID, RULE_CODE)`

### UST_SERVICE_STATE 현재 서비스 지정

지금 화면에 보여줄 자료 버전 번호 한 개를 가리키는 안내판입니다.

| 항목 | 형식 | 필수 | 설명 |
| --- | --- | --- | --- |
| `SERVICE_KEY` | `VARCHAR(30)` | 예 | PK 고정값 UST_HOLDERS_V2 |
| `CURRENT_DATASET_ID` | `VARCHAR(36)` | 아니오 | 서비스 대상 FK 최초 설치 때 NULL |
| `UPDATED_AT` | `DATE` | 예 | 최근 전환 UTC |
| `UPDATED_BY` | `VARCHAR(80)` | 예 | 작업 또는 운영자 식별자 |

제약: `CONSTRAINT PK_UST_SERVICE PRIMARY KEY (SERVICE_KEY)`; `CONSTRAINT FK_UST_SERVICE_DATA FOREIGN KEY (CURRENT_DATASET_ID) REFERENCES UST_DATASET (DATASET_ID)`

### 표 사이의 추가 무결성 규칙

- UST_HOLDING의 SOURCE_FILE_ID는 같은 DATASET_ID의 T3 또는 HIST이어야 한다. UST_TABLE5는 SOURCE_CODE=T5 파일에만 연결한다. FK만으로 이 조건이 모두 검사되지는 않으므로 게시 전 검증에 포함한다.
- PASS 버전에는 RUN_ID가 같은 T3 T5 HIST 원본이 각각 1개씩 연결되어야 한다. 새 버전 생성 시 세 원본 모두 보관한다. 원본별 SHA는 수집과 보관 후 재읽기에서 일치해야 한다.
- UST_ENTITY는 버전별 사본이다. 표시 순서는 현재 countries 배열 순서를 저장한다. 수치의 출력 순서는 COUNTRY_CODE와 REFERENCE_MONTH 순으로 고정한다. 순위 동률은 기존 v2의 국가 배열 순서에 따른 순차 순위를 유지한다.
- UST_VALID_RESULT는 규칙별 총괄 행 1개와 필요한 문제 상세 행을 저장한다. 총괄 행은 COUNTRY_CODE와 REFERENCE_MONTH가 NULL이다. 규칙별 총괄 중복과 필수 검사 누락을 게시 전 차단한다.
- UST_SERVICE_STATE는 UST_HOLDERS_V2 키의 한 행을 최초 설치 시 만든다. 현재 버전이 NULL이면 아직 서비스 자료가 없는 상태이며 조회는 503으로 응답한다.
- INPUT_DIGEST에는 성공 버전만 재사용하는 조회 인덱스를 둔다. FAIL 재시도를 막는 무조건 UNIQUE는 두지 않는다. 동시 적재는 사내 스케줄러의 단일 실행 잠금으로 차단한다.

## 4 입수와 적재 절차

**쉽게 이해하기** 새 자료는 먼저 별도 작업 공간에서 만든다. 검사 도중에는 사용자가 보는 기존 숫자가 바뀌지 않는다. 작업이 끝나야 안내판이 새 묶음을 가리킨다.

| 입수 원본 | 주소와 사용 범위 | 원본 단위 |
| --- | --- | --- |
| Table 3 | [slt_table3.txt](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt) / 2020-01 이후 보유액 거래 평가변동의 우선 원본 | USD million |
| Table 5 | [slt_table5.txt](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt) / 최신월과 주요 보유액 대조 전용 | USD billion |
| Historical CSV | [slt3d_globl.csv](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt3d_globl.csv) / 2011-09부터 2019-12까지 연결 | USD million |

1. 공식 발표 일정을 확인한 뒤 회사 승인 수집 구간에서 실행한다. 회사 서버가 외부에 접속할 수 없으면 승인된 외부 수집 서버에서 받아 내부 반입 구간으로 전달한다. 사용자 브라우저가 외부 원본을 수집하지 않는다.
2. 실행 ID를 만들고 UST_LOAD_RUN을 RUNNING으로 먼저 확정한다. 스케줄러의 중복 실행 잠금을 얻는다.
3. 세 파일을 각각 임시 위치로 입수한다. 성공 응답 실제 바이트 크기 예상 파일형식 SHA256을 검사한다. 원본은 수정하지 않고 승인 보관소에 저장한 뒤 재읽어 확인값을 비교한다. ETag나 304 응답을 쓰는 경우에도 실제 보관 원본과 SHA가 확보되어야 한다.
4. UST_SOURCE_FILE에 원본 이력을 기록한다. 입수 실패는 실행 FAIL과 원인을 남기고 종료한다. 원본 파일 전체를 4,000byte DB 칸에 넣지 않는다.
5. T3 T5 HIST 순서로 원본 SHA와 RULE_VERSION을 결합해 INPUT_DIGEST를 계산한다. 이름 정렬과 구분자를 고정한다. 같은 digest의 PASS 버전이 있으면 수치 중복 적재 없이 NO_CHANGE로 종료한다. 이전 버전을 임의로 다시 활성화하지 않는다.
6. 새 버전을 LOADING으로 만들고 원본 이력을 연결한다. 헤더 위치를 찾아 원본을 해석한다. 파일 열 순서를 추정하지 말고 필드 이름으로 찾는다.
7. 국가 구분을 생성하고 전체 기간을 정제한다. 2020-01 이후는 T3를, 이전은 HIST를 채택한다. 겹치는 두 원본 차이는 검증 결과와 상세 로그에 남기며 T3를 덮어쓰지 않는다.
8. UST_ENTITY와 UST_HOLDING을 적재하고 T5의 모든 월별 숫자 셀을 UST_TABLE5에 남긴다. 합계나 Of Which 같은 행도 원본 이름으로 보존하되 제외 사유를 기록한다.
9. 적재가 끝나면 VALIDATING으로 전환한다. DB에서 다시 읽은 자료에 대해 검증하고 서버의 JSON 변환까지 확인한다. 행 수와 시작월 최신월 비교 건수 등 메타 값을 확정한다.
10. 필수 검사 모두 통과 시 PASS로 확정한 후 서비스 전환 트랜잭션을 수행한다. 실패 시 새 버전을 FAIL로 보존하고 기존 서비스 버전을 유지한다. 최종 실행 상태와 종료시각을 남기고 잠금을 해제한다.

원본은 최신월 이외의 과거 수치도 수정될 수 있으므로 새 달 한 줄만 추가하지 않는다. 매번 원본 전체를 다시 해석하여 새 버전의 전체 기간을 구성한다. 최신월이 같아도 SHA가 달라지면 수정 버전이 될 수 있다. 파서나 분류 규칙을 수정한 경우 RULE_VERSION을 바꾸어 같은 원본도 재처리한다.

## 5 데이터 검증과 서비스 전환

| 검사 | 통과 기준 | 처리 |
| --- | --- | --- |
| 원본과 규격 | 세 파일 존재 URL 허용목록 SHA 일치 필수 헤더 유효한 숫자와 월 | ERROR |
| 키와 분류 | 버전 국가 월 중복 없음 국가 참조 존재 유형 유효 순위 플래그 일치 | ERROR |
| 원본 충실도 | 채택 원본의 7개 수치와 DB값 일치 NULL 보존 출처 버전 일치 | ERROR |
| 최신월 | T3 최신월 = T5 최신월 = 버전 최신월 = 출력 months 마지막 값 | ERROR |
| Table 5 대조 | 매핑한 모든 유효 셀 비교 abs(T3/1000 − T5) ≤ 0.051 USD billion | ERROR |
| 대조 누락 | 비교 0건 금지 매핑 대상의 T3 누락 금지 신규 미매핑 국가행 검토 후 확정 | ERROR |
| 최신월 합계 | Grand Total = All Countries + Total IROs 허용차 1 USD million | ERROR |
| 장단기 구성 | 세 값이 있는 행의 총보유액 = 장기 + 단기 허용차 1 USD million | ERROR |
| 과거 합계 예외 | 현재 공식 과거 자료의 알려진 예외는 원문 유지 2018-04 차이 −497 USD million | WARN |
| 과거 수정 | 직전 PASS와 키 수 값 변화 비교 신규 또는 큰 변경의 원인을 기록 | WARN 및 운영 검토 |
| 화면 전달 | 필수 키 배열 10열 순서 코드 문자열 숫자 NULL 출처 매핑 전체 행 누락 없음 | ERROR |
| 시각과 건수 | 시작월 최신월 실제 행 수 비교 수 원본 시각과 JSON 메타 값 일치 | ERROR |

현재 286건 교차검증은 기준 스냅샷의 실측값이며 향후 고정 통과 건수가 아니다. T5의 EXCLUDED는 명시한 제외 목록에만 적용하고 UNMAPPED는 담당자 검토 없이 무시하지 않는다. 필수 검사 SKIP은 통과로 간주하지 않는다. WARN은 기록하며, 이미 알려진 과거 원본 예외를 임의로 고치지 않는다. 예상 밖의 신규 합계 이상이나 최신월 후퇴는 운영 검토 전 게시를 보류한다.

### 서비스 전환과 되돌리기

- 수집 전체 실행은 단일 실행 잠금으로 직렬화한다. 별도로 서비스 전환 시 UST_SERVICE_STATE의 고정 한 행을 SELECT FOR UPDATE로 잠근다. 자동 커밋을 끄고 회사 드라이버의 명시적 트랜잭션을 사용한다.
- 전환할 버전이 PASS이고 필수 검사의 총괄 결과가 모두 PASS인지 재확인한다. 현재 서비스보다 기준월이 오래된 신규 자료는 자동 적용하지 않는다. 의도적인 이전 버전 복구만 별도 운영 절차로 허용한다.
- CURRENT_DATASET_ID와 UPDATED_AT UPDATED_BY, 필요 시 신규 버전 PUBLISHED_AT을 같은 트랜잭션에서 변경한다. 실패하면 모두 롤백한다. 이전 버전의 수치와 PASS 상태는 수정하지 않는다.
- API는 요청 시작 때 현재 버전 ID를 한 번 읽어 고정한다. 이후 국가 수치 출처 메타 조회 모두 그 ID를 조건으로 사용한다. 전환이 동시에 일어나도 서로 다른 버전이 한 응답에 섞이지 않는다.
- 잘못 게시한 경우 이전 PASS 버전을 지정하는 동일 전환 절차로 복구한다. 복구 승인자 전후 버전 사유를 사내 변경 감사 로그에 기록한다. 실패 버전을 삭제하거나 기존 자료를 덮어써서 복구하지 않는다.

## 6 화면 데이터 전달 규격

**쉽게 이해하기** 화면이 이미 읽을 줄 아는 양식을 그대로 보내는 것이 목표다. DB 칸 이름은 달라도 된다. 서버가 항목 이름과 숫자 순서를 맞춰 주면 된다.

권장 조회 주소는 `GET /api/ust-holders/v2/data`이다. 경로는 회사 규칙에 맞게 변경할 수 있으나 응답 계약은 유지한다. 회사가 전달 방식과 응답 용량에 별도 제한이 없다고 확인했으므로 전체 기간을 한 번의 JSON 응답으로 보낸다. 화면의 국가 선택 기간 변경 검색은 받은 데이터로 계산한다. 현재 약 1.16MB이며 C 프로그램의 메모리 사용량과 응답시간 및 동시 요청은 운영 검수한다. 월별 국가별 API나 JSON 조각 저장은 추가하지 않는다.

| 상위 키 | 내용과 생성 기준 |
| --- | --- |
| meta | 현재 JSON의 모든 메타 필드를 유지한다. source_mode는 altibase로 변경 가능하고 dataset_id를 추가한다. |
| countries | UST_ENTITY를 DISPLAY_ORDER 순으로 읽어 country_name country_code region record_type rank_eligible을 생성한다. |
| months | 해당 버전 UST_HOLDING의 REFERENCE_MONTH를 중복 제거해 오름차순으로 만든다. 없는 달을 임의 생성하지 않는다. |
| records | 해당 버전 전체 수치를 COUNTRY_CODE REFERENCE_MONTH 순으로 출력한다. 각 행은 아래의 고정 10열 배열이다. |

| 배열 위치 | 현재 JSON 열 이름 | DB 항목 또는 변환 |
| --- | --- | --- |
| 0 | country_code | COUNTRY_CODE 문자열 |
| 1 | reference_month | REFERENCE_MONTH 문자열 |
| 2 | for_treas_pos | TOTAL_USD_MN 숫자 또는 null |
| 3 | for_lt_treas_pos | LT_USD_MN 숫자 또는 null |
| 4 | for_st_treas_pos | ST_USD_MN 숫자 또는 null |
| 5 | for_treas_net | NET_USD_MN 숫자 또는 null |
| 6 | for_lt_treas_net | LT_NET_USD_MN 숫자 또는 null |
| 7 | for_st_treas_net | ST_NET_USD_MN 숫자 또는 null |
| 8 | for_lt_treas_valchg | LT_VAL_USD_MN 숫자 또는 null |
| 9 | source_index | 원본 T3는 0 HIST는 1 T5는 records에 넣지 않음 |

**출처 번호 주의** meta.sources의 순서는 T3 T5 HIST이지만 records의 source_index는 0=T3, 1=HIST이다. 현재 v2가 HIST의 1을 sources의 2로 내부 변환한다. 서버에서 HIST를 2로 보내면 기존 화면과 맞지 않는다. 원본 파일 ID나 sources 배열 위치를 records에 그대로 넣지 않는다. 또한 v2는 열을 위치로 읽으므로 meta.record_columns만 바꿔 열 순서를 변경할 수 없다.

### 메타 필드 생성 기준

| meta 항목 | 생성 방법 |
| --- | --- |
| schema_version | UST_DATASET.SCHEMA_VERSION 현재 2 |
| dataset_id | UST_DATASET.DATASET_ID 추가 식별자 |
| source_mode | 고정 문자열 altibase |
| first_month / latest_month | UST_DATASET.FIRST_MONTH / LATEST_MONTH |
| downloaded_at | 현재 호환 기준 T3 원본 DOWNLOADED_AT UTC ISO 문자열 |
| sources | 해당 버전 원본 3개 T3 T5 HIST 순서로 file url downloaded_at sha256 생성 |
| base_unit / table5_unit | 고정 USD million / USD billion |
| source_fields / record_columns | 현행 tic.json의 원본 필드 7개와 고정 배열 열 10개 그대로 |
| comparison_lags_months | 고정 [1,3,6,12] |
| derived_fields | 현행 tic.json의 산식 설명 객체를 규칙 버전 코드에서 생성 JSON DB 저장 불필요 |
| ranking_record_type | 고정 country |
| is_preliminary | DB NULL은 JSON null Y는 true N은 false 미제공이면 null 유지 |
| status | 현재 업무 문구 최신 수집본 · 수정 가능 · 잠정 여부 미표기 또는 동일 의미의 검증본 문구 |
| history_join / transaction_start | UST_DATASET.HISTORY_JOIN / TRANSACTION_START |
| overlap_rows / overlap_differences | UST_DATASET.OVERLAP_ROWS / OVERLAP_DIFFS |
| cross_checks | UST_DATASET.CROSS_CHECKS 실제 성공 비교 건수 |
| row_counts_by_source | records 채택 원본별 집계 table3와 historical_before_2020 키 |
| historical_only_entities | UST_DATASET.HIST_ONLY_ENTITIES |

sources 각 객체: file=FILE_NAME, url=OFFICIAL_URL, downloaded_at=DOWNLOADED_AT, sha256=SHA256_HEX이다. 실제 게시 시각이 필요하면 별도 published_at을 추가하되 기준월과 수집시각을 혼동하지 않는다. 서비스 화면의 수집시각은 위 호환 정의를 따른다. 정적 상태 문구를 데이터 신선도 판정으로 사용하지 않는다.

```json
{
  "meta": {
    "schema_version": 2,
    "dataset_id": "<현재 검증 완료 버전>",
    "latest_month": "2011-09"
  },
  "countries": [
    {
      "country_name": "Austria",
      "country_code": "10189",
      "region": "유럽",
      "record_type": "country",
      "rank_eligible": true
    }
  ],
  "months": [
    "2011-09"
  ],
  "records": [
    [
      "10189",
      "2011-09",
      2700,
      2152,
      548,
      null,
      null,
      null,
      null,
      1
    ]
  ]
}
```

위는 구조 설명을 위해 필드를 생략한 예시다. 함께 제공하는 v2-response-example.json은 모든 현행 meta 키를 포함한 한 항목 한 달 예시이며 example_only=true이다. 통계 메타는 원본 전체 스냅샷의 설명을 포함하므로 예시 파일을 운영 데이터로 게시하거나 수치 검증 입력으로 사용하지 않는다. 실제 API는 DB 전체 버전에서 각 수치를 다시 집계한다.

### 응답 처리 기준

- 200: application/json; charset=utf-8. 인증과 접근권한은 사내 정책을 적용한다. 화면과 같은 출처의 주소를 우선 사용한다.
- 401 또는 403: 로그인 또는 권한 안내. 503: 서비스 버전 없음 DB 조회 실패 불완전 자료 검증 실패. 오류를 200 빈 배열로 위장하거나 HTML 로그인 페이지를 JSON으로 읽지 않는다.
- DB의 NUMERIC 값이 드라이버에서 문자열로 반환되더라도 JSON에서는 숫자로 변환한다. null은 null이며 빈 문자열 0 NaN Infinity를 보내지 않는다. JavaScript가 정확히 처리할 수 없는 큰 값은 게시 전 범위 검사에서 중단한다. 코드 번호는 항상 문자열이다.
- 검증 통과 버전은 게시 후 불변으로 둔다. 조회 캐시를 사용하면 버전 ID별로 저장한다. 매 요청마다 현재 버전 포인터를 확인하고 새 버전으로 캐시를 구분한다. 초기 구현은 캐시 없이 시작할 수 있다.
- 새로고침에는 최신 서비스 버전을 재확인하도록 브라우저 캐시 정책을 적용한다. 초기 권장 Cache-Control은 private, no-store이다. ETag를 추가하는 경우 서비스 포인터 변경과의 일치를 검증한다.
- HTTP 전송에는 DB 필드 4,000byte 제약이 적용되지 않는다. 회사에서 한 번의 전달 용량 제한이 없음을 확인했다. 전체 JSON을 C 프로그램 메모리에서 완성하고 한 번의 응답 본문으로 보낸다.

## 7 C언어 조회와 JSON 생성

**쉽게 이해하기** C 프로그램은 장부에서 읽은 내용을 화면용 문서로 작성하는 담당자이다. 한 칸씩 4,000byte로 나누는 작업은 필요 없다. 문서를 다 만든 다음 회사의 기존 전송 기능에 문서 내용과 전체 byte 수를 넘기면 된다.

외부 코드 사용 금지를 확정 전제로 반영했다. JSON 생성부는 이 프로젝트에서 작성한 C99 코드와 표준 C 라이브러리의 realloc free memcpy strlen snprintf만 사용한다. 외부 JSON 라이브러리 설치 반입 링크 또는 승인은 필요 없다. Altibase 접속과 통신 및 문자체계 변환은 회사가 이미 사용하는 기능에 연결하며 새 외부 코드를 도입하지 않는다. 예제는 일반 JSON 파서가 아니라 현재 화면의 고정 규격을 작성하는 전용 출력 함수이다.

| 예제 파일 | 역할과 교체 지점 |
| --- | --- |
| [ust_v2_json.h](c-example/ust_v2_json.h) | DB 조회 콜백과 전체 JSON 생성 함수의 공통 약속 |
| [ust_v2_json.c](c-example/ust_v2_json.c) | 실제 SELECT 문과 현재 버전 고정 meta countries months records 생성 숫자 NULL 처리 |
| [ust_v2_odbc.h](c-example/ust_v2_odbc.h) 및 [ust_v2_odbc.c](c-example/ust_v2_odbc.c) | 이미 접속한 Altibase ODBC 핸들로 조회하고 회사 응답 함수로 전달 회사 CLI 또는 내장 SQL을 쓰면 조회 어댑터만 교체 |
| [v2-fetch-example.js](c-example/v2-fetch-example.js) | 브라우저에서 전체 JSON을 한 번 받아 기존 v2 초기화를 실행하는 연결 예제 |

### C 프로그램의 처리 순서

1. 회사 요청 처리기에서 로그인과 권한을 확인하고 이미 연결된 Altibase 접속 핸들을 확보한다. 예제에 DB 접속문자열이나 비밀번호를 넣지 않는다. 요청별 연결을 사용하거나 회사 연결 풀에서 독점 대여한다.
2. UST_SERVICE_STATE와 PASS 버전을 조회해 DATASET_ID를 한 번 고정한다. 이후 모든 SELECT는 같은 번호를 바인드한다. 사용자 입력이나 버전 번호를 SQL 문자열에 직접 붙이지 않는다.
3. 자료 설명과 원본 3개를 조회한다. meta.sources는 T3 T5 HIST 순서로 만든다. UTC 저장 시각은 날짜 구조체로 읽고 ISO 문자열로 만든다.
4. 국가 목록은 DISPLAY_ORDER 순서로, 월 목록은 중복 제거 후 오름차순으로 조회한다. 월별 수치는 국가코드 기준월 순서로 읽고 고정 10열 배열을 만든다.
5. 금액은 ASCII 숫자 문자열로 읽어 NULL 여부 문법 소수 자릿수 범위를 확인하고 JSON 숫자로 작성한다. 국가명 등 문자열은 자체 quoted 함수가 UTF-8을 검사한 뒤 따옴표와 역슬래시 및 제어문자를 JSON 규칙대로 변환한다. DB 문자체계가 UTF-8이 아니면 조회 어댑터에서 회사 표준 변환 함수를 적용한다.
6. 출력 건수와 DB 버전의 기대 건수가 같은지 확인하고 전체 JSON 문자열을 메모리에서 완성한다. 실패하면 부분 자료를 보내지 않고 503 오류 JSON을 만든다.
7. 회사 응답 함수를 통해 HTTP 200 Content-Type application/json; charset=utf-8 Cache-Control private, no-store 및 전체 본문을 전달한다. Content-Length를 설정한다면 글자 수가 아닌 byte 수를 사용한다.
8. 동기 전송이 본문을 소비하거나 복사한 뒤 메모리를 해제한다. 비동기 통신이면 회사 전송 큐가 별도 복사본을 소유해야 하며 전송 완료 전에 해제하면 안 된다.

### 실제 조회 SQL과 항목 배치

```sql
SELECT h.COUNTRY_CODE, h.REFERENCE_MONTH, h.TOTAL_USD_MN,
       h.LT_USD_MN, h.ST_USD_MN, h.NET_USD_MN,
       h.LT_NET_USD_MN, h.ST_NET_USD_MN, h.LT_VAL_USD_MN,
       s.SOURCE_CODE
FROM UST_HOLDING h
JOIN UST_SOURCE_FILE s ON s.SOURCE_FILE_ID = h.SOURCE_FILE_ID
                     AND s.DATASET_ID = h.DATASET_ID
WHERE h.DATASET_ID = ?
ORDER BY h.COUNTRY_CODE, h.REFERENCE_MONTH;
```

물음표에는 처음 고정한 DATASET_ID를 SQLBindParameter로 연결한다. 예제는 SQLPrepare → SQLBindParameter → SQLExecute → SQLFetch → SQLGetData 순서로 자료를 읽는다. SQL_NULL_DATA는 C의 NULL 포인터로 넘기고 JSON 생성부가 null로 바꾼다. SQL_SUCCESS_WITH_INFO를 포함한 경고는 잘림 또는 변환 오류 가능성이 있으므로 예제에서는 실패 처리하며 실제 사내 진단 처리에 연결한다.

### 자체 JSON 작성 함수의 책임

| 함수 | 처리 기준 |
| --- | --- |
| reserve bytes put | 범위 초과를 확인하고 문자열 공간을 늘린 뒤 끝의 NULL 문자를 유지 |
| utf8 quoted | 한글과 4byte 유니코드를 검증하고 따옴표 역슬래시와 0x01부터 0x1F까지 제어문자를 이스케이프 내장 NUL은 조회 어댑터에서 거부 |
| decimal | 숫자는 따옴표 없이 기록 NULL은 null 실제 0은 0으로 보존 |
| source country period record | 배열의 첫 행 여부를 세어 쉼표를 붙이고 고정 규격 순서를 유지 |
| ust_v2_build ust_v2_free | 전체 성공 후에만 본문 소유권을 반환하고 모든 실패 경로에서 임시 버퍼 정리 |

JSON을 문자열로 작성해도 매번 임의로 sprintf를 반복하는 방식은 사용하지 않는다. 이 프로젝트의 전용 함수에 경계 검사와 이스케이프를 모으고 테스트를 유지한다. 범용 JSON 입력 해석 기능은 서버에 필요 없으므로 구현하지 않는다. 개발 PC에서만 표준 도구로 입력과 출력을 대조하며 운영 C 서버에는 Python 테스트 도구를 배포하지 않는다.

### C에서 전체 JSON을 만드는 호출 예제

```c
UstReader reader;
char *body = NULL;
char error[64];
size_t byte_length = 0;

reader.db = (void *)connected_altibase_handle;
reader.query = ust_v2_odbc_query;

if (ust_v2_build(&reader, &body, &byte_length, error, sizeof(error))) {
    /* 사내 응답 함수로 200과 전체 body를 전송 또는 복사 */
    company_send_json(200, body, byte_length);
    ust_v2_free(body);
} else {
    /* 아직 성공 헤더나 부분 데이터를 보내지 않은 상태 */
    company_send_json(503, "{\"error\":\"UST_DATA_UNAVAILABLE\"}",
                      strlen("{\"error\":\"UST_DATA_UNAVAILABLE\"}"));
}
```

위 company_send_json은 설명을 위한 회사 함수 자리이다. 완성된 어댑터 예제의 ust_v2_handle_request는 회사 응답 콜백 UstSend를 인자로 받는다. 개발자는 실제 웹서버 응답 함수에 그 콜백을 연결한다. 독립 실행형 웹서버를 새로 만들거나 별도 언어 서버를 설치할 필요가 없다.

### 숫자와 메모리 처리 기준

- JSON 생성 함수는 성공 시 body 포인터와 전체 byte_length를 반환하고 실패 시 body=NULL 길이=0을 보장한다. 성공 본문은 ust_v2_free로 해제한다. 메모리 할당 실패도 정상적인 오류 경로로 처리한다.
- 예제는 금액을 먼저 double로 바꾸지 않고 decimal 함수에서 숫자 전체의 문법과 범위를 검사한 뒤 숫자 토큰으로 기록한다. DB 문자열을 검사 없이 본문에 붙이면 JSON 문법 오류나 주입이 가능하므로 이 검사를 생략하지 않는다. 소수점은 마침표이고 3자리까지 허용한다. 쉼표 지수 표기 NaN Infinity와 선행 0은 거부한다.
- 소수 3자리 단위로 환산한 절대값이 JavaScript의 안전 정수 한도 9,007,199,254,740,991 이하인지 확인한다. 이는 브라우저의 큰 수 오차를 제한하는 보수적인 기준이며 모든 소수를 이진수로 완전히 정확히 표현한다는 뜻은 아니다. 화면의 기존 반올림 규칙을 유지한다.
- ODBC 어댑터의 4,096byte 배열은 개별 DB 칸을 읽는 임시 공간이다. 전체 응답 크기 제한이나 분할 전송 크기가 아니다. UTF-8 변환 후 크기도 확인하고 실제 회사 드라이버가 반환하는 길이 규약을 검수한다.
- 원본 입수시각은 UTC 저장 계약을 지킨다. 날짜 구조체의 소수초는 드라이버가 제공하는 범위에서 보존하고 끝의 0만 정리한다. 회사 버전의 날짜 정밀도를 실제로 확인한다.
- 전용 Buffer 구조체가 필요한 만큼만 메모리를 확장한다. 길이 덧셈과 용량 두 배 계산의 범위 초과를 먼저 차단하고 realloc 실패 시 이전 포인터를 보존해 정리한다. 자료 구역별 임시 문자열과 최종 문자열이 동시에 존재하므로 최대 메모리는 최종 JSON 크기보다 크다. 이는 메모리 내부 조립이며 DB 조각 저장이나 분할 전송이 아니다.

작성 시 검증: C99 컴파일러로 JSON 생성부와 테스트를 컴파일하고 현재 스냅샷 19,815행을 변환하여 국가 목록 월 목록 7개 수치 NULL 및 기존 메타정보를 비교했다. 한글 따옴표 줄바꿈과 0 음수 소수 입력도 확인했다. 조회 실패 자료 미지정 출처 순서 오류 건수 불일치 잘못된 숫자 큰 수 쉼표 선행 0 소수 초과 최초 할당 실패 확장 실패 월 순서 오류 잘못된 UTF-8 빈 숫자 NaN 지수 표기의 16가지 오류 입력이 본문 생성 없이 거부됨을 확인했다. ODBC 어댑터는 일반 ODBC 헤더로 컴파일 검사했으며 회사 Altibase 접속 검증은 아니다. [테스트 실행 방법](../../tests/c/README.md)에 재현 절차를 제공한다.

### 컴파일과 회사 코드 연결

```sh
/* 표준 C JSON 생성부 자체 컴파일 */
cc -std=c99 -Wall -Wextra -c ust_v2_json.c

/* DB 어댑터는 회사 기존 접속 헤더와 라이브러리만 사용 */
cc -std=c99 -Wall -Wextra -I<회사_Altibase_헤더> -c ust_v2_odbc.c

/* 별도 JSON 라이브러리나 JSON용 링크 옵션은 없다. */
```

예제는 자체 main 함수와 DB 로그인 코드를 제공하지 않는다. 기존 회사 요청 처리기의 로그인 확인 → DB 연결 확보 → ust_v2_handle_request → 연결 반환 순서로 삽입한다. 컴파일러의 소스 인코딩은 UTF-8로 지정한다. 프로덕션 빌드에는 테스트용 UST_JSON_TESTING 매크로를 넣지 않는다. JSON 작성부는 요청별 버퍼를 사용하고 외부 초기화 함수나 전역 locale 변경이 필요 없다. 실제 회사 CLI를 직접 쓰는 경우 UstQuery 계약에 맞게 결과를 넘기면 JSON 생성부는 유지할 수 있다.

기존 수집 스크립트의 다운로드 해시 파싱 검증 규칙도 C 프로그램으로 이식한다. 다운로드와 SHA 계산은 회사에 이미 제공된 C 기능을 사용하거나 사내에서 작성하며 새 외부 코드를 반입하지 않는다. 해당 기능을 자체 구현하는 경우 별도 검증을 수행한다. 또한 표 헤더 탐색 NULL 처리 과거 연결과 T5 검증을 같은 기준으로 구현한다. 원본 반입이 별도 사내 시스템에서 이미 이뤄지면 그 입수 결과를 C 적재 프로그램의 입력으로 사용한다.

## 8 v2 화면 연결 방법

현재 데이터 읽기는 `JSON.parse(document.getElementById("tic-data").textContent)`이며 그 다음에 국가·월 조회표와 파생지표를 만들고 Vue 화면을 시작한다. 운영용 화면에서는 Vue 의존성을 제거하고 자체 DOM 이벤트 SVG 렌더링 함수로 전환한 뒤 비동기 데이터 초기화 함수에 연결한다. 아래는 구현 개념이며 적용 완료 코드가 아니다.

```text
화면에 불러오는 중 표시
try
  사내 API 요청
  HTTP 상태와 JSON 규격 검사
  응답의 전체 자료 버전 고정
  기존 국가 월 조회표와 계산 생성
  자체 JavaScript 화면 렌더링 실행
catch
  오류 안내와 다시 시도 버튼 표시
  오래된 내장 자료를 최신 자료처럼 자동 표시하지 않음
```

HTML의 오래된 내장 데이터는 운영용에서 제거하거나 명확한 별도 개발 모드로 격리한다. 읽기 실패 시 자동 대체하면 예전 숫자가 최신 DB 자료인 것처럼 보일 수 있다. 재조회는 기존 DOM과 이벤트를 정리하거나 자체 데이터 상태를 갱신하는 방식으로 구현하며 이벤트를 중복 등록하지 않는다. 빠른 연속 요청은 마지막 요청만 반영한다.

| 유지할 계산 | 기준 |
| --- | --- |
| 증감액 증감률 | 정확히 1 3 6 12개월 전과 비교 월 누락 또는 분모 0이면 null |
| 점유율 | 같은 달 Grand Total 코드 99996을 분모로 사용 |
| 장단기 비중 | 같은 행 총보유액을 분모로 사용 |
| 기타 조정 | 2023-02 이후 당월−전월−순거래−장기채 평가변동 필요한 값 없으면 null |
| 국가 순위 | country와 순위 포함 항목만 총보유액 내림차순 기존 동률 순서 유지 |
| 시작월 100 | 선택 기간 시작월 기준 기존 계산 NULL 규칙 유지 |
| 단위와 CSV | 저장은 백만 달러 표시 단위 전환과 현재 CSV 필터 정렬 유지 |

현재 v2 HTML에는 Vue 외부 코드가 내장되어 있다. 외부 주소를 호출하지 않거나 코드를 HTML 안에 넣어도 자체 코드가 되는 것은 아니다. 외부 코드 금지 운영본에서는 내장 Vue와 템플릿 의존성을 제거하고 표준 JavaScript의 DOM 이벤트와 SVG로 같은 화면 기능을 구현한다. 사전 컴파일만으로 외부 코드 금지를 해결했다고 간주하지 않는다. DB 비밀번호나 외부 수집 권한은 HTML에 넣지 않는다.

### 화면에 전달하는 구체적인 절차

1. 회사 웹서버에 GET /api/ust-holders/v2/data 요청 경로를 등록하고 C 요청 처리기에 연결한다.
2. C 처리기가 완성한 전체 JSON을 응답한다. 인증 오류는 회사 정책에 따라 401 또는 403, 데이터 생성 실패는 503으로 전달한다. DB 진단과 비밀번호를 응답 본문에 넣지 않는다.
3. 브라우저의 v2-fetch-example.js 연결 부분이 fetch를 한 번 실행하고 응답을 JSON 객체로 읽는다. 이 JavaScript는 서버 프로그램이 아니라 기존 화면을 연결하는 브라우저 코드이다.
4. 기존 v2의 국가 월 조회표와 계산 규칙을 자체 startDashboard(data)에 적용하고 Vue 템플릿 부분은 표준 DOM 이벤트 SVG 렌더링 코드로 옮긴다. 단순히 기존 Vue 초기화 함수를 호출하는 방식은 외부 코드 금지 운영 설계가 아니다. 단순히 const data 한 줄만 fetch로 바꾸고 뒤 코드를 먼저 실행하면 안 된다.
5. 성공하면 기존 KPI 표 차트 상세 CSV가 같은 데이터를 사용한다. 새로고침은 DB 현재 서비스 버전 전체를 다시 받아 화면 상태를 갱신하며 외부 원본 수집을 실행하지 않는다.

함께 제공한 JavaScript는 연결 조각이다. 로딩 표시 오류 표시 자체 DOM 렌더링 이벤트 정리 재요청 취소 또는 직렬화는 실제 운영용 화면 통합 시 구현한다. 이 작업에서 운영용 UST_Holders_v2.html 자체를 변경하거나 API를 배포하지는 않는다.

## 9 장애 대응과 운영

| 상황 | 처리 | 사용자에게 보이는 상태 |
| --- | --- | --- |
| 원본 게시 지연 T3 T5 최신월 불일치 | 새 버전 게시 보류 유한 횟수 재시도 실패 이력과 운영 알림 | 기존 검증 자료 유지 기준월과 수집시각 표시 |
| 원본 형식 변경 신규 미매핑 | 자동 추정 대신 실패 규칙 수정 후 버전 올려 재처리 | 기존 검증 자료 유지 |
| 적재 중 서버 종료 | RUNNING 장기 미종료와 LOADING을 운영 점검 대상 처리 새 실행으로 재처리 | 기존 검증 자료 유지 |
| 검증 실패 | 새 버전 FAIL 문제 키와 값 기록 원본 유지 | 기존 검증 자료 유지 |
| 새 서비스 자료 오류 | 이전 PASS로 포인터 복구 사내 감사 이력 기록 | 이전 검증 자료 조회 |
| DB 또는 API 장애 | 오류 상태와 재시도 표시 모니터링 알림 | 숫자 0이나 예전 내장 자료로 자동 대체하지 않음 |

- 수집 시점은 공식 월간 발표 일정과 실제 파일 갱신을 확인해 결정한다. 고정 발표일이나 현재 기준월을 프로그램에 넣지 않는다. 예정일을 놓친 실패 알림과 자료 신선도 알림 기준은 업무 담당자와 합의한다.
- 재시도 간격 횟수 회사 내 게시 목표시간 동시 사용자 수 응답시간 목표 원본과 버전 보관 기간 백업 복구 목표는 운영자가 확정한다. 이 설계서는 임의의 서비스 수준을 확약하지 않는다.
- 원본 입수 시각 공식 발표시각 자료 기준월 사내 게시시각을 구분해 기록한다. 원본과 DB 버전은 함께 백업하고 이전 PASS 복구 절차를 정기 확인한다.
- 읽기 API 계정은 필요한 SELECT만, 적재 계정은 대상 적재와 검증 작업 권한을, 서비스 전환 계정은 승인된 전환 권한을 부여한다. 상세 접근권한 분리는 회사 정책을 따른다.
- 로그에는 실행 ID 버전 ID 실패 단계 오류 코드 원본 확인값을 남기고 DB 접속문자열 비밀번호 전체 응답 내용을 남기지 않는다. 메시지가 칼럼 한도를 넘으면 요약과 상세 로그 위치를 저장한다.
- 보관 자료 정리는 현재 서비스 버전과 복구용 버전 및 실행 중 버전을 제외하고 승인된 정책으로 수행한다. UST_SOURCE_FILE과 원본 보관소 연결을 함께 정리하며 참조 중인 원본을 먼저 삭제하지 않는다.

### 회사 환경에서 확정할 항목

| 확인 항목 | 담당과 결정 내용 |
| --- | --- |
| Altibase 환경 | DBA가 정확한 버전 문자체계 숫자형 날짜형 FK 인덱스 행 잠금 커밋 동작과 저장공간 확인 |
| 회사 서버 환경 | C언어만 사용 확정 C 컴파일러 버전 Altibase CLI 또는 ODBC 헤더 라이브러리 UTF-8 변환과 회사 응답 콜백 확인 |
| 외부 입수 경로 | 운영 보안 담당자가 외부접속 허용 구간 승인 반입 경로 원본 보관 위치 확정 |
| 운영 정책 | 업무 운영 담당자가 수집 게시 목표 재시도 알림 보관 및 복구 정책 확정 |
| 성능 기준 | 전달 방식 및 1회 용량 제한 없음 확정 C 메모리 동시 접속 응답시간과 브라우저 사용성을 측정 |
| 외부 코드 금지 | 새 외부 JSON 코드 도입 없음 자체 C 작성 함수 코드 검토 회사 기존 DB 접속 문자 변환 및 통신 기능에 연결 |

## 10 개발 순서와 인수 기준

| 단계 | 개발 작업 | 완료 확인 |
| --- | --- | --- |
| 1 환경과 DB | 회사 환경 확인 SQL 검토 개발 DB에 8개 표 생성 | 회사 버전에서 생성과 조회 잠금 커밋 롤백 확인 |
| 2 적재 | 기존 data/raw 세 원본으로 동일 규칙 적용 전체 버전 적재 | 국가 월 7개 수치 NULL 출처 메타가 기준 스냅샷과 일치 |
| 3 API | 고정 버전 조회와 JSON 변환 오류처리 구현 | countries 순서 records 열과 source_index 및 모든 meta 키 확인 |
| 4 화면 | API 초기화 연결 및 Vue를 자체 DOM 이벤트 SVG 코드로 전환 | 운영본 외부 코드 제거와 기존 v2 대비 KPI 표 차트 CSV 일치 |
| 5 운영 | 수집 일정 이력 알림 전환 복구 백업 구성 | 실패 시 유지 동시 요청 혼합 방지 이전 버전 복구 실증 |
| 6 개통 | 같은 원본의 정적 v2와 사내 화면 병행 비교 | 업무 개발 운영 담당자 인수 후 사내 게시 |

### 필수 인수 시나리오

1. 동일한 로컬 원본으로 132개 항목 178개월 19,815행 및 7개 수치 NULL 코드 출처가 현재 스냅샷과 일치한다. 이 건수는 해당 원본의 인수 기준일 뿐 다음 발표의 고정 조건이 아니다.
2. DB → JSON → 화면의 왕복 검증을 수행한다. meta sources 항목별 시각 SHA와 국가 순서 레코드 키 수치의 차이가 없어야 한다. 응답 JSON 객체 키 순서나 공백만의 차이는 실패로 보지 않는다.
3. 일부 수치 0과 NULL, 비교월 누락, 합계행, 과거 HIST 출처, 동률 국가를 각각 검수한다. 기준월 단위 비교기간 국가검색 상세 비교국 차트 확대 및 CSV를 확인한다.
4. 원본 파일 누락 최신월 불일치 SHA 오류 미매핑 국가 중복키 숫자 초과 적재 중 종료 필수 검증 SKIP을 각각 주입해 기존 서비스 버전이 유지되는지 확인한다.
5. 같은 원본 재실행은 NO_CHANGE이고 자료가 중복되지 않는다. 같은 기준월의 수정 원본과 규칙 변경은 새 버전이 생성된다. 더 오래된 원본은 자동 게시되지 않는다.
6. 전환 직전과 직후 API를 동시에 요청해 응답마다 한 버전만 들어 있는지 확인한다. 변경 전 PASS로 복구한 후 새로고침 결과를 확인한다.
7. 로그인 만료 401/403, DB 장애 503, UTF-8 변환 SQL 경고 메모리 할당 실패와 사내 CSP를 검수한다. 최초 로딩과 재시도가 작동하고 오프라인 내장 자료를 최신으로 오인시키지 않는다.
8. C 예제 생성 JSON을 기존 스냅샷과 비교한다. NULL 0 음수 소수와 따옴표 역슬래시 줄바꿈 포함 문자열을 확인한다. 잘못된 숫자 과도한 정밀도 출처 순서 오류 건수 불일치 조회 실패 시 본문이 만들어지지 않아야 한다.

## 11 전달 파일과 참고 자료

| 파일 | 용도와 상태 |
| --- | --- |
| [UST_Holders_Altibase_Design.md](UST_Holders_Altibase_Design.md) | 업무 설명과 테이블 항목 절차 전달 규격 인수 기준을 담은 본 설계서 |
| [create_tables.sql](create_tables.sql) | 8개 표와 키 인덱스 생성 초안 회사 DB 미실행 DBA 검토 후 사용 |
| [v2-response-example.json](v2-response-example.json) | 현행 meta와 10열 배열을 설명하는 예시 운영 게시용 아님 |
| [C JSON 생성 예제](c-example/ust_v2_json.c) 및 [Altibase 조회와 응답 예제](c-example/ust_v2_odbc.c) | 제7장 관련 C 구현 참고 실제 회사 DB 및 통신 어댑터 검수 필요 |
| [화면 연결 예제](c-example/v2-fetch-example.js) | 제8장 관련 브라우저 초기화 연결 조각 |
| [C JSON 생성 테스트](../../tests/c/test_ust_v2_json.c) | 실제 DB 접속을 대체한 입력으로 생성 결과와 오류 처리를 검사 |

현재 구현 근거: [UST_Holders_v2.html](../../UST_Holders_v2.html), [prepare-data.mjs](../../scripts/prepare-data.mjs), [validate-data.mjs](../../scripts/validate-data.mjs), [update-v2-data.mjs](../../scripts/update-v2-data.mjs), [V2_DATA_COLLECTION.md](../V2_DATA_COLLECTION.md), [DESIGN_AND_DATA.md](../DESIGN_AND_DATA.md), [INGESTION_ARCHITECTURE.md](../INGESTION_ARCHITECTURE.md), [기존 DB 모델](../../src/db/models/core.py). 기존 PostgreSQL 문서와 본 Altibase 목표 설계를 구분한다.

공식 기술 참고: [Altibase 7.1 CREATE TABLE](https://manual.altibase.com/7.1/en/ref/sql/3.-Data-Definition-Language/CREATE-TABLE/), [트랜잭션 관리](https://manual.altibase.com/7.1/en/admin/administrator/8.-Managing-Transactions/), [문자형 자료형](https://manual.altibase.com/7.3/en/ref/general/1.-Data-Types/Character-Data-Types/), [미 재무부 공식 발표 일정](https://home.treasury.gov/data/treasury-international-capital-tic-system/release-dates-of-tic-data). 버전별 문서의 최대 길이를 회사 시스템의 승인 한도와 동일시하지 않는다.

C 예제 기술 참고: [Altibase SQLFetch](https://manual.altibase.com/7.1/dev/cli/2.-Altibase-CLI-Functions/SQLFetch/), [Altibase 공식 ODBC 설명](https://github.com/ALTIBASE/Documents/blob/master/Manuals/Altibase_7.1/eng/ODBC%20User%27s%20Manual.md). 문서는 접속 규격 참고용이며 외부 구현 코드를 반입하지 않는다. 실제 회사 버전의 API와 자료형 지원을 우선한다.

설계서 작성 검증 범위: 저장소의 기존 데이터와 C JSON 생성 예제의 결과를 비교하고 오류 입력 처리를 검사한다. 테스트 입력의 DB 대체기는 실제 Altibase 연결을 검증하지 않는다. Altibase 실서버 조회 DATE 및 문자 변환 회사 통신 콜백 연동 전체 수집·적재 C 이식 성능과 복구는 회사 환경에서 인수해야 한다.

UST Holders v2 · Altibase C언어 운영 설계 · 2026-10-28
