variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "Google Cloud region for Artifact Registry, GKE Autopilot, and Cloud Run"
  type        = string
  default     = "europe-west1"
}

variable "repo" {
  description = "Artifact Registry Docker repository name"
  type        = string
  default     = "cloudmart-docker-repo"
}

variable "cluster" {
  description = "GKE Autopilot cluster name"
  type        = string
  default     = "cloudmart-cluster"
}
