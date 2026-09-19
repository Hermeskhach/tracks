param([int]$Port = 5080, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path node_modules)) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'Worker dependency installation failed.' } }
if (!(Test-Path web/node_modules)) { npm ci --prefix web; if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' } }
node scripts/setup-auth-secret.mjs
if ($LASTEXITCODE -ne 0) { throw 'Local authentication setup failed.' }
if (!$SkipBuild) { npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed.' } }
npm run db:local
if ($LASTEXITCODE -ne 0) { throw 'D1 migrations failed.' }
npx wrangler dev --ip 127.0.0.1 --port $Port
