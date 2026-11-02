# SPDX-License-Identifier: AGPL-3.0-or-later
# 이 파일은 homr(AGPL-3.0, https://github.com/liebharc/homr)을 가져다 쓰므로 AGPL-3.0 으로 둔다.
# homr 코드는 고치지 않고 공개 함수(homr.main.process_image)를 부르기만 한다. 모델 API 서버의 다른 코드는
# 이 파일을 가져오지 않고 별도 프로세스(homr 가상환경의 파이썬)로만 띄운다(research R2 · design/SD_04 §8-1).
"""homr 상주 작업자 (2026-09-30 조성기 — API 점검 C2·C3).

    <homr venv>/bin/python -B homr_runner.py

homr 명령줄(`homr <이미지>`)과 같은 설정(GPU 자동 판단, 디버그·캐시 끔, XML 기본값)으로 한 번 준비한 뒤,
- 전사 모델(Staff2Score)과 제목 OCR 을 미리 올리고 `@@RESULT@@ {"ready": true}` 를 찍는다.
- 표준 입력 한 줄 {"image": "<경로>"} 마다 `process_image` 를 불러 그림 옆에 `<이름>.musicxml` 을 쓰고
  `@@RESULT@@ {"ok": true}` 또는 {"ok": false, "error": ...} 를 찍는다.
분할 모델(segnet)은 homr 가 호출마다 새로 만든다 — 이 부분은 줄지 않는다.
"""

import json
import os
import sys
import traceback

MARK = "@@RESULT@@ "


def emit(obj: dict) -> None:
    sys.stdout.write("\n" + MARK + json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def prepare():
    import onnxruntime as ort
    from homr import staff_parsing_tromr, title_detection
    from homr.main import ProcessingConfig, download_weights
    from homr.music_xml_generator import XmlGeneratorArguments
    from homr.onnx_providers import coreml_available, cuda_available
    from homr.transformer.configs import Config
    from homr.transformer.staff2score import Staff2Score

    # homr 명령줄 기본값(--gpu auto, --coreml-encoder 없음)과 같게
    transformer_use_gpu = cuda_available()
    segnet_use_gpu = cuda_available() or coreml_available()
    coreml_encoder = False
    download_weights(segnet_use_gpu, transformer_use_gpu, coreml_encoder)
    ort.set_default_logger_severity(3)
    config = ProcessingConfig(False, False, False, False, -1, transformer_use_gpu, segnet_use_gpu, coreml_encoder)
    xml_args = XmlGeneratorArguments(False, None, None)

    # 미리 올리기: process_image 가 첫 호출 때 만드는 것과 같은 설정으로 전역 모델을 채운다
    tcfg = Config()
    tcfg.use_gpu_inference = transformer_use_gpu
    tcfg.use_coreml_encoder = coreml_encoder
    if staff_parsing_tromr.inference is None:
        staff_parsing_tromr.inference = Staff2Score(tcfg)
    title_detection._initialize_reader()
    return config, xml_args


def main() -> int:
    try:
        config, xml_args = prepare()
        from homr.main import process_image
    # 준비 실패는 무엇이든 결과 JSON 으로 알린다
    except Exception as e:  # noqa: BLE001
        emit({"ready": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]})
        return 2
    emit({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            process_image(os.path.abspath(req["image"]), config, xml_args)
            emit({"ok": True})
        # homr 가 내는 예외는 무엇이든 결과 JSON 으로(작업자는 계속 돈다)
        except Exception as e:  # noqa: BLE001
            emit({"ok": False, "error": f"{type(e).__name__}: {e}"[:500]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
