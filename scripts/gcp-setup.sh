#!/usr/bin/env bash
# One-time Google Cloud setup so GitHub can deploy OpenLobs to Cloud Run.
#
# Run it in Google Cloud Shell (the terminal icon at the top right of console.cloud.google.com), signed in as the
# owner of the project that already holds your Firebase sign-in and Firestore:
#
#   curl -fsSL https://raw.githubusercontent.com/richid-stack/Busin.New/main/scripts/gcp-setup.sh -o gcp-setup.sh
#   bash gcp-setup.sh
#
# It is safe to run again: anything that already exists is left as it is.
# It never asks for an API key. Keys stay in your GitHub repository secrets; the deploy copies them across.
# At the end it prints the few settings to add to GitHub (repository *variables*, not secrets).
set -uo pipefail

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ok: %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
# Run a command; "already exists" is fine, anything else is shown.
try() {
  local out
  if out=$("$@" 2>&1); then ok "$1 $2 $3"; else
    if grep -qiE 'already exists|ALREADY_EXISTS|is already|already a member' <<<"$out"; then note "already there: $1 $2 $3"; else printf '  PROBLEM with: %s\n%s\n' "$*" "$out"; FAILED=1; fi
  fi
}
FAILED=0

say "OpenLobs: Google Cloud setup for deploying from GitHub"

DEFAULT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
read -r -p "Google Cloud project id [${DEFAULT_PROJECT}]: " PROJECT
PROJECT=${PROJECT:-$DEFAULT_PROJECT}
[ -n "$PROJECT" ] || { echo "A project id is needed."; exit 1; }
read -r -p "Region [europe-west1]: " REGION
REGION=${REGION:-europe-west1}
read -r -p "GitHub account that owns the repository [richid-stack]: " OWNER
OWNER=${OWNER:-richid-stack}
read -r -p "Public contact email shown on the Terms and Privacy pages (blank to skip): " CONTACT

gcloud config set project "$PROJECT" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUN_SA="openlobs-run@${PROJECT}.iam.gserviceaccount.com"
DEPLOY_SA="openlobs-deploy@${PROJECT}.iam.gserviceaccount.com"

say "1/6 Switching on the services"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com firestore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  iam.googleapis.com cloudresourcemanager.googleapis.com && ok "services on" || FAILED=1

say "2/6 The identity the running app uses (only what it needs)"
try gcloud iam service-accounts create openlobs-run --display-name="OpenLobs server"
for role in roles/datastore.user roles/firebaseauth.admin roles/secretmanager.secretAccessor; do
  try gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${RUN_SA}" --role="$role" --condition=None
done

say "3/6 The three secrets the app makes for itself"
make_secret() { # name, bytes
  if gcloud secrets describe "$1" >/dev/null 2>&1; then note "already there: secret $1 (left as it is)"; return; fi
  openssl rand -hex "$2" | tr -d '\n' | gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null && ok "secret $1 made" || FAILED=1
}
make_secret SESSION_SECRET 32
make_secret SECRETS_KEY 32
make_secret CRON_SECRET 24
note "SECRETS_KEY encrypts people's saved tool tokens. Never change or delete it, or those tokens stop working."

say "4/6 A place for the app images"
try gcloud artifacts repositories create openlobs --repository-format=docker --location="$REGION" --description="OpenLobs images"

say "5/6 Letting GitHub deploy without any password"
try gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
try gcloud iam workload-identity-pools providers create-oidc openlobs --location=global --workload-identity-pool=github \
  --display-name="OpenLobs repository" --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner=='${OWNER}'"
try gcloud iam service-accounts create openlobs-deploy --display-name="OpenLobs deploy from GitHub"
for role in roles/run.admin roles/artifactregistry.writer roles/secretmanager.admin roles/cloudscheduler.admin; do
  try gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${DEPLOY_SA}" --role="$role" --condition=None
done
# It may start the service as the app's own identity, and nothing else.
try gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser
try gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository_owner/${OWNER}"
PROVIDER=$(gcloud iam workload-identity-pools providers describe openlobs --location=global --workload-identity-pool=github --format='value(name)')

say "6/6 Checking Firestore is there"
gcloud firestore databases list --format='value(name)' 2>/dev/null | head -3 | sed 's/^/  database: /'
note "The app reads its database name from firebase-applet-config.json. It must be a database in this same project."

say "Done$([ "$FAILED" = 1 ] && echo ' (with problems above: send them to Claude)')"
cat <<EOF

Now add these in GitHub, on the repository: Settings > Secrets and variables > Actions > the "Variables" tab > New repository variable.
(They are not secrets. Do not put them under the Secrets tab.)

  GCP_PROJECT_ID    ${PROJECT}
  GCP_REGION        ${REGION}
  GCP_WIF_PROVIDER  ${PROVIDER}
  GCP_DEPLOY_SA     ${DEPLOY_SA}
  CONTACT_EMAIL     ${CONTACT}

Then: Actions tab > deploy > Run workflow. The first run prints the live address on its summary page.
After it: Firebase console > Authentication > Settings > Authorized domains > add that address (without https://).
EOF
