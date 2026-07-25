# Remote state in Azure Storage (backend config passed by CI). Authentication
# uses GitHub OIDC through this repo's app service principal. Provider versions
# and the lockfile are injected by the shared pipeline template
# (tofu-plan-apply-template.yml downloads tofu/provider/shared-providers.tf from
# infra-bootstrap), so they are intentionally not declared here.

terraform {
  backend "azurerm" {
    use_oidc         = true
    use_azuread_auth = true
  }
}

provider "azurerm" {
  features {}
  use_oidc = true
}
