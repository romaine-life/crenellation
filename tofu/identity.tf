# ============================================================================
# Workload identity for the chess-tactics app pod's Postgres access
# ============================================================================
# The app authenticates to Azure Database for PostgreSQL passwordless: the pod
# projects its ServiceAccount token, exchanges it (via this federated credential)
# for an Entra ID token, and presents that token as the Postgres password. The
# same UAMI is made the server's Entra administrator in postgres.tf, so the
# schema migrations the app runs at startup execute under this identity.
#
# Mirrors the glimmung/tank-operator pattern, but deliberately grants the UAMI
# NO subscription-level roles — its only privilege is being the Postgres Entra
# admin (a data-plane grant on the server). Least privilege for an app that only
# needs to talk to its own database.

resource "azurerm_user_assigned_identity" "app" {
  name                = "chess-tactics-identity"
  resource_group_name = azurerm_resource_group.chess_tactics.name
  location            = azurerm_resource_group.chess_tactics.location
}

# Federated credential: trust SA tokens the AKS OIDC issuer signs for the
# chess-tactics app ServiceAccount. The azure-workload-identity webhook projects
# the token into the pod; DefaultAzureCredential exchanges it for this UAMI's
# Entra token at connect time (see backend/db).
resource "azurerm_federated_identity_credential" "app" {
  name                = "aks-chess-tactics"
  resource_group_name = azurerm_resource_group.chess_tactics.name
  parent_id           = azurerm_user_assigned_identity.app.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = local.aks_oidc_issuer_url
  subject             = "system:serviceaccount:chess-tactics:chess-tactics"
}
