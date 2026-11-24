variable "project_id" {
  description = "Google Cloud Project ID for CloudMart deployment"
  type        = string
}

variable "region" {
  description = "Primary Google Cloud region for GKE Autopilot and Cloud SQL HA"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Deployment environment label (staging or prod)"
  type        = string
  default     = "prod"
}
