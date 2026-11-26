output "artifact_registry_repo" {
  description = "Artifact Registry Docker repository path"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cloudmart.repository_id}"
}

output "gke_cluster_name" {
  description = "GKE Autopilot cluster name"
  value       = google_container_cluster.cloudmart_autopilot.name
}

output "pubsub_topic" {
  description = "Pub/Sub topic name"
  value       = google_pubsub_topic.order_events.name
}

output "gke_workload_sa_email" {
  description = "Least-privilege GKE Workloads Service Account email"
  value       = google_service_account.gke_workload_sa.email
}

output "cloudbuild_sa_email" {
  description = "Least-privilege Cloud Build Service Account email"
  value       = google_service_account.cloudbuild_sa.email
}
