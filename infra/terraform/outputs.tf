output "gke_cluster_name" {
  description = "GKE Autopilot Regional Cluster Name"
  value       = module.gke.cluster_name
}

output "cloudsql_connection_name" {
  description = "Cloud SQL for PostgreSQL HA Instance Connection Name for Auth Proxy"
  value       = module.cloudsql.instance_connection_name
}

output "isolated_databases" {
  description = "List of the 5 isolated logical PostgreSQL databases provisioned on Cloud SQL"
  value       = module.cloudsql.database_names
}

output "pubsub_topics" {
  description = "Cloud Pub/Sub Domain Event Topics"
  value       = module.pubsub.topic_names
}

output "artifact_registry_repository" {
  description = "Artifact Registry Docker repository URL"
  value       = module.cicd.artifact_registry_url
}
