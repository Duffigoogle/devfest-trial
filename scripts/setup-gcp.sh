#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-europe-west1}"
REPO="${REPO:-cloudmart-docker-repo}"
CLUSTER="${CLUSTER:-cloudmart-cluster}"
IMAGE_TAG="${IMAGE_TAG:-v1.0.0}"

GKE_SA_NAME="cloudmart-gke-workload"
GKE_SA_EMAIL="${GKE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

CB_SA_NAME="cloudmart-cloudbuild"
CB_SA_EMAIL="${CB_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Error: PROJECT_ID is not set. Run: PROJECT_ID=your-gcp-project-id bash scripts/setup-gcp.sh"
  exit 1
fi

echo "==> Provisioning CloudMart GCP Foundation"
echo "    PROJECT_ID = ${PROJECT_ID}"
echo "    REGION     = ${REGION}"
echo "    REPO       = ${REPO}"
echo "    CLUSTER    = ${CLUSTER}"

# 1. Enable required APIs
echo "==> Enabling Google Cloud APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  container.googleapis.com \
  pubsub.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}"

# 2. Create Artifact Registry Docker repository (cloudmart-docker-repo)
echo "==> Ensuring Artifact Registry Docker repository '${REPO}' exists in ${REGION}..."
gcloud artifacts repositories describe "${REPO}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="CloudMart Docker container images" \
  --project="${PROJECT_ID}"

# 3. Create Pub/Sub topic 'order-events' (k8s/ keeps PUBSUB_TOPIC=order.placed)
echo "==> Ensuring Pub/Sub topic 'order-events' exists..."
gcloud pubsub topics describe order-events --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud pubsub topics create order-events --project="${PROJECT_ID}"

# 4. Create GKE Workloads Service Account & grant least-privilege roles
echo "==> Creating GKE Workloads Service Account (${GKE_SA_EMAIL})..."
gcloud iam service-accounts describe "${GKE_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam service-accounts create "${GKE_SA_NAME}" \
  --display-name="CloudMart GKE Workloads Service Account" \
  --project="${PROJECT_ID}"

echo "==> Binding roles/pubsub.publisher on topic 'order-events' to ${GKE_SA_EMAIL}..."
gcloud pubsub topics add-iam-policy-binding order-events \
  --member="serviceAccount:${GKE_SA_EMAIL}" \
  --role="roles/pubsub.publisher" \
  --project="${PROJECT_ID}" >/dev/null

# 5. Create Cloud Build Service Account & grant least-privilege roles (no Owner or Editor)
echo "==> Creating Cloud Build Service Account (${CB_SA_EMAIL})..."
gcloud iam service-accounts describe "${CB_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam service-accounts create "${CB_SA_NAME}" \
  --display-name="CloudMart Cloud Build Service Account" \
  --project="${PROJECT_ID}"

echo "==> Binding least-privilege roles to Cloud Build SA (${CB_SA_EMAIL})..."
gcloud artifacts repositories add-iam-policy-binding "${REPO}" \
  --location="${REGION}" \
  --member="serviceAccount:${CB_SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --project="${PROJECT_ID}" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA_EMAIL}" \
  --role="roles/logging.logWriter" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA_EMAIL}" \
  --role="roles/container.developer" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA_EMAIL}" \
  --role="roles/run.admin" >/dev/null

# 6. Create GKE Autopilot cluster (cloudmart-cluster) & bind Workload Identity
echo "==> Ensuring GKE Autopilot cluster '${CLUSTER}' exists in ${REGION}..."
gcloud container clusters describe "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud container clusters create-auto "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}"

gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}"

echo "==> Binding GKE Workload Identity (cloudmart/order-sa -> ${GKE_SA_EMAIL})..."
gcloud iam service-accounts add-iam-policy-binding "${GKE_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[cloudmart/order-sa]" \
  --project="${PROJECT_ID}" >/dev/null

echo "==> Provisioning complete! (k8s/ PUBSUB_TOPIC remains set to order.placed)"
