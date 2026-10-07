# TIC 운영 수집 아키텍처

## 수집 방식

공식 API가 아닌 Treasury의 Table 3 TXT, Table 5 TXT, Historical CSV 파일 URL을 직접 사용한다. 이 파일들은 기존 스냅샷과 필드, 단위, 기간이 일치하고 원본 바이트와 SHA-256을 그대로 감사할 수 있다. HTML 화면 크롤링은 사용하지 않는다.

## 컴포넌트

- `config`: 환경변수와 비밀값 비노출 설정
- `ingestion/downloader.py`: HTTP 조건부 요청, 유한 재시도, 응답 무결성 검사
- `ingestion/storage.py`: 로컬/S3 호환 무수정 원본 저장
- `ingestion/parsers`: 세 원본의 형식별 파싱과 NULL 보존
- `ingestion/pipeline.py`: 기준정보, 원본행, fact, conflict, crosscheck의 적재 조정
- `validation`: 12개 규칙 실행, evidence 저장, 정적 JSON shadow 비교
- `services/vintage_service.py`: ERROR PASS 확인과 원자적 active 전환
- `db/views`: 파생지표 View와 국가 순위 MV
- `api.py`: active PASS 기본 읽기 인터페이스

## 멱등성과 실패 처리

파일/행 SHA, `source_file_id + row_sha256`, `vintage + entity + period`, 기준월 UNIQUE를 함께 사용한다. 세 파일의 결합 SHA가 같은 재실행은 신규 수집 이력과 파일 스냅샷만 남기고 기존 빈티지와 fact를 재사용한다. 재공표로 바이트가 달라지면 새 빈티지가 생성된다.

실행 ID는 작업 전에 커밋한다. 파싱·적재 오류는 현재 작업을 롤백하고 실행을 FAIL로 닫는다. 검증 실패는 신규 빈티지를 비활성 FAIL로 보존한다. 승격은 최신 PASS validation을 다시 확인하고 active 행을 잠근 트랜잭션 안에서 교체한다. 어느 실패 경로에서도 이전 active를 먼저 내리지 않는다.

## Table 5와 충돌

Table 5의 숫자 셀을 long source_record로 보존한다. 검증된 엔터티만 Table 3과 비교한다. `Of Which`처럼 fact 엔터티가 아닌 행은 evidence의 unmapped 목록에 남기며 비교 대상인 286건의 누락 또는 허용오차 초과는 ERROR다. Historical과 Table 3가 겹치면 양쪽 source_record를 보존하고 차이가 있는 각 필드를 `vintage_conflict`에 기록하며 fact는 Table 3를 채택한다.

## 파생지표 NULL 규칙

View는 달력상 정확히 1, 3, 6, 12개월 전 행을 조인한다. 행/값이 없으면 증감은 NULL이며, 0 또는 NULL 분모는 비율 NULL이다. 잔차는 전월, 현재, 순거래, 장기채 평가변동이 모두 있을 때만 계산한다. 순위는 active PASS 빈티지의 `country` 및 `rank_eligible=true`만 포함한다.
