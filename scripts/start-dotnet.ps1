param([int]$Port = 5080, [int]$DatabasePort = 55432, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $workspace
$localPath = Join-Path $workspace '.local'
New-Item -ItemType Directory -Force -Path $localPath | Out-Null
$postgresBin = 'C:\Program Files\PostgreSQL\18\bin'
if (!(Test-Path -LiteralPath (Join-Path $postgresBin 'initdb.exe'))) { throw 'PostgreSQL 18 is required. Update $postgresBin for your installation.' }
$configPath = Join-Path $localPath 'database.json'
if (!(Test-Path -LiteralPath $configPath)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $secret = [BitConverter]::ToString($bytes).Replace('-', '')
    @{ Password = $secret; Port = $DatabasePort } | ConvertTo-Json | Set-Content -LiteralPath $configPath
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$dataPath = Join-Path $localPath 'postgres'
if (!(Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
    $passwordFile = Join-Path $localPath 'init-password'
    [IO.File]::WriteAllText($passwordFile, $config.Password)
    & (Join-Path $postgresBin 'initdb.exe') -D $dataPath -U tracks -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
    Remove-Item -LiteralPath $passwordFile
}
& (Join-Path $postgresBin 'pg_ctl.exe') -D $dataPath status *> $null
if ($LASTEXITCODE -ne 0) {
    & (Join-Path $postgresBin 'pg_ctl.exe') -D $dataPath -l (Join-Path $localPath 'postgres.log') -o "-p $($config.Port) -h 127.0.0.1" -w start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not start.' }
}
$env:PGPASSWORD = $config.Password
$exists = & (Join-Path $postgresBin 'psql.exe') -h 127.0.0.1 -p $config.Port -U tracks -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tracks'"
if ($exists -ne '1') {
    & (Join-Path $postgresBin 'createdb.exe') -h 127.0.0.1 -p $config.Port -U tracks tracks
    if ($LASTEXITCODE -ne 0) { throw 'Could not create database.' }
}
Remove-Item Env:PGPASSWORD
$env:ConnectionStrings__Journal = "Host=127.0.0.1;Port=$($config.Port);Database=tracks;Username=tracks;Password=$($config.Password)"
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:Database__AutoMigrate = 'true'
if (!$SkipBuild) {
    Push-Location web
    try {
        if (!(Test-Path node_modules)) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' } }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
}
New-Item -ItemType Directory -Force -Path server/wwwroot | Out-Null
Copy-Item -Path web/dist/web/browser/* -Destination server/wwwroot -Recurse -Force
dotnet run --project server --no-launch-profile --urls "http://localhost:$Port"
