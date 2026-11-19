resource "azapi_resource" "web_iq" {
  type      = "Microsoft.WebIQ/accounts@2026-06-01-preview"
  name      = local.resource_prefix
  parent_id = azurerm_resource_group.main.id
  location  = "global"
  tags      = local.tags

  # AzAPI 2.13 has no embedded Web IQ schema; the pinned ARM API validates the request.
  schema_validation_enabled = false

  body = {
    kind = "WebIQ.Grounding"
    sku  = { name = "G3" }
    properties = {
      statisticsEnabled = false
    }
  }

  lifecycle {
    precondition {
      condition     = var.web_iq_terms_accepted
      error_message = "Review and explicitly accept Web IQ terms and paid usage before setting web_iq_terms_accepted = true. Azure credits cannot pay for Web IQ; the subscription must be enabled for the service."
    }
  }
}

# The Foundry project identity's application (client) ID, which an operator binds to the account's AppID in the Web IQ
# portal, so that the agents' Web IQ tool can call Web IQ through the web-iq connection. Read only from knowledge setup
# on, with that connection, long after the platform apply created the identity, so Entra has it.
data "azuread_service_principal" "foundry_project" {
  count = var.knowledge_lakehouse_id == null ? 0 : 1

  object_id = azapi_resource.foundry_project.identity[0].principal_id
}
