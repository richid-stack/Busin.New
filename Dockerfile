# OpenLobs for Cloud Run. Build: `gcloud run deploy --source .` (or `docker build .`).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public settings baked into the browser bundle, e.g. --build-arg VITE_CONTACT_EMAIL=hello@example.com
ARG VITE_CONTACT_EMAIL=""
ENV VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
# The build is self-contained: server code, bundled skills and the web app are all in .output.
COPY --from=build /app/.output ./.output
# The server reads the Firebase project and database id from this file at start-up (public values, no secrets).
COPY --from=build /app/firebase-applet-config.json ./firebase-applet-config.json
USER node
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
