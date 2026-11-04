# v0.1.1 근거 자료 스냅샷 (#140)

재구성(`api/`)의 계약·오류 코드가 어디서 왔는지 `proto_type/` 없이도 볼 수 있게 옮겨 둔 복사본이다. 원본은 git 태그 `v0.1.1` 에 있다 (`git show v0.1.1:proto_type/...`). 이 폴더의 파일은 고치지 않는다.

| 파일 | 원본 경로 (태그 `v0.1.1`) | 쓰는 곳 |
|---|---|---|
| `INTERFACES.md` | `src/app/docs/INTERFACES.md` | `contracts/web-api.yaml` 머리말 근거 (§1·§2·§4·§4-A·§5) |
| `error-codes.json` | `src/app/shared/error-codes.json` | `shared/check_errors.py --compare` 기본 비교 기준 |
| `api.ts` | `src/app/frontend/src/types/api.ts` | 화면이 기대하는 응답 모양 (web 계약 근거) |
