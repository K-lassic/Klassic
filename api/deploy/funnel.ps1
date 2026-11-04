# =============================================================================
# #9 Tailscale Funnel 외부 공개 켜기 · 끄기 · 상태 (서버 PC = Windows)
#
#   인터넷 ──HTTPS──▶ <기기>.<tailnet>.ts.net ──▶ 이 PC 127.0.0.1:<Port> (gateway)
#
#   - 공개하는 것은 gateway 포트 하나뿐이다. 관리자(26101) · DB · model-api 는 공개하지 않는다.
#   - 예비 시연(proto_type v0.1.1)은 9503, 재구성(api/)은 다른 포트를 쓰고
#     발표 전에 -Port 만 바꿔 전환한다.
#   - Tailscale 은 Windows 앱(서비스)을 쓴다. 로그인은 앱에서 사람이 한다 —
#     인증 키를 이 스크립트 · 저장소 · 로그에 넣지 않는다.
#
# 사용:
#   pwsh api/deploy/funnel.ps1 status
#   pwsh api/deploy/funnel.ps1 start            # 기본 9603 (api/ 입구 · #139)
#   pwsh api/deploy/funnel.ps1 start -Port 9503 # 예비 시연 (proto_type 이 있을 때만 · #139)
#   pwsh api/deploy/funnel.ps1 start -Port 9603 # 재구성 gateway 로 전환
#   pwsh api/deploy/funnel.ps1 stop
# =============================================================================
param(
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action = 'status',
    [int]$Port = 9603
)

$ErrorActionPreference = 'Stop'

# 관리자 · 내부 포트는 실수로도 공개하지 않는다 (#9 완료 기준: 관리자 외부 접속 불가)
#   26101 proto_type 관리자 · 26201 api/ 관리자 · 9523 web · 9543 model-api · 3306 DB
$BlockedPorts = @(26101, 26201, 9523, 9543, 3306)

# Tailscale CLI 위치 — 기본 설치 경로, 없으면 PATH 에서 찾는다
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $Tailscale)) {
    $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'Tailscale 이 설치되어 있지 않습니다. winget install --id Tailscale.Tailscale -e' }
    $Tailscale = $cmd.Source
}

# 로그인 · 연결 상태 확인 — Running 이 아니면 Funnel 을 켤 수 없다
function Assert-Running {
    $state = (& $Tailscale status --json | ConvertFrom-Json).BackendState
    if ($state -ne 'Running') {
        throw "Tailscale 상태가 '$state' 입니다. 작업 표시줄의 Tailscale 앱에서 로그인하세요."
    }
}

# 공개 주소 (https://<기기>.<tailnet>.ts.net) — MagicDNS 이름에서 끝의 점을 뗀다
function Get-PublicUrl {
    $dns = (& $Tailscale status --json | ConvertFrom-Json).Self.DNSName
    if (-not $dns) { return $null }
    return 'https://' + $dns.TrimEnd('.')
}

switch ($Action) {
    'start' {
        if ($BlockedPorts -contains $Port) { throw "포트 $Port 는 내부 · 관리자 포트라 공개하지 않습니다." }
        Assert-Running

        # gateway 가 떠 있는지 먼저 본다 — 꺼진 포트를 공개하면 외부에서 502 만 보인다
        try {
            Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
        } catch {
            throw "127.0.0.1:$Port 에서 gateway 가 응답하지 않습니다. 먼저 docker compose up -d 하세요."
        }

        # --bg: 이 창을 닫아도 계속 공개 (Tailscale 서비스가 설정을 기억한다)
        & $Tailscale funnel --bg $Port
        Write-Host "공개 주소: $(Get-PublicUrl)  →  127.0.0.1:$Port"
    }
    'stop' {
        # serve · funnel 설정을 모두 지운다 (Tailscale 연결 자체는 유지)
        & $Tailscale funnel reset
        Write-Host '외부 공개를 껐습니다.'
    }
    'status' {
        Assert-Running
        Write-Host "공개 주소: $(Get-PublicUrl)"
        & $Tailscale funnel status
    }
}
