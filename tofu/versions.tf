terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "4.70.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "3.8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.0"
    }
  }
}
