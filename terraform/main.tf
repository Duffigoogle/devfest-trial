terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 1. Artifact Registry Docker repository (cloudmart-docker-repo)
resource "google_artifact_registry_repository" "cloudmart" {
  location      = var.region
  repository_id = var.repo
  description   = "CloudMart Docker container images"
  format        = "DOCKER"
}

# 2. Pub/Sub topic (order-events)
resource "google_pubsub_topic" "order_events" {
  name = "order-events"
}

# 3. GKE Autopilot cluster (cloudmart-cluster)
resource "google_container_cluster" "cloudmart_autopilot" {
  name             = var.cluster
  location         = var.region
  enable_autopilot = true
}

# 4. Separate GKE Workloads Service Account (least privilege, no Owner/Editor)
resource "google_service_account" "gke_workload_sa" {
  account_id   = "cloudmart-gke-workload"
  display_name = "CloudMart GKE Workloads Service Account"
}

resource "google_pubsub_topic_iam_member" "gke_workload_pubsub_publisher" {
  topic  = google_pubsub_topic.order_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.gke_workload_sa.email}"
}

resource "google_service_account_iam_member" "gke_workload_identity" {
  service_account_id = google_service_account.gke_workload_sa.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[cloudmart/order-sa]"
  depends_on         = [google_container_cluster.cloudmart_autopilot]
}

# 5. Separate Cloud Build Service Account (least privilege, no Owner/Editor)
resource "google_service_account" "cloudbuild_sa" {
  account_id   = "cloudmart-cloudbuild"
  display_name = "CloudMart Cloud Build Service Account"
}

resource "google_artifact_registry_repository_iam_member" "cloudbuild_ar_writer" {
  location   = google_artifact_registry_repository.cloudmart.location
  repository = google_artifact_registry_repository.cloudmart.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
}

resource "google_project_iam_member" "cloudbuild_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
}

resource "google_project_iam_member" "cloudbuild_gke_developer" {
  project = var.project_id
  role    = "roles/container.developer"
  member  = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
}

resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
}
