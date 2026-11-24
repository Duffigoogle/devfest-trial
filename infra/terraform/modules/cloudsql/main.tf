variable "project_id" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_vpc_connection" { type = string }

locals {
  services = {
    product      = { db_name = "product_db", db_user = "svc_product" }
    cart         = { db_name = "cart_db", db_user = "svc_cart" }
    order        = { db_name = "order_db", db_user = "svc_order" }
    payment      = { db_name = "payment_db", db_user = "svc_payment" }
    notification = { db_name = "notification_db", db_user = "svc_notification" }
  }
}

resource "google_sql_database_instance" "cloudmart_pg" {
  name             = "cloudmart-pg-ha"
  database_version = "POSTGRES_16"
  region           = var.region

  depends_on = [var.private_vpc_connection]

  settings {
    tier              = "db-custom-4-16384"
    availability_type = "REGIONAL"
    disk_autoresize   = true
    disk_size         = 50
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.vpc_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    database_flags {
      name  = "max_connections"
      value = "250"
    }
  }

  deletion_protection = true
}

resource "google_sql_database" "service_dbs" {
  for_each = local.services
  name     = each.value.db_name
  instance = google_sql_database_instance.cloudmart_pg.name
}

resource "random_password" "db_passwords" {
  for_each = local.services
  length   = 32
  special  = false
}

resource "google_sql_user" "service_users" {
  for_each = local.services
  name     = each.value.db_user
  instance = google_sql_database_instance.cloudmart_pg.name
  password = random_password.db_passwords[each.key].result
}

resource "google_secret_manager_secret" "db_url_secrets" {
  for_each  = local.services
  secret_id = "cloudmart-${each.key}-database-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_url_secret_versions" {
  for_each    = local.services
  secret      = google_secret_manager_secret.db_url_secrets[each.key].id
  secret_data = "postgresql://${each.value.db_user}:${random_password.db_passwords[each.key].result}@127.0.0.1:5432/${each.value.db_name}?schema=public"
}

output "instance_connection_name" {
  value = google_sql_database_instance.cloudmart_pg.connection_name
}

output "database_names" {
  value = [for k, v in google_sql_database.service_dbs : v.name]
}
