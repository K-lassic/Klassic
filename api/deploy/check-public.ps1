#Requires -Version 7
# =============================================================================
# #48 공개 점검 — 공개 주소에서 열려야 할 것은 열리고, 막혀야 할 것은 막혔는지 한 번에 본다.
#
#   구조에서의 위치: 인터넷 ──▶ Funnel ──▶ Nginx(9603) ──▶ web · model-api. 이 스크립트는 맨 앞에서 요청을 보낸다.
#   계정을 만들지 않고 비밀값을 쓰지 않는다. 응답 상태와 쿠키 속성 이름만 본다 (쿠키 값은 출력하지 않는다).
#
# 사용:
#   pwsh api/deploy/check-public.ps1                                      # 기본: Funnel 공개 주소
#   pwsh api/deploy/check-public.ps1 -Url http://127.0.0.1:9603 -Local    # Funnel 없이 로컬 입구 확인
#   PowerShell 7(pwsh)이 필요하다. Windows PowerShell 5.1(powershell)에서는 돌지 않는다.
#
#   -Local 은 쿠키 Secure 를 보지 않는다 — HTTP 에서는 붙지 않는 것이 맞다 (#37).
#   model-api 가 없으면 /api/v1/health 는 502 로 표시된다. 그때는 model-api 줄만 실패한다.
#   #86 인식 · 렌더링 경로 줄이 실패하면 업로드가 오류 없이 모두 대체 악보로 끝난다 — 대역이 빠진 상태다.
#   실패가 하나라도 있으면 종료 코드 1.
# =============================================================================
param(
    [string]$Url = 'https://klassic.tailafa5c2.ts.net',
    [switch]$Local
)

$ErrorActionPreference = 'Stop'
$script:Failed = 0

function Get-Status([string]$Path) {
    try {
        return Invoke-WebRequest "$Url$Path" -UseBasicParsing -TimeoutSec 20 -SkipHttpErrorCheck -MaximumRedirection 0
    } catch {
        return $null
    }
}

function Test-Path-Status([string]$Label, [string]$Path, [int[]]$Want) {
    $res = Get-Status $Path
    $got = if ($res) { [int]$res.StatusCode } else { 0 }
    $ok = $Want -contains $got
    if (-not $ok) { $script:Failed++ }
    $mark = if ($ok) { 'OK  ' } else { '실패' }
    Write-Host "[$mark] $Label  $Path → $got (기대 $($Want -join '/'))"
}

Write-Host "점검 주소: $Url"

# 열려야 하는 것
Test-Path-Status '화면' '/' @(200)
Test-Path-Status '백엔드 상태' '/api/health' @(200)
Test-Path-Status 'model-api 상태' '/api/v1/health' @(200)
Test-Path-Status '국악기 음원' '/soundfonts/gugak.sf2' @(200)

# #86 인식 · 렌더링 경로 — 재구성판은 /api/v1/health 200 · 엔진 ready 여도 이 경로가 없어(#29~#31) 악보가 대체로 끝난다.
#   판본 이름 대신 backend 가 부르는 경로가 있는지를 본다. 재구성판이 완성되면 고칠 것 없이 통과한다.
$apiPaths = @()
$res = Get-Status '/api/v1/openapi.json'
if ($res -and [int]$res.StatusCode -eq 200) {
    try { $apiPaths = @(($res.Content | ConvertFrom-Json).paths.PSObject.Properties.Name) } catch { $apiPaths = @() }
}
foreach ($path in @('/v1/omr/staff', '/v1/omr/jeongganbo', '/v1/render/mp3', '/v1/render/pdf')) {
    $ok = $apiPaths -contains $path
    if (-not $ok) { $script:Failed++ }
    $mark = if ($ok) { 'OK  ' } else { '실패' }
    Write-Host "[$mark] 인식 · 렌더링 경로  $path"
}

# 로그인해야 하는 것 — 방문자는 401
Test-Path-Status '악기 목록(방문자)' '/api/instruments' @(401)

# 막혀야 하는 것
Test-Path-Status '내부 API' '/api/v1/internal/upload-check' @(404)
Test-Path-Status '관리자 API' '/admin/login' @(404)
Test-Path-Status '관리자 화면' '/admin.html' @(404)

# 예시 원본은 공개 경로가 없다 — 없는 주소는 화면 HTML 로 답하므로(화면 라우터) 상태가 아니라 내용을 본다
$res = Get-Status '/examples/examples.json'
$leaked = $res -and "$($res.Headers['Content-Type'])" -notmatch 'text/html' -and [int]$res.StatusCode -eq 200
if ($leaked) { $script:Failed++ }
$mark = if ($leaked) { '실패' } else { 'OK  ' }
Write-Host "[$mark] 예시 원본이 나오지 않음  /examples/examples.json"

# 세션 쿠키 — HTTPS 프록시 뒤에서는 Secure · HttpOnly · SameSite 가 붙어야 한다 (#37)
$res = Get-Status '/api/auth/me'
$cookie = if ($res) { @($res.Headers['Set-Cookie']) -join ';' } else { '' }
$flags = @('HttpOnly', 'SameSite=Lax') + $(if ($Local) { @() } else { @('Secure') })
foreach ($flag in $flags) {
    $ok = $cookie -match [regex]::Escape($flag)
    if (-not $ok) { $script:Failed++ }
    $mark = if ($ok) { 'OK  ' } else { '실패' }
    Write-Host "[$mark] 세션 쿠키 속성 $flag"
}

if ($script:Failed -gt 0) {
    Write-Host "실패 $($script:Failed) 건"
    exit 1
}
Write-Host '모두 통과'
