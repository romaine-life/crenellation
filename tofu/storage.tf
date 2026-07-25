# ============================================================================
# Game media storage (background music)
# ============================================================================
# Large audio assets (the shuffled BGM library) live in public-read blob storage
# and are streamed on demand by the browser, instead of being baked into the app
# image. This keeps the Docker image and ArgoCD deploys lean while the soundtrack
# can grow freely. The backend LISTS the container (each blob carries its
# title/artist/album as blob metadata) and serves the playlist at /api/bgm; the
# browser streams one track at a time via HTTP range requests. The container is
# the single source of truth — add/remove a track here and the game follows it,
# with no manifest to regenerate.
#
# Mirrors the public-blob pattern in infra-bootstrap/tofu/agent-screenshots.tf,
# minus that account's 90-day delete-retention — BGM is permanent content, not
# ephemeral PR evidence.

# Dedicated resource group for chess-tactics' own Azure resources (app-owned
# infra, narrow blast radius), placed alongside the shared infra RG.
resource "azurerm_resource_group" "chess_tactics" {
  name     = "chess-tactics"
  location = data.azurerm_resource_group.infra.location
}

resource "azurerm_storage_account" "media" {
  name                     = var.media_storage_account_name
  resource_group_name      = azurerm_resource_group.chess_tactics.name
  location                 = azurerm_resource_group.chess_tactics.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  # Required for `container_access_type = "blob"` (anonymous read) below.
  allow_nested_items_to_be_public = true

  # No CORS rule: the browser streams audio via <audio> (a no-cors media
  # request) and the backend reads index.json server-side. Nothing fetches the
  # blob cross-origin from JS, so a CORS rule would be dead config.

  tags = {
    app       = "chess-tactics"
    managedBy = "chess-tactics"
    purpose   = "game-media"
  }
}

# Background-music container. Anonymous blob READ so the browser streams tracks
# directly from their public URLs — but NOT public-list. Enumerating the playlist
# is the backend's job, authenticated via workload identity (role below); a
# scraper can't list the library.
resource "azurerm_storage_container" "bgm" {
  name                  = "bgm"
  storage_account_id    = azurerm_storage_account.media.id
  container_access_type = "blob"
}

# chess-tactics' CI service principal (created by module.app_org["chess-tactics"]
# in infra-bootstrap). Data-plane write lets the `sync-bgm-metadata` workflow
# stamp each track's title/artist/album onto its blob as metadata (read from the
# mp3's own ID3 tag). Tracks are added/removed in the container directly (portal /
# Storage Explorer) — CI never uploads audio.
data "azuread_service_principal" "ci" {
  display_name = "chess-tactics"
}

resource "azurerm_role_assignment" "bgm_metadata_writer" {
  scope                = azurerm_storage_account.media.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azuread_service_principal.ci.object_id
}

# Renamed from bgm_uploader (the old upload pipeline is gone); same scope/role/
# principal, so this is a no-op rename rather than a destroy+create.
moved {
  from = azurerm_role_assignment.bgm_uploader
  to   = azurerm_role_assignment.bgm_metadata_writer
}

# The app pod's workload identity (chess-tactics-identity, identity.tf) builds
# /api/bgm by LISTING the container and reading each blob's metadata. Reader
# includes list; the app never writes. This is the UAMI's only Azure data-plane
# grant besides being the Postgres Entra admin.
resource "azurerm_role_assignment" "bgm_reader" {
  scope                = azurerm_storage_account.media.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

output "media_storage_account" {
  value       = azurerm_storage_account.media.name
  description = "Storage account holding chess-tactics game media."
}

output "bgm_container" {
  value       = azurerm_storage_container.bgm.name
  description = "Blob container holding the shuffled BGM tracks."
}

# This is the BGM_BASE_URL the backend uses (set in k8s/values.yaml): the
# backend reads <url>/index.json and serves tracks under <url>/<file>.
output "bgm_container_url" {
  value       = "https://${azurerm_storage_account.media.name}.blob.core.windows.net/${azurerm_storage_container.bgm.name}"
  description = "Public base URL for BGM index.json + tracks (the backend's BGM_BASE_URL)."
}
