#!/usr/bin/env bash
# check_project.sh — Klassic 국악보 변환 서비스 기동/중지/재시작/상태 점검 (2026-10-02 박예은 — design/SD_04 §4-1)
#
#   ./check_project.sh start   [web|api|all]   기동 → 헬스체크 응답을 기다려 확인 (대상 생략 = all)
#   ./check_project.sh stop    [web|api|all]   중지 → 포트가 닫혔는지 확인 (개발 DB 는 그대로)
#   ./check_project.sh restart [web|api|all]   재시작 → 헬스체크 응답을 기다려 확인
#        web = 웹 서비스(web·admin)   api = API 서비스(model-api·demo)   all = 둘 다 + 입구(gateway)
#        입구는 두 서비스가 함께 쓴다 — web·api 를 켤 때 꺼져 있으면 같이 켜고, 끌 때는 그대로 둔다
#   ./check_project.sh status         pm2 상태 · 포트 열림
#   ./check_project.sh check          status + 헬스체크(내부·입구·공개 주소) + 빌드 산출물 · 디스크. 실패가 있으면 종료 코드 1
#   ./check_project.sh logs [이름]    pm2 로그 따라가기 (이름 생략 시 5개 전부)
#
# 기동 코드는 두 곳에 두지 않는다 — pm2 설정(ops/ecosystem.config.cjs)과 개발 DB(ops/devdb.sh)를 부를 뿐이다.
# 포트는 .env 에서 필요한 키만 꺼내 읽는다. 비밀값(DB_PASSWORD·키·SESSION_SECRET)은 읽거나 출력하지 않는다.

set -uo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP"

ECOSYSTEM="$APP/ops/ecosystem.config.cjs"
APPS=(web admin model-api gateway demo)

# ── .env 에서 포트만 읽는다 (없으면 SD_04 §4 기본값) ─────────────────
env_get() {
  local key="$1" def="$2" val=""
  if [[ -f "$APP/.env" ]]; then
    val="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$APP/.env" | tail -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//; s/^["'\'']//; s/["'\'']$//')"
  fi
  echo "${val:-$def}"
}
GATEWAY_PORT="$(env_get GATEWAY_PORT 9503)"
WEB_PORT="$(env_get WEB_PORT 9523)"
ADMIN_PORT="$(env_get ADMIN_PORT 26101)"
MODEL_API_PORT="$(env_get MODEL_API_PORT 9543)"
DEMO_PORT="$(env_get DEMO_PORT 26102)"
DB_HOST="$(env_get DB_HOST 127.0.0.1)"
DB_PORT="$(env_get DB_PORT 26133)"
DEVDB_PORT="${DEVDB_PORT:-26133}"
PUBLIC_API_URL="$(env_get PUBLIC_API_URL https://p3.sumzip.com/api)"
PUBLIC_ORIGIN="${PUBLIC_API_URL%/api}"

# ── 출력 ──────────────────────────────────────────────────────────
if [[ -t 1 ]]; then G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'; else G=; R=; Y=; B=; N=; fi
FAILS=0
ok()   { echo "  ${G}[정상]${N} $*"; }
bad()  { echo "  ${R}[실패]${N} $*"; FAILS=$((FAILS + 1)); }
warn() { echo "  ${Y}[주의]${N} $*"; }
head_() { echo; echo "${B}== $* ==${N}"; }

need_pm2() {
  command -v pm2 >/dev/null 2>&1 || { echo "pm2 를 찾을 수 없습니다 (npm i -g pm2)"; exit 2; }
}

is_local_devdb() {
  [[ "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "localhost" ]] && [[ "$DB_PORT" == "$DEVDB_PORT" ]]
}

port_open() { nc -z -w 2 127.0.0.1 "$1" >/dev/null 2>&1; }

# pm2 에 등록된 우리 앱의 "이름 상태" 줄. pm2 jlist 는 JSON 이라 python3 로 읽는다.
pm2_states() {
  pm2 jlist 2>/dev/null | python3 -c '
import json, sys
want = set(sys.argv[1:])
try:
    procs = json.load(sys.stdin)
except Exception:
    procs = []
for p in procs:
    if p.get("name") in want:
        e = p.get("pm2_env", {})
        print(p["name"], e.get("status", "?"), e.get("restart_time", 0), p.get("pid", 0))
' "${APPS[@]}"
}

# ── 대상 · 준비 확인 ─────────────────────────────────────────────
TARGET=""; TARGET_APPS=()
resolve_target() {
  case "${1:-all}" in
    web) TARGET=web; TARGET_APPS=(web admin) ;;
    api) TARGET=api; TARGET_APPS=(model-api demo) ;;
    all) TARGET=all; TARGET_APPS=(web admin model-api demo gateway) ;;
    *) echo "대상은 web · api · all 중 하나입니다: ${1}"; exit 2 ;;
  esac
}
join_comma() { local IFS=,; echo "$*"; }

app_port() {
  case "$1" in
    web) echo "$WEB_PORT" ;; admin) echo "$ADMIN_PORT" ;; model-api) echo "$MODEL_API_PORT" ;;
    demo) echo "$DEMO_PORT" ;; gateway) echo "$GATEWAY_PORT" ;;
  esac
}
# 준비 확인 주소와 기대 코드. gateway 는 포트만 본다(뒤의 서비스가 꺼져 있어도 입구 자체는 떠 있을 수 있음)
app_probe() {
  case "$1" in
    web)       echo "http://127.0.0.1:$WEB_PORT/api/health 200" ;;
    admin)     echo "http://127.0.0.1:$ADMIN_PORT/ 302" ;;
    model-api) echo "http://127.0.0.1:$MODEL_API_PORT/v1/health 200" ;;
    demo)      echo "http://127.0.0.1:$DEMO_PORT/demo/ 200" ;;
  esac
}
app_state() { pm2_states | awk -v n="$1" '$1 == n {print $2}'; }

# wait_ready 이름 최대초 — 기동·재시작 뒤 응답할 때까지 기다린다. 모델 API 는 엔진을 데우는 동안 503(loading)
wait_ready() {
  local name="$1" limit="$2" waited=0 code="" url want
  read -r url want <<<"$(app_probe "$name")"
  while (( waited < limit )); do
    if [[ "$name" == gateway ]]; then
      port_open "$GATEWAY_PORT" && { ok "gateway 준비 (${waited}초, 포트 $GATEWAY_PORT)"; return; }
    else
      code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url" 2>/dev/null)"
      [[ "$code" == "$want" ]] && { ok "$name 준비 (${waited}초, $code)"; return; }
    fi
    sleep 2; waited=$((waited + 2))
  done
  if [[ "$name" == model-api ]]; then
    bad "model-api ${limit}초 안에 준비 안 됨 (마지막 ${code:-000}) $(curl -s -m 5 "$url" 2>/dev/null | head -c 200)"
  else
    bad "$name ${limit}초 안에 준비 안 됨 (마지막 ${code:-000}, 기대 ${want:-포트 열림}) — ./check_project.sh logs $name"
  fi
}

# wait_down 이름 — 중지 뒤 포트가 닫혔는지
wait_down() {
  local name="$1" port waited=0; port="$(app_port "$name")"
  while (( waited < 15 )); do
    port_open "$port" || { ok "$name 중지 (포트 $port 닫힘)"; return; }
    sleep 1; waited=$((waited + 1))
  done
  bad "$name 중지했지만 포트 $port 가 아직 열려 있음 — 다른 프로세스가 쓰는지 확인 (lsof -nP -iTCP:$port -sTCP:LISTEN)"
}

ready_all() {
  head_ "준비 확인"
  local a limit
  for a in "${TARGET_APPS[@]}"; do
    case "$a" in model-api|demo) limit=180 ;; *) limit=60 ;; esac
    wait_ready "$a" "$limit"
  done
}

# web · api 만 다룰 때 입구가 꺼져 있으면 같이 켠다
ensure_gateway() {
  [[ "$TARGET" == all ]] && return
  if [[ "$(app_state gateway)" != online ]]; then
    echo "  입구(gateway)가 꺼져 있어 같이 켭니다"
    pm2 start "$ECOSYSTEM" --only gateway >/dev/null
    TARGET_APPS+=(gateway)
  fi
}

preflight() {
  head_ "기동 전 확인 ($TARGET)"
  local missing=0
  if [[ "$TARGET" != api ]]; then
    if [[ -f backend/dist/server.js ]]; then ok "backend/dist/server.js"; else bad "backend/dist/server.js 없음 — npm run build 먼저"; missing=1; fi
    if [[ -f frontend/dist/index.html ]]; then ok "frontend/dist/index.html"; else bad "frontend/dist/index.html 없음 — npm run build 먼저"; missing=1; fi
  fi
  if [[ "$TARGET" != web ]]; then
    if [[ -x model-api/.venv/bin/python ]]; then ok "model-api/.venv"; else bad "model-api/.venv 없음 — 모델 API 가상환경 먼저"; missing=1; fi
  fi
  [[ -f .env ]] && ok ".env" || warn ".env 없음 — 기본 포트로 뜹니다"
  (( missing )) && { echo; echo "기동하지 않았습니다."; exit 1; }

  if is_local_devdb; then
    head_ "개발 DB (127.0.0.1:$DB_PORT)"
    bash ops/devdb.sh start | sed 's/^/  /'
  else
    head_ "DB"
    echo "  .env DB_HOST=$DB_HOST:$DB_PORT — 개발 DB 가 아니므로 띄우지 않습니다."
  fi
}

finish() {
  echo
  if (( FAILS == 0 )); then
    pm2 save >/dev/null 2>&1
    echo "${G}${B}$1 완료 ($TARGET)${N}"
  else
    echo "${R}${B}$1 중 실패 ${FAILS}건 ($TARGET)${N} — pm2 save 하지 않았습니다"
  fi
}

# ── 명령 ──────────────────────────────────────────────────────────
cmd_start() {
  need_pm2; resolve_target "${1:-}"; preflight
  head_ "pm2 기동 ($TARGET)"
  # pm2 start <ecosystem> 은 이미 떠 있는 앱을 재시작하므로, online 이 아닌 것만 넘긴다
  local a todo=()
  for a in "${TARGET_APPS[@]}"; do
    if [[ "$(app_state "$a")" == online ]]; then echo "  $a: 이미 online"; else todo+=("$a"); fi
  done
  if (( ${#todo[@]} )); then
    echo "  기동: ${todo[*]}"
    pm2 start "$ECOSYSTEM" --only "$(join_comma "${todo[@]}")" >/dev/null || bad "pm2 start 실패"
  fi
  ensure_gateway
  ready_all
  finish "기동"
}

cmd_stop() {
  need_pm2; resolve_target "${1:-}"
  head_ "pm2 중지 ($TARGET)"
  local a st
  for a in "${TARGET_APPS[@]}"; do
    st="$(app_state "$a")"
    if [[ -z "$st" ]]; then echo "  $a: pm2 에 없음 (건너뜀)"; continue; fi
    pm2 stop "$a" >/dev/null 2>&1 || bad "$a pm2 stop 실패"
    wait_down "$a"
  done
  [[ "$TARGET" != all ]] && echo "  입구(gateway)는 그대로입니다 — 꺼진 서비스로 가는 요청은 입구가 502 로 답합니다"
  echo "  개발 DB 는 그대로입니다 — 끄려면 bash ops/devdb.sh stop"
  echo "  pm2 save 하지 않았습니다 — 재부팅하면 pm2 resurrect 로 전체가 다시 뜹니다"
  echo
  if (( FAILS == 0 )); then echo "${G}${B}중지 완료 ($TARGET)${N}"; else echo "${R}${B}중지 중 실패 ${FAILS}건 ($TARGET)${N}"; fi
}

cmd_restart() {
  need_pm2; resolve_target "${1:-}"; preflight
  head_ "pm2 재시작 ($TARGET)"
  # startOrRestart: 등록된 것은 ecosystem 설정 그대로 재시작, 없는 것은 기동
  echo "  재시작: ${TARGET_APPS[*]}"
  pm2 startOrRestart "$ECOSYSTEM" --only "$(join_comma "${TARGET_APPS[@]}")" >/dev/null || bad "pm2 startOrRestart 실패"
  ensure_gateway
  ready_all
  finish "재시작"
}

cmd_status() {
  need_pm2
  head_ "pm2 프로세스"
  local states; states="$(pm2_states)"
  for a in "${APPS[@]}"; do
    local line; line="$(grep -E "^$a " <<<"$states" || true)"
    if [[ -z "$line" ]]; then bad "$a: pm2 에 없음"; continue; fi
    read -r _ st rs pid <<<"$line"
    if [[ "$st" == "online" ]]; then ok "$a: online (pid $pid, 재시작 ${rs}회)"; else bad "$a: $st"; fi
  done

  head_ "포트"
  local p
  for p in "gateway:$GATEWAY_PORT" "web:$WEB_PORT" "admin:$ADMIN_PORT" "model-api:$MODEL_API_PORT" "demo:$DEMO_PORT"; do
    if port_open "${p#*:}"; then ok "${p%%:*} ${p#*:}"; else bad "${p%%:*} ${p#*:} 닫힘"; fi
  done
  if [[ "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "localhost" ]]; then
    if port_open "$DB_PORT"; then ok "DB $DB_PORT"; else bad "DB $DB_PORT 닫힘"; fi
  else
    if nc -z -w 3 "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; then ok "DB $DB_HOST:$DB_PORT"; else bad "DB $DB_HOST:$DB_PORT 닿지 않음"; fi
  fi
}

# http_check 이름 주소 기대코드
http_check() {
  local name="$1" url="$2" want="$3" out code t
  out="$(curl -s -o /dev/null -w '%{http_code} %{time_total}' -m 10 "$url" 2>/dev/null)"
  code="${out%% *}"; t="${out##* }"
  if [[ "$code" == "$want" ]]; then ok "$name $code (${t}s)  $url"; else bad "$name ${code:-000} (기대 $want)  $url"; fi
}

cmd_check() {
  cmd_status

  head_ "헬스체크 (내부)"
  http_check "웹"       "http://127.0.0.1:$WEB_PORT/api/health"       200
  http_check "관리자"   "http://127.0.0.1:$ADMIN_PORT/"               302
  http_check "모델 API" "http://127.0.0.1:$MODEL_API_PORT/v1/health"  200
  http_check "예시"     "http://127.0.0.1:$DEMO_PORT/demo/"           200

  head_ "헬스체크 (입구 경유)"
  http_check "입구→웹"       "http://127.0.0.1:$GATEWAY_PORT/api/health"     200
  http_check "입구→모델 API" "http://127.0.0.1:$GATEWAY_PORT/api/v1/health"  200
  http_check "입구→예시"     "http://127.0.0.1:$GATEWAY_PORT/demo/"          200

  head_ "헬스체크 (공개 주소)"
  http_check "공개→웹"       "$PUBLIC_ORIGIN/api/health"     200
  http_check "공개→모델 API" "$PUBLIC_ORIGIN/api/v1/health"  200

  head_ "빌드 산출물 · 디스크"
  [[ -f backend/dist/server.js ]] && ok "backend/dist/server.js" || bad "backend/dist/server.js 없음"
  ls frontend/dist/index.html >/dev/null 2>&1 && ok "frontend/dist/index.html" || bad "frontend/dist/index.html 없음"
  [[ -x model-api/.venv/bin/python ]] && ok "model-api/.venv" || bad "model-api/.venv 없음"
  local avail; avail="$(df -g "$APP" | awk 'NR==2 {print $4}')"
  if [[ -n "$avail" ]] && (( avail < 5 )); then warn "디스크 여유 ${avail}GB (5GB 미만)"; else ok "디스크 여유 ${avail}GB"; fi

  echo
  if (( FAILS == 0 )); then echo "${G}${B}전체 점검 통과${N}"; else echo "${R}${B}실패 ${FAILS}건${N}"; fi
  (( FAILS == 0 ))
}

cmd_logs() {
  need_pm2
  if [[ -n "${1:-}" ]]; then pm2 logs "$1"; else pm2 logs "/^(web|admin|model-api|gateway|demo)$/"; fi
}

case "${1:-}" in
  start)   cmd_start "${2:-}";   (( FAILS == 0 )) ;;
  stop)    cmd_stop "${2:-}";    (( FAILS == 0 )) ;;
  restart) cmd_restart "${2:-}"; (( FAILS == 0 )) ;;
  status)  cmd_status; (( FAILS == 0 )) ;;
  check)   cmd_check ;;
  logs)    shift; cmd_logs "${1:-}" ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
