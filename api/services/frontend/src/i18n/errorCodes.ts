// 오류 코드 — v0.1.1 shared/error-codes.json 하나가 #19 에서 api/shared/errors/ 세 파일로 나뉘었다.
// 세 파일의 gate_codes · fallback_reasons · status_codes 를 각각 합쳐 v0.1.1 과 같은 모양으로 내준다 (api/shared/README.md 「오류 파일 읽는 규칙」).
// 같은 코드가 두 파일에 있는지는 api/shared/check_errors.py 가 미리 잡는다. 빌드할 때 화면 번들에 들어간다.
import common from '../../../../shared/errors/common.json';
import web from '../../../../shared/errors/web.json';
import model from '../../../../shared/errors/model.json';

const errorCodes = {
  api_version: common.api_version,
  gate_codes: { ...common.gate_codes, ...web.gate_codes, ...model.gate_codes },
  fallback_reasons: { ...common.fallback_reasons, ...web.fallback_reasons, ...model.fallback_reasons },
  status_codes: { ...common.status_codes, ...web.status_codes, ...model.status_codes },
};

export default errorCodes;
