#!/usr/bin/env bash
# Audiveris(오선보 대안, AGPL-3.0 — 호출만)를 ~/gugak-engines/audiveris 에 둔다. (T037, research R2)
#  - macOS 판(DMG)의 Audiveris.app 을 복사해 쓴다. 5.11 은 Java 25 로 빌드되어(class 69)
#    PATH 밖 Java 21(/opt/homebrew/opt/openjdk@21/bin/java)로는 돌지 않는다 → 앱에 들어 있는 런타임으로 실행.
#    Java 21 로 돌 수 있는 판(5.4 이하)을 쓰려면 AUDIVERIS_VERSION 과 AUDIVERIS_DMG_URL 을 바꾼다.
#  - 이미 설치돼 있으면 건너뛴다(덮어쓰지 않음).
set -euo pipefail
ENGINES_DIR="${ENGINES_DIR:-$HOME/gugak-engines}"
DIR="$ENGINES_DIR/audiveris"
AUDIVERIS_VERSION="${AUDIVERIS_VERSION:-5.11.0}"
ARCH="$(uname -m)"; [[ "$ARCH" == "arm64" ]] || ARCH="x86_64"
AUDIVERIS_DMG_URL="${AUDIVERIS_DMG_URL:-https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-macosx-${ARCH}.dmg}"
JAVA21="${JAVA21:-/opt/homebrew/opt/openjdk@21/bin/java}"

if [[ -x "$DIR/Audiveris.app/Contents/MacOS/Audiveris" ]]; then
  echo "[audiveris] 이미 설치됨: $DIR — 건너뜀 (VERSION: $(cat "$DIR/VERSION" 2>/dev/null || echo 없음))"
  exit 0
fi
if [[ -d "$DIR" && -n "$(ls -A "$DIR" 2>/dev/null)" ]]; then
  echo "[audiveris] $DIR 에 다른 파일이 있고 Audiveris.app 은 없음 — 누가 설치 중일 수 있어 멈춤(사람 확인)" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'hdiutil detach "$TMP/mnt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
echo "[audiveris] 받는 중: $AUDIVERIS_DMG_URL"
curl -fL --retry 3 -o "$TMP/a.dmg" "$AUDIVERIS_DMG_URL"
mkdir -p "$TMP/mnt"
# DMG 에 사용권 동의 화면이 있어 yes 로 동의해 연다(AGPL — 고치지 않고 호출만)
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$TMP/mnt" "$TMP/a.dmg" >/dev/null < <(yes)
mkdir -p "$DIR"
cp -R "$TMP/mnt/Audiveris.app" "$DIR/"
hdiutil detach "$TMP/mnt" >/dev/null

echo "$AUDIVERIS_VERSION" > "$DIR/VERSION"
RUNTIME_JAVA="$(grep -m1 JAVA_VERSION "$DIR/Audiveris.app/Contents/runtime/Contents/Home/release" 2>/dev/null | cut -d'"' -f2 || true)"
JAVA21_OK="no"
if [[ -x "$JAVA21" ]] && "$JAVA21" -Djava.awt.headless=true -cp "$DIR/Audiveris.app/Contents/app/*" Audiveris -version >/dev/null 2>&1; then
  JAVA21_OK="yes"
fi
{
  echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source=$AUDIVERIS_DMG_URL"
  echo "bundled_runtime_java=$RUNTIME_JAVA"
  echo "java21_path=$JAVA21 java21_runs=$JAVA21_OK"
} > "$DIR/INSTALL_INFO"
echo "[audiveris] 설치 끝: $DIR (Audiveris $AUDIVERIS_VERSION, 앱 런타임 Java $RUNTIME_JAVA, Java21 실행 $JAVA21_OK)"
