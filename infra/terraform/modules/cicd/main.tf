variable "project_id" { type = string }
variable "region" { type = string }
variable "gke_cluster_id" { type = string }

resource "google_artifact_registry_repository" "cloudmart_repo" {
  location      = var.region
  repository_id = "cloudmart-repo"
  description   = "CloudMart Microservices Docker Images Repository"
  format        = "DOCKER"

  docker_config {
    immutable_tags = true
  }
}

resource "google_clouddeploy_target" "gke_staging" {
  location    = var.region
  name        = "gke-staging"
  description = "CloudMart GKE Autopilot Staging Target"

  gke {
    cluster = var.gke_cluster_id
  }
}

resource "google_clouddeploy_target" "gke_prod" {
  location         = var.region
  name             = "gke-prod"
  description      = "CloudMart GKE Autopilot Production Target"
  require_approval = true

  gke {
    cluster = var.gke_cluster_id
  }
}

resource "google_clouddeploy_delivery_pipeline" "cloudmart_pipeline" {
  location    = var.region
  name        = "cloudmart-gke-delivery"
  description = "Progressive Delivery Pipeline for CloudMart Microservices"

  serial_pipeline {
    stages {
      target_id = google_clouddeploy_target.gke_staging.name
      profiles  = ["staging"]
    }
    stages {
      target_id = google_clouddeploy_target.gke_prod.name
      profiles  = ["prod"]
    }
  }
}

output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cloudmart_repo.repository_id}"
}
