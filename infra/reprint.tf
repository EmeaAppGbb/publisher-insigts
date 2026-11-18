# The approval-gated reprint request: one MCP server on Azure Container Apps whose only tool records a reprint
# request in the BookSignals KQL database (workspace/BookSignals.KQLDatabase). The with-IQ agent proposes the call;
# Foundry asks the signed-in user to approve it in the app, then calls the server through the reprint-request
# connection with that user's own token (OAuth identity passthrough, as Work IQ does). The server checks the token
# and the user's app role against the decision authority matrix, and checks the arguments against the current
# week's governed option, before it writes. It writes as its own identity, which holds only Database Viewer and
# Ingestor on that one KQL database: deploy.py's reprint phase grants them as the deployer, not Terraform. Nothing
# holds a secret.
locals {
  # Container Apps names stop at 32 characters: ca-<16-character project>-<suffix>-mcp fits, -reprint would not.
  reprint_name         = "ca-${local.resource_prefix}-mcp"
  reprint_image_name   = "reprint-request"
  reprint_mcp_endpoint = "https://${local.reprint_name}.${azurerm_container_app_environment.main.default_domain}/mcp"
  # The KQL database item the server reads and writes, by its display name in DEV; the server resolves the Kusto
  # database name from it.
  reprint_kql_database = "BookSignals"
  reprint_scope        = "ReprintRequest.Submit"
  reprint_api_uri      = "api://${azuread_application.reprint_api.client_id}"
  reprint_oauth_scopes = ["${local.reprint_api_uri}/${local.reprint_scope}", "offline_access"]
  # BKS-GOV-003's production line, lowest to highest. The server maps each value to its approver.
  reprint_roles = {
    production_planning_manager = { value = "Reprint.ProductionPlanningManager", display_name = "Production planning manager" }
    head_of_production_planning = { value = "Reprint.HeadOfProductionPlanning", display_name = "Head of production planning" }
    publishing_director         = { value = "Reprint.PublishingDirector", display_name = "Publishing director" }
    managing_director           = { value = "Reprint.ManagingDirector", display_name = "Managing director" }
  }
}

resource "random_uuid" "reprint_scope" {}

resource "random_uuid" "reprint_role" {
  for_each = local.reprint_roles
}

# The reprint server's API: the delegated scope the connection asks for as each user, and the approval roles the
# server checks. Its tokens are v1, which name the user (name), as the request record must.
resource "azuread_application" "reprint_api" {
  display_name            = "${var.project_name}-reprint-api"
  description             = "The ${var.project_name} reprint request server's API: submitting a reprint request the signed-in user approved, with the user's approval role."
  sign_in_audience        = "AzureADMyOrg"
  owners                  = [data.azurerm_client_config.current.object_id]
  prevent_duplicate_names = true

  api {
    oauth2_permission_scope {
      id                         = random_uuid.reprint_scope.result
      value                      = local.reprint_scope
      type                       = "User"
      enabled                    = true
      admin_consent_display_name = "Submit approved reprint requests"
      admin_consent_description  = "Allow the ${var.project_name} agents to submit a reprint request that the signed-in user approved, as that user."
      user_consent_display_name  = "Submit reprint requests you approve"
      user_consent_description   = "Submit a reprint request to production planning as you, only after you approve it in the app."
    }
  }

  dynamic "app_role" {
    for_each = local.reprint_roles

    content {
      id                   = random_uuid.reprint_role[app_role.key].result
      value                = app_role.value.value
      display_name         = app_role.value.display_name
      description          = "Approves reprint requests as the ${lower(app_role.value.display_name)} (decision authority matrix BKS-GOV-003)."
      allowed_member_types = ["User"]
      enabled              = true
    }
  }

  lifecycle {
    # The identifier URI resource owns this field: the URI names the client ID Entra allocates.
    ignore_changes = [identifier_uris]
  }
}

resource "azuread_service_principal" "reprint_api" {
  client_id = azuread_application.reprint_api.client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

resource "azuread_application_identifier_uri" "reprint_api" {
  application_id = azuread_application.reprint_api.id
  identifier_uri = local.reprint_api_uri
}

# The deployer approves the storyline's expedited reprint, which BKS-GOV-003 gives the publishing director. Assigning
# anyone else a role is an operator step.
resource "azuread_app_role_assignment" "deployer_reprint_approver" {
  app_role_id         = random_uuid.reprint_role["publishing_director"].result
  principal_object_id = data.azurerm_client_config.current.object_id
  resource_object_id  = azuread_service_principal.reprint_api.object_id
}

data "azuread_service_principal" "reprint_graph" {
  client_id = "00000003-0000-0000-c000-000000000000"
}

# The OAuth client of Foundry's reprint-request connection: a public client, with Foundry's redirect URL registered
# as such, so nothing holds a secret. Declaring the scopes is not consent: deploy.py's reprint phase grants them
# tenant-wide as the assumed administrator, and each user still signs in once through the link the app shows.
resource "azuread_application" "reprint_client" {
  display_name            = "${var.project_name}-reprint-client"
  description             = "The OAuth client of the ${var.project_name} reprint-request connection: a public client without a secret, which signs each user in to the reprint request server."
  sign_in_audience        = "AzureADMyOrg"
  owners                  = [data.azurerm_client_config.current.object_id]
  prevent_duplicate_names = true

  required_resource_access {
    resource_app_id = azuread_application.reprint_api.client_id

    resource_access {
      id   = random_uuid.reprint_scope.result
      type = "Scope"
    }
  }

  required_resource_access {
    resource_app_id = data.azuread_service_principal.reprint_graph.client_id

    resource_access {
      id   = data.azuread_service_principal.reprint_graph.oauth2_permission_scope_ids["offline_access"]
      type = "Scope"
    }
  }

  lifecycle {
    # The redirect URI resource owns this field: Foundry allocates the URL after the connection exists.
    ignore_changes = [public_client]
  }
}

resource "azuread_service_principal" "reprint_client" {
  client_id = azuread_application.reprint_client.client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

resource "azuread_application_redirect_uris" "reprint_client" {
  application_id = azuread_application.reprint_client.id
  type           = "PublicClient"
  redirect_uris  = [azapi_resource.reprint_connection.output.properties.redirectUrl]
}

# The with-IQ agent's reprint tool: the server signed in as each user. The first with-IQ question asks the user to
# consent through Foundry's link, which the app shows; Foundry then keeps a token per user and connection.
resource "azapi_resource" "reprint_connection" {
  type                      = "Microsoft.CognitiveServices/accounts/projects/connections@2025-10-01-preview"
  name                      = "reprint-request"
  parent_id                 = azapi_resource.foundry_project.id
  schema_validation_enabled = false
  locks                     = [azapi_resource.foundry.id]

  body = {
    properties = {
      category         = "RemoteTool"
      authType         = "OAuth2"
      target           = local.reprint_mcp_endpoint
      credentials      = { clientId = azuread_application.reprint_client.client_id }
      authorizationUrl = "${local.entra_oauth_endpoint}/authorize"
      tokenUrl         = "${local.entra_oauth_endpoint}/token"
      refreshUrl       = "${local.entra_oauth_endpoint}/token"
      scopes           = local.reprint_oauth_scopes
      isSharedToAll    = false
      metadata         = { type = "generic_mcp" }
    }
  }

  response_export_values = ["properties.redirectUrl"]
}

resource "azurerm_user_assigned_identity" "reprint" {
  name                = "id-${local.resource_prefix}-reprint"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags
}

# Pulling its own image is the reprint identity's only Azure permission; its KQL roles are Fabric's.
resource "azurerm_role_assignment" "reprint_acr_pull" {
  scope                            = azurerm_container_registry.app.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.reprint.principal_id
  skip_service_principal_aad_check = true
}

# Read only once the reprint phase sets reprint_image_tag, after bootstrap imported the KQL database.
data "fabric_kql_database" "reprint" {
  count = var.reprint_image_tag == null ? 0 : 1

  display_name = local.reprint_kql_database
  workspace_id = fabric_workspace.dev.id
}

# Created once deploy.py's reprint phase has built the image and set reprint_image_tag.
resource "azurerm_container_app" "reprint" {
  count = var.reprint_image_tag == null ? 0 : 1

  name                         = local.reprint_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.reprint.id]
  }

  registry {
    server   = azurerm_container_registry.app.login_server
    identity = azurerm_user_assigned_identity.reprint.id
  }

  # Foundry Agent Service calls the server from outside the environment.
  ingress {
    external_enabled           = true
    target_port                = 8080
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.reprint_min_replicas
    # One replica: the server serializes its check-then-write per request in process.
    max_replicas = 1

    container {
      name   = "reprint"
      image  = "${azurerm_container_registry.app.login_server}/${local.reprint_image_name}:${var.reprint_image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "ENTRA_TENANT_ID"
        value = data.azurerm_client_config.current.tenant_id
      }
      env {
        name  = "REPRINT_API_CLIENT_ID"
        value = azuread_application.reprint_api.client_id
      }
      env {
        name  = "REPRINT_OAUTH_CLIENT_ID"
        value = azuread_application.reprint_client.client_id
      }
      env {
        name  = "KQL_QUERY_URI"
        value = data.fabric_kql_database.reprint[0].properties.query_service_uri
      }
      env {
        name  = "KQL_DATABASE"
        value = local.reprint_kql_database
      }
      # Fabric may name the Kusto database by its item ID; the server tries it first.
      env {
        name  = "KQL_DATABASE_ID"
        value = data.fabric_kql_database.reprint[0].id
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.reprint.client_id
      }
      env {
        name  = "APP_VERSION"
        value = var.reprint_image_tag
      }

      # The probes ask only whether the process answers: a store check would keep the Eventhouse awake.
      startup_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/healthz"
        interval_seconds        = 2
        failure_count_threshold = 30
      }
      readiness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = "/healthz"
        interval_seconds = 10
      }
      liveness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = "/healthz"
        interval_seconds = 30
      }
    }
  }

  depends_on = [azurerm_role_assignment.reprint_acr_pull]
}
