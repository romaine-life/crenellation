# Remote state in Azure Storage (backend config passed by CI). Authentication
# uses Forgejo OIDC through this repo's app service principal. The Infrastructure
# workflow downloads provider versions and the lockfile from infra-bootstrap's
# tofu/provider directory, so they are intentionally not declared here.

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
