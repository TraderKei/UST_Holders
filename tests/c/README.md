# C JSON 생성 예제 검증

이 테스트는 `docs/altibase/c-example/ust_v2_json.c`의 실제 JSON 생성 함수를 실행합니다. 회사 서버 실행 의존성은 C와 승인된 cJSON이며, 이 테스트도 C로 작성되어 있습니다. 실제 DB 대신 기존 JSON 스냅샷을 읽어 조회 결과를 제공하므로 Altibase 드라이버·SQL 실행·잠금·회사 통신 기능을 검증하지 않습니다.

회사 또는 개발 PC의 C99 컴파일러와 승인된 동일 버전의 `cJSON.h`, `cJSON.c`를 준비합니다. 외부 코드는 저장소에 포함하지 않습니다. 아래는 POSIX 셸의 명령 형태 예시이며 경로·출력 확장자·링크 옵션은 환경에 맞게 조정합니다. 컴파일러는 UTF-8 소스를 읽도록 설정합니다.

```sh
cc -std=c99 -Wall -Wextra \
  -I<승인된_cJSON_경로> -Idocs/altibase/c-example \
  tests/c/test_ust_v2_json.c docs/altibase/c-example/ust_v2_json.c \
  <승인된_cJSON_경로>/cJSON.c -lm -o test_ust_v2_json

./test_ust_v2_json dashboard/public/data/tic.json > generated.json
```

정상 실행은 JSON을 출력하고 종료 코드 0을 반환합니다. 출력 전 입력 스냅샷의 국가·월·레코드 및 메타정보와 비교합니다. 서비스 환경을 뜻하는 `source_mode`, 상태 설명 `status`, 추가 식별자 `dataset_id`는 운영 예제의 정의를 적용합니다. 현재 데이터의 19,815개 행과 NULL·출처 번호가 유지되어야 합니다. 소수·문자열 특수문자 검증에는 기존 행 수와 자료 설명을 유지한 별도 스냅샷을 만들어 같은 명령을 실행합니다.

오류 상황은 두 번째 인자로 지정합니다. 아래 각 명령은 오류 응답 전 단계에서 본문을 만들지 않는 것을 확인하고, 그 검사에 성공하면 종료 코드 0과 표준 오류의 `PASS rejected ...`를 반환합니다. 실패 검사에서 JSON이 표준 출력으로 나오면 안 됩니다.

```sh
./test_ust_v2_json dashboard/public/data/tic.json no-current
./test_ust_v2_json dashboard/public/data/tic.json query-error
./test_ust_v2_json dashboard/public/data/tic.json bad-count
./test_ust_v2_json dashboard/public/data/tic.json bad-source
./test_ust_v2_json dashboard/public/data/tic.json bad-number
./test_ust_v2_json dashboard/public/data/tic.json large-number
./test_ust_v2_json dashboard/public/data/tic.json comma-number
./test_ust_v2_json dashboard/public/data/tic.json leading-zero
./test_ust_v2_json dashboard/public/data/tic.json too-precise
./test_ust_v2_json dashboard/public/data/tic.json allocation-error
```

`allocation-error`는 테스트 프로세스 안에서만 메모리 할당 실패를 주입합니다. 서버의 전역 cJSON 훅을 요청마다 바꾸는 구현 예시가 아닙니다. 생성된 실행 파일·검증 출력·외부 라이브러리는 커밋하지 않습니다.
