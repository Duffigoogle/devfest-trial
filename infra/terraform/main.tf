provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

module "vpc" {
  source      = "./modules/vpc"
  project_id  = var.project_id
  region      = var.region
  environment = var.environment
}

module "gke" {
  source            = "./modules/gke"
  project_id        = var.project_id
  region            = var.region
  vpc_id            = module.vpc.vpc_id
  subnet_id         = module.vpc.gke_subnet_id
  pods_range_name   = module.vpc.pods_secondary_range_name
  svc_range_name    = module.vpc.services_secondary_range_name
}

module "cloudsql" {
  source                  = "./modules/cloudsql"
  project_id              = var.project_id
  region                  = var.region
  vpc_id                  = module.vpc.vpc_id
  private_vpc_connection  = module.vpc.private_vpc_connection
}

module "pubsub" {
  source     = "./modules/pubsub"
  project_id = var.project_id
}

module "cicd" {
  source           = "./modules/cicd"
  project_id       = var.project_id
  region           = var.region
  gke_cluster_id   = module.gke.cluster_id
}
