variable "project_id" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "pods_range_name" { type = string }
variable "svc_range_name" { type = string }

resource "google_container_cluster" "autopilot" {
  name             = "cloudmart-autopilot-cluster"
  location         = var.region
  enable_autopilot = true

  network    = var.vpc_id
  subnetwork = var.subnet_id

  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.svc_range_name
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  gateway_api_config {
    channel = "CHANNEL_STANDARD"
  }

  release_channel {
    channel = "REGULAR"
  }

  deletion_protection = true
}

output "cluster_id" { value = google_container_cluster.autopilot.id }
output "cluster_name" { value = google_container_cluster.autopilot.name }
