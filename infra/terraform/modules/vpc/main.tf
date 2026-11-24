variable "project_id" { type = string }
variable "region" { type = string }
variable "environment" { type = string }

resource "google_compute_network" "cloudmart_vpc" {
  name                    = "cloudmart-${var.environment}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "gke_subnet" {
  name                     = "cloudmart-${var.environment}-gke-subnet"
  ip_cidr_range            = "10.10.0.0/20"
  region                   = var.region
  network                  = google_compute_network.cloudmart_vpc.id
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "gke-pods-range"
    ip_cidr_range = "10.20.0.0/16"
  }

  secondary_ip_range {
    range_name    = "gke-services-range"
    ip_cidr_range = "10.30.0.0/20"
  }
}

resource "google_compute_router" "nat_router" {
  name    = "cloudmart-${var.environment}-router"
  region  = var.region
  network = google_compute_network.cloudmart_vpc.id
}

resource "google_compute_router_nat" "cloud_nat" {
  name                               = "cloudmart-${var.environment}-nat"
  router                             = google_compute_router.nat_router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_global_address" "private_service_access_range" {
  name          = "cloudmart-sql-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.cloudmart_vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.cloudmart_vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_access_range.name]
}

output "vpc_id" { value = google_compute_network.cloudmart_vpc.id }
output "gke_subnet_id" { value = google_compute_subnetwork.gke_subnet.id }
output "pods_secondary_range_name" { value = "gke-pods-range" }
output "services_secondary_range_name" { value = "gke-services-range" }
output "private_vpc_connection" { value = google_service_networking_connection.private_vpc_connection.id }
