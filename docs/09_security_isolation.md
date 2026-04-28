# 보안과 격리

Gaesup-State는 manifest 검증을 첫 번째 보안 경계로 사용합니다.

## 현재 검증하는 것

- ABI version
- host dependency version
- bundled dependency 선언
- store schema
- import 목록
- permission metadata
- conflict policy

## 중요한 구분

컨테이너가 dependency를 번들링한 경우 host dependency graph를 바꾸지 않습니다. 따라서 host의 다른 버전과 충돌하지 않습니다.

반대로 `source: 'host'`를 선언한 dependency는 host 제공 버전과 반드시 맞아야 합니다.

## Store 격리

store schema가 맞지 않는 컨테이너는 공유 store에 붙으면 안 됩니다.

- `reject`: 실행 차단
- `isolate`: 격리 store namespace 사용

현재 실제 runtime enforcement가 부족한 정책은 보수적으로 차단하는 것이 안전합니다.
