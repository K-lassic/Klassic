"""Audiveris 어댑터 (오선보 대안, AGPL-3.0 — 호출만). T040

`Audiveris -batch -export -output <폴더> -- <이미지>` → `<폴더>/<이름>.mxl`.
실행 방법(설정 config_json):
- 기본: 설치 폴더의 Audiveris.app 런처(앱에 든 Java 런타임). 5.11 은 Java 25 빌드라 Java 21 로는 돌지 않는다.
- config.java 가 있고 `use_java: true` 이면 `<java> -cp "<app>/Contents/app/*" Audiveris …` (Java 21 로 도는 옛 판용)
"""

from __future__ import annotations

import os
from pathlib import Path

from app.engines.base import VenvEngine

JAVA_OPTS = ["-Djava.awt.headless=true", "--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED",
             "--enable-native-access=ALL-UNNAMED", "-Dfile.encoding=UTF-8", "-Xmx4G"]


class AudiverisEngine(VenvEngine):
    dist_name = ""
    default_folder = "audiveris"

    def _app(self) -> Path:
        return self.folder / "Audiveris.app"

    def _use_java(self) -> bool:
        java = self.config.get("java")
        return bool(self.config.get("use_java")) and bool(java) and os.path.exists(str(java))

    def entry(self) -> Path | None:
        if self._use_java():
            jar = self._app() / "Contents" / "app" / "audiveris.jar"
            return jar if jar.exists() else None
        launcher = self._app() / "Contents" / "MacOS" / "Audiveris"
        return launcher if launcher.exists() else None

    def _base_cmd(self) -> list[str]:
        if self._use_java():
            cp = str(self._app() / "Contents" / "app" / "*")
            return [str(self.config["java"]), *JAVA_OPTS, "-cp", cp, "Audiveris"]
        return [str(self.entry())]

    def build_command(self, image_path: Path, out_dir: Path) -> list[str]:
        return [*self._base_cmd(), "-batch", "-export", "-output", str(out_dir), "--", str(image_path)]

    def warmup_command(self) -> list[str]:
        # -version: JVM 과 jar 를 한 번 올려 디스크 캐시를 데운다(아무것도 쓰지 않는다)
        return [*self._base_cmd(), "-batch", "-version"]
