"""homr 어댑터 (오선보 1순위, AGPL-3.0 — 고치지 않고 명령줄로만 부른다). T040

`<venv>/bin/homr [--no-title] <이미지>` → 이미지 옆에 `<이름>.musicxml` 을 쓴다.
"""

from __future__ import annotations

from pathlib import Path

from app.engines.base import VenvEngine

RUNNER = Path(__file__).resolve().parent / "runners" / "homr_runner.py"

_WARMUP = (
    "import pathlib, onnxruntime, homr, homr.main; "
    "[p.read_bytes() for p in pathlib.Path(homr.__file__).parent.rglob('*.onnx')]; print('ok')"
)


class HomrEngine(VenvEngine):
    dist_name = "homr"
    default_folder = "homr"

    def entry(self) -> Path | None:
        exe = self.folder / ".venv" / "bin" / "homr"
        return exe if exe.exists() else None

    def build_command(self, image_path: Path, out_dir: Path) -> list[str]:
        cmd = [str(self.entry())]
        if self.config.get("no_title"):  # 제목 OCR 건너뛰기 — 0.7.0 에는 없는 선택지라 설정으로만 켠다
            cmd.append("--no-title")
        return [*cmd, str(image_path)]

    def worker_command(self) -> list[str] | None:
        """상주 작업자(2026-09-30 C2·C3): homr 가상환경 파이썬으로 homr_runner.py(AGPL-3.0)를 띄운다.
        --no-title 설정이면 명령줄과 같게 할 수 없어 상주하지 않는다."""
        if self.config.get("no_title"):
            return None
        return [str(self.folder / ".venv" / "bin" / "python"), "-B", str(RUNNER)]

    def warmup_command(self) -> list[str]:
        # -B: .pyc 를 쓰지 않아 가상환경을 바꾸지 않는다. 가중치 파일을 읽어 디스크 캐시를 데운다
        return [str(self.folder / ".venv" / "bin" / "python"), "-B", "-c", _WARMUP]
