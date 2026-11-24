variable "project_id" { type = string }

locals {
  topics = [
    "cloudmart.orders.events",
    "cloudmart.inventory.events",
    "cloudmart.payments.events",
  ]

  subscriptions = {
    "product-service.orders.sub" = {
      topic = "cloudmart.orders.events"
    }
    "cart-service.orders.sub" = {
      topic = "cloudmart.orders.events"
    }
    "notification-service.orders.sub" = {
      topic = "cloudmart.orders.events"
    }
    "order-service.inventory.sub" = {
      topic = "cloudmart.inventory.events"
    }
    "payment-service.inventory.sub" = {
      topic = "cloudmart.inventory.events"
    }
    "order-service.payments.sub" = {
      topic = "cloudmart.payments.events"
    }
  }
}

resource "google_pubsub_topic" "domain_topics" {
  for_each                   = toset(local.topics)
  name                       = each.value
  message_retention_duration = "604800s" # 7 days
}

resource "google_pubsub_topic" "dead_letter_topics" {
  for_each = local.subscriptions
  name     = "${each.key}.dlq"
}

resource "google_pubsub_subscription" "service_subscriptions" {
  for_each = local.subscriptions
  name     = each.key
  topic    = google_pubsub_topic.domain_topics[each.value.topic].id

  ack_deadline_seconds       = 30
  message_retention_duration = "604800s"
  retain_acked_messages      = false

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter_topics[each.key].id
    max_delivery_attempts = 5
  }
}

output "topic_names" {
  value = [for t in google_pubsub_topic.domain_topics : t.name]
}
