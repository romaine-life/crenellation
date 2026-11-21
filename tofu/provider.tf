# Remote state in Azure Storage (backend config passed by pipeline-templates' tofu
# suite). Authentication uses Forgejo OIDC through this repo's app service
# principal. The providers and their versions are pinned in versions.tf and
# .terraform.lock.hcl.

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
