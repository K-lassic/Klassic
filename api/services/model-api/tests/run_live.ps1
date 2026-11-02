<# #45 구조에서의 위치: 개발자 → 임시 Compose의 실제 엔진/API 검사 → 결과 로그.
   기존 스크립트의 #24 전용 가드는 이 실행에서만 #45 DB·저장소 가드로 더 좁혀 사용한다.
   운영·기준판 코드는 변경하지 않고 공개 예제 입력만 주입한다. #45 전용 환경을 먼저 준비해야 한다. #>
param(
    [Parameter(Mandatory=$true)][string]$EnvFile,
    [Parameter(Mandatory=$true)][string]$OverrideFile,
    [Parameter(Mandatory=$true)][string]$StaffImage,
    [Parameter(Mandatory=$true)][string]$JeongganboPdf,
    [Parameter(Mandatory=$true)][string]$ReportDirectory,
    [string]$Project = 'klassic-api-issue24'
)
$ErrorActionPreference = 'Stop'
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$composeArgs = @('--env-file', (Resolve-Path $EnvFile).Path, '-p', $Project, '-f', 'compose.yaml', '-f', (Resolve-Path $OverrideFile).Path)
$staff = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $StaffImage).Path))
$jg = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $JeongganboPdf).Path))
New-Item -ItemType Directory -Force -Path $ReportDirectory | Out-Null
Push-Location $apiRoot
try {
    $container = docker compose @composeArgs ps -q model-api
    if ($LASTEXITCODE -ne 0 -or -not $container) { throw '시험 model-api 컨테이너가 없습니다' }
    $ready = $false
    for ($attempt=0; $attempt -lt 150; $attempt++) {
        if ((docker inspect $container --format '{{.State.Health.Status}}') -eq 'healthy') { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw '시험 컨테이너 준비 시간 초과' }
    foreach ($name in @('container_smoke.py','container_recognition_smoke.py','container_jeongganbo_smoke.py',
                         'container_render_smoke.py','container_prepare_failure_smoke.py')) {
        Write-Output "실제 시험 시작: $name"
        $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name))
        if ($name -ne 'container_prepare_failure_smoke.py') {
            $oldGuard = 'if cfg.db_name != "klassic_issue24":'
            if (-not $source.Contains($oldGuard)) { throw "임시 DB 가드를 확인할 수 없습니다: $name" }
            $source = $source.Replace($oldGuard, 'if cfg.db_name != "klassic_issue45" or str(cfg.storage_dir) != "/storage/issue45":')
        }
        $source = $source.Replace('__SAMPLE_BASE64__', $staff).Replace('__STAFF_BASE64__', $staff).Replace('__JEONGGANBO_PDF_BASE64__', $jg)
        $output = @($source | docker compose @composeArgs exec -T model-api python - 2>&1)
        $exitCode = $LASTEXITCODE
        [IO.File]::WriteAllLines((Join-Path $ReportDirectory ($name+'.log')), [string[]]$output, [Text.UTF8Encoding]::new($false))
        if ($exitCode -ne 0) { $output | Write-Output; throw "실제 시험 실패: $name" }
        Write-Output "실제 시험 통과: $name"
    }
} finally { Pop-Location }
