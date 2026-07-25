# Shared infrastructure provisioned by infra-bootstrap. chess-tactics only needs
# the shared resource group's location to place its own media resources; the rest
# of the app's Azure surface is owned here.

data "azurerm_client_config" "current" {}

data "azuread_client_config" "current" {}

data "azurerm_resource_group" "infra" {
  name = "infra"
}

# infra-bootstrap publishes the AKS OIDC issuer URL; the federated credential in
# identity.tf trusts tokens this issuer signs. Read-only — chess-tactics writes
# nothing to shared infra state.
data "terraform_remote_state" "infra_bootstrap" {
  backend = "azurerm"

  config = {
    resource_group_name  = "infra"
    storage_account_name = "nelsontofu"
    container_name       = "tfstate"
    key                  = "infra-bootstrap.tfstate"
    use_oidc             = true
  }
}

locals {
  aks_oidc_issuer_url = data.terraform_remote_state.infra_bootstrap.outputs.aks_oidc_issuer_url
}
