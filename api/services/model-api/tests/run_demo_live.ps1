<# #93 구조에서의 위치: 개발자 → 격리 Compose·시드 CLI·데모 HTTP → 실제 MP3 검증·정리.
   DB는 Python 시험이 klassic_issue93으로 제한한다. 운영 프로젝트에서는 실행하지 않는다. #>
param(
    [Parameter(Mandatory=$true)][string]$EnvFile,
    [Parameter(Mandatory=$true)][string]$OverrideFile,
    [Parameter(Mandatory=$true)][string]$RestoreEnvFile,
    [Parameter(Mandatory=$true)][string]$RestoreOverrideFile,
    [Parameter(Mandatory=$true)][string]$ReportDirectory,
    [string]$Project = 'klassic-api-issue24'
)
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '-issue\d+') { throw '이슈 시험용 Compose 프로젝트만 지정하십시오' }
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$args93 = @('--env-file',(Resolve-Path $EnvFile).Path,'-p',$Project,'-f','compose.yaml','-f',(Resolve-Path $OverrideFile).Path)
$restore = @('--env-file',(Resolve-Path $RestoreEnvFile).Path,'-p',$Project,'-f','compose.yaml','-f',(Resolve-Path $RestoreOverrideFile).Path)
New-Item -ItemType Directory -Force -Path $ReportDirectory | Out-Null
$ReportDirectory = (Resolve-Path -LiteralPath $ReportDirectory).Path
$keyFile = Join-Path (Resolve-Path $ReportDirectory).Path 'demo-key.env'
if (Test-Path -LiteralPath $keyFile) { throw '이전 시험 키 파일을 먼저 확인하십시오' }
$testSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'container_shared_demo_smoke.py'))
$initSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../app/tools/init_shared_storage.py'))
$prepared = $false
$demoStarted = $false
Push-Location $apiRoot
try {
    $resolved = docker compose @args93 --profile tools config --format json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $resolved.services.'model-api'.environment.DB_NAME -ne 'klassic_issue93' -or
        $resolved.services.'model-api'.environment.STORAGE_DIR -ne '/storage/issue93' -or
        $resolved.volumes.'issue93-shared'.name -ne 'klassic_issue93_shared_test' -or
        @($resolved.services.'model-api'.volumes | Where-Object { $_.target -eq '/shared-scores' -and $_.source -eq 'issue93-shared' -and $_.volume.subpath -eq 'shared' -and $_.read_only }).Count -ne 1 -or
        @($resolved.services.'shared-seed'.volumes | Where-Object { $_.target -eq '/shared-scores' -and $_.source -eq 'issue93-shared' -and $_.volume.subpath -eq 'shared' }).Count -ne 1 -or
        @($resolved.services.'shared-storage-init'.volumes | Where-Object { $_.target -eq '/storage' -and $_.source -eq 'issue93-shared' }).Count -ne 1) {
        throw '격리 DB·저장소·공유 시험 볼륨 구성이 아닙니다'
    }
    docker compose @args93 run --rm --no-deps shared-storage-init
    if ($LASTEXITCODE -ne 0) { throw '공유 폴더 준비 실패' }
    docker compose @args93 up -d --no-deps model-api
    if ($LASTEXITCODE -ne 0) { throw '시험 model-api 기동 실패' }
    $container = docker compose @args93 ps -q model-api
    $ready = $false
    for ($i=0; $i -lt 100; $i++) {
        if ((docker inspect $container --format '{{.State.Health.Status}}') -eq 'healthy') { $ready=$true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw '시험 model-api 준비 시간 초과' }
    $testSource | docker compose @args93 exec -T model-api python - preflight
    if ($LASTEXITCODE -ne 0) { throw '격리 시험 사전 확인 실패' }
    foreach ($attempt in 1..2) {
        docker compose @args93 run --rm --no-deps shared-seed --confirm-rights
        if ($LASTEXITCODE -ne 0) { throw '예시 등록·반복 실행 실패' }
    }
    $testSource | docker compose @args93 exec -T model-api python - prepare
    if ($LASTEXITCODE -ne 0) { throw '시험 준비 실패' }
    $prepared = $true
    docker cp "${container}:/storage/issue93/tmp/demo-key.env" $keyFile
    if ($LASTEXITCODE -ne 0) { throw '시험 키 전달 실패' }
    $existing = @(docker ps -aq --filter 'name=^/issue93-demo$')
    if ($existing.Count) { throw 'issue93-demo 컨테이너가 이미 있습니다' }
    docker run -d --name issue93-demo --network "${Project}_default" --read-only --cap-drop ALL --security-opt no-new-privileges --env-file $keyFile klassic/api-demo:issue93-review
    if ($LASTEXITCODE -ne 0) { throw '시험 데모 기동 실패' }
    $demoStarted = $true
    Start-Sleep -Seconds 2
    $output = @($testSource | docker compose @args93 exec -T model-api python - verify 2>&1)
    $code = $LASTEXITCODE
    [IO.File]::WriteAllLines((Join-Path $ReportDirectory 'live-results.log'), [string[]]$output, [Text.UTF8Encoding]::new($false))
    $output | Write-Output
    if ($code -ne 0) { throw '실제 데모 검증 실패' }
    docker stats --no-stream --format '{{.Name}} | {{.MemUsage}} | {{.CPUPerc}}' issue93-demo
} finally {
    if ($demoStarted) { docker rm -f issue93-demo | Out-Null }
    if ($prepared) {
        $testSource | docker compose @args93 run --rm -T --no-deps --entrypoint python shared-seed - cleanup
        if ($LASTEXITCODE -ne 0) { Write-Warning '시험 데이터 정리 실패 — 격리 DB와 시험 파일 확인 필요' }
    }
    Remove-Item -LiteralPath $keyFile -ErrorAction SilentlyContinue
    # 이전 이미지에는 새 준비 모듈이 없을 수 있어, 복원할 볼륨에는 현재 소스를 stdin으로 실행한다.
    $initSource | docker compose @restore run --rm -T --no-deps --entrypoint python shared-storage-init -
    if ($LASTEXITCODE -ne 0) { Write-Warning '복원 환경 공유 폴더 준비 실패' }
    docker compose @restore up -d --no-deps model-api
    Pop-Location
}
