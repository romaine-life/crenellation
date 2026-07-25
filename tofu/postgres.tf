# ============================================================================
# Azure Database for PostgreSQL — Flexible Server (chess-tactics durable store)
# ============================================================================
# chess-tactics' durable game/design document store: levels, campaigns, campaign
# workspaces, and design portfolios. Art assets are code-owned files, not
# database rows. This replaces the pod-ephemeral JSON files under /var/run,
# which had no PVC and were wiped on every restart/rollout.
#
# Mirrors the glimmung/tank-operator shape: B1ms burstable, single AZ, public
# endpoint gated by Entra (AAD) auth at the data plane plus an Azure-internal
# firewall rule. The app pod authenticates passwordless via workload identity
# (see identity.tf); the admin password below is human break-glass only and the
# pod never reads it.

# Break-glass admin password. Stored in the ng6-chess-tactics Key Vault for human
# ops only:
#   psql "host=<fqdn> user=pgadmin dbname=chess_tactics sslmode=require"
# with PGPASSWORD pulled from the vault. The app never uses it (workload-identity
# AAD is the app path).
resource "random_password" "pg_admin" {
  length      = 32
  special     = true
  min_lower   = 1
  min_upper   = 1
  min_numeric = 1
  min_special = 1
  # The Postgres admin login forbids these characters in passwords.
  override_special = "!#$%&*+-_=?"
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                = "chess-tactics-pg"
  resource_group_name = azurerm_resource_group.chess_tactics.name

  # westus2 currently restricts Flexible Server capacity
  # (LocationIsOfferRestricted) — the same constraint glimmung/tank-operator
  # hit. westus3 is adjacent; AKS(westus2) -> DB(westus3) latency is comparable
  # to intra-region at this write volume, and egress is sub-dollar. Move to
  # data.azurerm_resource_group.infra.location if the quota request lands
  # (https://aka.ms/postgres-request-quota-increase).
  location = "westus3"

  version    = "16"
  sku_name   = "B_Standard_B1ms"
  storage_mb = 32768
  zone       = "1"

  # Public endpoint, gated by AAD auth at the data plane plus the Azure-internal
  # firewall rule below. VNet integration is a later tightening if private-only
  # access becomes a requirement; for now this matches the established Postgres
  # shape in this cluster.
  public_network_access_enabled = true

  authentication {
    active_directory_auth_enabled = true
    # Password auth stays on for human break-glass only; the app is passwordless.
    password_auth_enabled = true
    tenant_id             = data.azurerm_client_config.current.tenant_id
  }

  administrator_login    = "pgadmin"
  administrator_password = random_password.pg_admin.result

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  lifecycle {
    ignore_changes = [
      # The AZ can be reassigned during planned maintenance; don't fight it.
      zone,
    ]
  }
}

# Entra (AAD) administrator = the chess-tactics app UAMI. Granting the existing
# workload identity server-admin keeps the wiring simple: the same identity the
# pod federates as becomes the DB admin, so the startup schema migrations run
# under it. Narrower per-app roles, if ever wanted, get created via SQL by this
# admin.
resource "azurerm_postgresql_flexible_server_active_directory_administrator" "app" {
  server_name         = azurerm_postgresql_flexible_server.main.name
  resource_group_name = azurerm_resource_group.chess_tactics.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = azurerm_user_assigned_identity.app.principal_id
  principal_name      = azurerm_user_assigned_identity.app.name
  principal_type      = "ServicePrincipal"
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "chess_tactics"
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

# Firewall: allow Azure-internal traffic. The 0.0.0.0/0.0.0.0 magic rule
# whitelists traffic from any Azure resource in any subscription, gated by AAD
# auth at the data plane. AKS outbound flows through the standard LB and reaches
# this server as Azure-internal.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure_internal" {
  name             = "allow-azure-internal"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# --- Key Vault publication (break-glass / ops convenience) ------------------
# Non-secret coordinates (host, database) live here too so a human ops session
# has everything for a break-glass psql in one place. The app reads none of it.
resource "azurerm_key_vault_secret" "pg_host" {
  name         = "chess-tactics-pg-host"
  value        = azurerm_postgresql_flexible_server.main.fqdn
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "pg_database" {
  name         = "chess-tactics-pg-database"
  value        = azurerm_postgresql_flexible_server_database.main.name
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "pg_admin_password" {
  name         = "chess-tactics-pg-admin-password"
  value        = random_password.pg_admin.result
  key_vault_id = azurerm_key_vault.main.id
}
