# TIC 운영 수집 아키텍처

현재 저장소의 Python 운영 파이프라인 기준이다. 정적 v2 HTML 갱신 절차는 [v2 데이터 수집 문서](V2_DATA_COLLECTION.md)를 참고한다.

## 수집 방식

공식 API가 아닌 Treasury의 Table 3 TXT, Table 5 TXT, Historical CSV 파일 URL을 직접 사용한다. 이 파일들은 기존 스냅샷과 필드, 단위, 기간이 일치하고 원본 바이트와 SHA-256을 그대로 감사할 수 있다. HTML 화면 크롤링은 사용하지 않는다.

`Downloader`는 ETag/Last-Modified 조건부 요청과 304 응답을 지원하지만, 현재 `IngestionPipeline`의 일반 수집은 조건부 헤더 없이 세 파일을 다운로드한다. 304 응답을 받은 캐시 원본의 자동 재사용 경로는 연결되어 있지 않다.

## 컴포넌트

- `src/config/settings.py`: `TIC_` 환경변수와 로컬/S3 저장 설정
- `src/ingestion/downloader.py`: HTTP 조건부 요청, 유한 재시도, 응답 무결성 검사
- `src/ingestion/storage.py`: 로컬/S3 호환 무수정 원본 저장
- `src/ingestion/parsers/`: 세 원본의 형식별 파싱과 NULL 보존
- `src/ingestion/pipeline.py`: 기준정보, 원본행, fact, conflict, crosscheck의 적재·검증·승격 조정. `TIC_STORAGE_BACKEND=s3`와 `TIC_S3_BUCKET`이 설정되면 S3 저장 구현을 직접 선택한다.
- `src/validation/runner.py`: 12개 규칙 실행 및 결과·evidence 저장. `src/validation/shadow.py`의 정적 JSON 대조는 별도 `shadow-validate` 명령이다.
- `src/services/vintage_service.py`: 최신 검증 결과의 ERROR PASS 확인과 active 전환
- `src/db/views/sql.py`: 파생지표 View와 국가 순위 MV
- `src/api.py`: active PASS 기본 읽기 인터페이스

## 멱등성과 실패 처리

파일/행 SHA, `source_file_id + row_sha256`, `vintage + entity + period`, 기준월 UNIQUE를 함께 사용한다. 최신 기준월과 세 파일의 결합 SHA로 만든 빈티지 레이블이 같은 재실행은 신규 수집 이력과 파일 스냅샷만 남기고 기존 빈티지와 fact를 재사용한다. 재공표로 바이트가 달라지면 새 빈티지가 생성된다.

다운로드·파싱 후 `--dry-run`이면 DB와 원본 저장소를 변경하지 않는다. 일반 실행은 수집 실행 행을 적재 전에 먼저 커밋한다. `--download-only`는 원본 파일을 저장하고 종료한다. 적재 오류는 현재 작업을 롤백하고 실행을 FAIL로 닫는다. 검증 실패는 신규 빈티지를 비활성 FAIL로 보존한다. 승격은 신규 빈티지 행을 잠그고 최신 PASS 검증과 ERROR 규칙을 다시 확인한 다음, 같은 트랜잭션에서 기존 active를 내리고 신규 빈티지를 올린다. PostgreSQL에서는 이 트랜잭션에서 국가 순위 MV도 갱신한다. 어느 실패 경로에서도 이전 active를 먼저 내리지 않는다.

## Table 5와 충돌

Table 5의 숫자 셀을 long source_record로 보존한다. 매핑된 엔터티의 값만 Table 3 기반 fact와 비교한다. `Of Which`처럼 fact 엔터티가 아닌 행은 evidence의 `unmapped_rows`에 남긴다. 매핑된 값의 비교 누락이나 0.051 USD billion 허용오차 초과는 ERROR 검증 실패다. 비교 건수는 원본에 따라 달라지며, 현재 정적 스냅샷의 결과는 286건이다. Historical과 Table 3가 겹치면 양쪽 source_record를 보존하고 차이가 있는 각 필드를 `vintage_conflict`에 기록하며 fact는 2020-01 이후 Table 3을 채택한다.

## 검증 범위

`ValidationRunner`는 원본 SHA, 최신월, Table 5 교차검증, 합계·구성 항등식, NULL·순위·자연키·원본 값 보존, 잠정치, 빈티지 차이, Historical 원본 경고 등 12개 결과를 저장한다. ERROR 규칙이 모두 PASS여야 승격하며 WARN 결과는 승격을 막지 않는다. 원본 저장 직후에는 로컬/S3에서 다시 읽어 SHA를 확인한다. 검증 규칙의 SHA 재확인은 로컬 `file:` 원본에 적용된다. 정적 `tic.json`과 DB fact의 키·7개 원본 값 비교는 `python -m src.cli shadow-validate --vintage-id <UUID>`로 별도 실행한다.

## 파생지표 NULL 규칙

View는 달력상 정확히 1, 3, 6, 12개월 전 행을 조인한다. 행/값이 없으면 증감은 NULL이며, 0 또는 NULL 분모는 비율 NULL이다. 잔차는 전월, 현재, 순거래, 장기채 평가변동이 모두 있을 때만 계산한다. 순위는 active PASS 빈티지의 `country` 및 `rank_eligible=true`만 포함한다.
