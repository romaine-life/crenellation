# Live-db dev backend: fetch the break-glass pgadmin password from the
# ng6-crenellation Key Vault (using your az login), build DATABASE_URL in
# memory (never written to disk), and run the supervisor against the PROD
# crenellation-pg database. Launch through devctl:
#   devctl up crenellation-backend
# Requires: az logged in, and your IP in the server firewall (tofu/postgres.tf
# allow-nelson-workstation).
$ErrorActionPreference = 'Stop'

$pw = az keyvault secret show --vault-name ng6-crenellation --name crenellation-pg-admin-password --query value -o tsv
if (-not $pw) { throw 'Could not read crenellation-pg-admin-password from ng6-crenellation. Is az logged in?' }

# The generated password can contain URL-reserved characters — encode it.
$enc = [uri]::EscapeDataString($pw)
$env:DATABASE_URL = "postgres://pgadmin:$enc@crenellation-pg.postgres.database.azure.com:5432/crenellation?sslmode=require"

node supervisor.js
