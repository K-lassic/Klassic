# #24: #26 실제 CLI로 발급·재발급한 키의 HTTP 인증 검사. 키 원문은 메모리와 stdin으로만 전달한다.
param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [string]$ProjectName = 'klassic-api-issue24'
)
$ErrorActionPreference = 'Stop'
if ($ProjectName -ne 'klassic-api-issue24') { throw '분리된 #24 시험 프로젝트에서만 실행하십시오' }
$composePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../compose.yaml'))
$composeArgs = @('compose', '--env-file', [IO.Path]::GetFullPath($EnvFile), '-f', $composePath, '-p', $ProjectName)
$checkCode = @'
import asyncio, json, sys, urllib.request, urllib.error
from app.config import load_config
from app.db import Database
p = json.load(sys.stdin)
async def main():
    cfg = load_config()
    if cfg.db_name != 'klassic_issue24':
        raise RuntimeError('별도 시험 DB에서만 실행하십시오')
    db = await Database.connect(cfg)
    try:
        if p['mode'] == 'preflight':
            row = await db.fetch_one("SELECT COUNT(*) AS n FROM access_key WHERE key_kind='service' AND status='active'")
            if row['n'] != 0:
                raise RuntimeError('기존 활성 서비스 키를 폐기할 수 있어 검사를 중단합니다')
            print('preflight: isolated DB, no active service keys')
        elif p['mode'] == 'call':
            req = urllib.request.Request('http://127.0.0.1:9543/v1/internal/settings/reload',
                                         method='POST', headers={'X-API-Key': p['key']})
            try:
                response = urllib.request.urlopen(req, timeout=10)
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                data = json.load(response)
                if response.status != p['expected']:
                    raise RuntimeError(f"HTTP {response.status}, expected {p['expected']}")
                if p.get('code') and data.get('error', {}).get('code') != p['code']:
                    raise RuntimeError('오류 코드 불일치')
                assert response.headers.get('X-Request-ID')
                print(p['label'] + ': HTTP ' + str(response.status))
        elif p['mode'] == 'cleanup':
            op = await db.fetch_one('SELECT operator_id,account_id FROM operator_account WHERE login_id=%s', (p['login'],))
            if op:
                args = (op['operator_id'],)
                await db.execute('DELETE FROM api_call_log WHERE access_key_id IN (SELECT key_id FROM access_key WHERE issued_by=%s)', args)
                await db.execute('DELETE FROM access_key WHERE issued_by=%s', args)
                await db.execute('DELETE FROM change_history WHERE operator_id=%s', args)
                await db.execute('DELETE FROM operator_account WHERE operator_id=%s', args)
                if op['account_id']:
                    await db.execute('DELETE FROM account_role WHERE account_id=%s', (op['account_id'],))
                    await db.execute('DELETE FROM account WHERE account_id=%s', (op['account_id'],))
            print('cleanup: test operator and issued keys removed')
    finally:
        await db.close()
asyncio.run(main())
'@
function Invoke-Check([hashtable]$Payload) {
    $Payload | ConvertTo-Json -Compress | & docker @composeArgs exec -T model-api python -c $checkCode
    if ($LASTEXITCODE -ne 0) { throw '실제 DB·HTTP 검사 실패' }
}
function New-TestServiceKey([string]$LoginName) {
    $output = @(& docker @composeArgs run --rm --no-deps -T web node dist/tools/issueServiceKey.js --operator $LoginName)
    if ($LASTEXITCODE -ne 0) { throw '서비스 키 발급 도구 실패' }
    $keyLines = @($output | Where-Object { $_ -cmatch '^gk_[A-Za-z0-9]{43}$' })
    if ($keyLines.Count -ne 1) { throw '도구의 키 출력 형식을 확인하십시오 (원문 출력 생략)' }
    return $keyLines[0]
}

Invoke-Check @{ mode = 'preflight' }
$loginName = 'issue24_' + [guid]::NewGuid().ToString('N').Substring(0, 16)
$previousAdminPassword = $env:ADMIN_PASSWORD
$env:ADMIN_PASSWORD = [guid]::NewGuid().ToString('N')
try {
    & docker @composeArgs run --rm --no-deps -T -e ADMIN_PASSWORD web node dist/tools/createOperator.js --login $loginName --name '기반 연동 시험'
    if ($LASTEXITCODE -ne 0) { throw '운영자 생성 도구 실패' }
    $firstKey = New-TestServiceKey $loginName
    Invoke-Check @{ mode = 'call'; key = $firstKey; expected = 200; label = 'first issued key' }
    $secondKey = New-TestServiceKey $loginName
    Invoke-Check @{ mode = 'call'; key = $secondKey; expected = 200; label = 'reissued key' }
    # 2026-11-02 승인된 기준: 폐기된 이전 키는 기존 계약의 AUTH_KEY_REVOKED=403 유지.
    Invoke-Check @{ mode = 'call'; key = $firstKey; expected = 403; code = 'AUTH_KEY_REVOKED'; label = 'revoked previous key (current contract)' }
}
finally {
    $firstKey = $null
    $secondKey = $null
    $env:ADMIN_PASSWORD = $previousAdminPassword
    Invoke-Check @{ mode = 'cleanup'; login = $loginName }
}
