$workspace = Split-Path $PSScriptRoot -Parent
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D (Join-Path $workspace '.local/postgres') -m fast -w stop
