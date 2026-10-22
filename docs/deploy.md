# Deploying OpenLobs to Google Cloud (Cloud Run)

This is the checklist for going live. Commands were written from the Google Cloud documentation and **have not been run against your project from here**: run them one at a time and read what they print.

Set these once in your terminal:

```bash
PROJECT=your-gcp-project-id
REGION=europe-west1            # pick the region closest to your users
SERVICE=openlobs
# The Firestore database this app uses (see firestoreDatabaseId in firebase-applet-config.json):
DB=ai-studio-chatvue-56a0dec3-90ee-47ed-8252-32967e796bf7
gcloud config set project $PROJECT
```

**One project for everything.** `PROJECT` must be the same Google Cloud project that Firebase Authentication and Firestore live in: the image carries `firebase-applet-config.json`, and the server uses its `projectId` and `firestoreDatabaseId`. If you deploy to a different project, update that file first (it holds public values only), or the app will talk to the wrong Firestore and reject real sign-ins.

## 1. Switch on the services

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com firestore.googleapis.com
```

## 2. A service account for the app

The app uses Application Default Credentials, so give it its own identity with only what it needs:

```bash
gcloud iam service-accounts create openlobs-run --display-name="OpenLobs server"
SA=openlobs-run@$PROJECT.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/datastore.user
# Needed for "Delete account" to remove the sign-in account itself:
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/firebaseauth.admin
# Needed to read secrets:
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
```

## 3. Secrets

Create each one in Secret Manager (never in the repository):

```bash
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create SESSION_SECRET --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create SECRETS_KEY --data-file=-
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create CRON_SECRET --data-file=-
printf '%s' "your-key" | gcloud secrets create GEMINI_API_KEY --data-file=-
# Repeat for GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, COMPOSIO_API_KEY, FIRECRAWL_API_KEY, ... as you use them.
```

`SECRETS_KEY` encrypts people's MCP tokens. **Back it up somewhere safe**: if it is lost or changed, stored MCP tokens become unreadable and people must add them again.

## 4. Build and deploy

The `Dockerfile` builds the app and runs `node .output/server/index.mjs` on port 8080. The contact email shown on the Terms and Privacy pages is set at build time, so build with Cloud Build and pass it:

```bash
gcloud artifacts repositories create openlobs --repository-format=docker --location=$REGION
IMAGE=$REGION-docker.pkg.dev/$PROJECT/openlobs/app:$(git rev-parse --short HEAD)
gcloud builds submit --config cloudbuild.yaml --substitutions=_IMAGE=$IMAGE,_CONTACT_EMAIL=hello@yourdomain.com

gcloud run deploy $SERVICE --image $IMAGE --region $REGION \
  --service-account $SA --allow-unauthenticated \
  --min-instances 0 --max-instances 3 --memory 512Mi --concurrency 40 --timeout 300 \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,SECRETS_KEY=SECRETS_KEY:latest,CRON_SECRET=CRON_SECRET:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --set-env-vars NODE_ENV=production
```

Notes:

- `--min-instances 0` keeps you inside the free tier (the first request after a quiet period is slower). `--max-instances 3` caps cost and bounds how much a traffic spike can spend.
- Rate limits are held in each instance's memory, so with several instances the effective limit is per instance. That is fine at this size.
- Chat answers stream for up to a few minutes, so keep `--timeout` at 300 or more.
- Add the usage tuning variables if you want to change plans: `USAGE_FREE_DAILY`, `USAGE_FREE_MONTHLY`, and so on (see `.env.example`), and `USAGE_UNLIMITED_USER_IDS` for yourself.
- Check it started: `curl https://YOUR-SERVICE-URL/api/health` should print `{"ok":true,...}`.
- Add your service URL's host to Firebase → Authentication → Settings → **Authorized domains**, or sign-in will be refused.

## 5. The scheduler for workflows

Scheduled workflows only run when something calls the timer endpoint:

```bash
URL=$(gcloud run services describe $SERVICE --region $REGION --format='value(status.url)')
gcloud scheduler jobs create http openlobs-cron --location $REGION --schedule="*/5 * * * *" \
  --uri="$URL/api/cron/workflows" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET)"
```

Tasks run in the background, started right when one is created and picked up again by this second timer if a server stops half way (this also takes over tasks whose worker disappeared):

```bash
gcloud scheduler jobs create http openlobs-cron-tasks --location $REGION --schedule="*/2 * * * *" \
  --uri="$URL/api/cron/tasks" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET)"
```

For tasks to keep running after the page closes, the app's Cloud Run service should keep its CPU (`--no-cpu-throttling`) or you rely on this timer alone (tasks then start within two minutes). Not tested by the authors on a live deploy.

## 5b. Paid plans and email (when you are ready to charge)

1. In the Paystack dashboard (Settings → API Keys & Webhooks) copy the **secret key** and set the **Webhook URL** to `https://YOUR-SERVICE-URL/api/webhooks/paystack`. Use the test key first and make a test payment end to end.
2. Store the key and set the prices and public address:

```bash
printf '%s' "sk_live_..." | gcloud secrets create PAYSTACK_SECRET_KEY --data-file=-
gcloud run services update $SERVICE --region $REGION \
  --update-secrets PAYSTACK_SECRET_KEY=PAYSTACK_SECRET_KEY:latest \
  --update-env-vars APP_URL=https://YOUR-DOMAIN,PRO_PRICE_MONTH=60,PRO_PRICE_YEAR=600
```

(The prices above are examples. Set your own, in whole cedis.)

3. In Resend, verify your sending domain, create an API key, then:

```bash
printf '%s' "re_..." | gcloud secrets create RESEND_API_KEY --data-file=-
gcloud run services update $SERVICE --region $REGION \
  --update-secrets RESEND_API_KEY=RESEND_API_KEY:latest \
  --update-env-vars EMAIL_FROM="OpenLobs <hello@yourdomain.com>"
```

4. A daily job for the "Pro is ending" reminders:

```bash
gcloud scheduler jobs create http openlobs-billing --location $REGION --schedule="0 8 * * *" \
  --uri="$URL/api/cron/billing" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET)"
```

5. Do a real test: pay a small amount by card and by mobile money, check Pro starts, the receipt arrives and the payment shows in Settings. Refunds and disputes are handled in the Paystack dashboard (the app does not take Pro away by itself when a payment is reversed).

## 5c. Visual checks (optional)

Visual checks need a small screenshot worker, a separate Cloud Run service so a browser crash or a hostile page cannot take the app down. Without it, chat can still judge screenshots people attach.

```bash
SECRET=$(openssl rand -hex 32)
gcloud iam service-accounts create openlobs-inspector --display-name "OpenLobs screenshot worker"   # no roles on purpose
docker build -f Dockerfile.inspector -t $REGION-docker.pkg.dev/$PROJECT/$REPO/openlobs-inspector .
docker push $REGION-docker.pkg.dev/$PROJECT/$REPO/openlobs-inspector
gcloud run deploy openlobs-inspector --image $REGION-docker.pkg.dev/$PROJECT/$REPO/openlobs-inspector \
  --region $REGION --service-account openlobs-inspector@$PROJECT.iam.gserviceaccount.com \
  --memory 2Gi --cpu 1 --concurrency 1 --max-instances 2 --timeout 60 --allow-unauthenticated \
  --set-env-vars INSPECTOR_SECRET=$SECRET
```

The worker has no roles, so even a page that tricked the browser into reaching the metadata server would get nothing useful. It is public so the app can call it, but it answers only requests that carry `INSPECTOR_SECRET`, takes one picture at a time, and refuses private addresses (checked again for every request the page makes). Then give the app the address and the same secret (store the secret in Secret Manager like the others) as `INSPECTOR_URL` and `INSPECTOR_SECRET`, and redeploy. Check it with `curl $WORKER_URL/health`. The pictures it takes are kept in the same 30-day file store as created files.

Not tested by the authors: the exact base image tag (`mcr.microsoft.com/playwright:v1.56.0-noble`) and the commands above; check them on first deploy.

## 6. Created files expire on their own

Files OpenLobs creates are kept for 30 days (`expiresAt`). The app hides expired files, but Firestore only deletes them if a TTL policy is on:

```bash
gcloud firestore fields ttls update expiresAt --collection-group=generated_files --database=$DB --enable-ttl
```

## 7. Backups

Daily backups, kept for a week, plus the ability to undo a bad change within the last 7 days:

```bash
gcloud firestore backups schedules create --database=$DB --recurrence=daily --retention=7d
gcloud firestore databases update --database=$DB --enable-pitr
```

Both cost a little for storage; raise the retention only when you need it. To restore, use `gcloud firestore databases restore --source-backup=... --destination-database=NEW_DB`, then point `firestoreDatabaseId` at the new database. Practise this once on a copy before you need it.

## 8. Know when something breaks

- **Errors:** unexpected server errors are written to the logs in the format Cloud Error Reporting groups. Open *Error Reporting* in the console and switch on email notifications for new errors. Browser errors arrive as warnings in Cloud Logging (filter `jsonPayload.source="browser"`).
- **Uptime:** create an uptime check on `https://YOUR-SERVICE-URL/api/health` (Monitoring → Uptime checks) with an email alert.
- **Spend:** set a budget alert (Billing → Budgets) at an amount you are comfortable with.
- Logs hold only error text and the page path. Request bodies, headers, browser details and people's content are never logged.

## 9. Before you tell people about it

- Set the contact email (step 4) and have a Ghanaian lawyer read `src/pages/terms.vue` and `src/pages/privacy.vue`. They are written in plain English from what the app does, but they are not legal advice.
- Register with Ghana's Data Protection Commission if the law requires it for your business.
- Deploy the Firestore rules (the repository's `firebase.json` points at `firestore.rules`): `firebase deploy --only firestore:rules --project $PROJECT`. The rules file applies to the default database; if you use a named database (see `DB` above), deploy with `firebase deploy --only firestore:rules` after adding that database to `firebase.json`, or paste the rules in the console.
- In the Composio dashboard, set your own branding and OAuth apps so people see "OpenLobs", not a third party, when connecting.
