# App-owned Key Vault for chess-tactics. Today it holds only the Postgres
# break-glass admin password plus connection coordinates (host/db) for human
# ops; the app pod itself is passwordless (workload-identity AAD) and reads
# nothing here. Mirrors the per-app `ng6-<app>` convention (auth: ng6-auth,
# glimmung: ng6-glimmung). RBAC-authorized; the chess-tactics CI service
# principal already holds Key Vault Administrator at subscription scope, so it
# can write the secrets declared in postgres.tf during apply.
resource "azurerm_key_vault" "main" {
  name                       = var.key_vault_name
  resource_group_name        = azurerm_resource_group.chess_tactics.name
  location                   = azurerm_resource_group.chess_tactics.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7

  tags = {
    app       = "chess-tactics"
    managedBy = "chess-tactics"
    purpose   = "app-secrets"
  }
}
