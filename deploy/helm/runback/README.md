# Runback Helm chart

Deploys the Runback web app (the same image built from the repo root
`Dockerfile`) into a Kubernetes cluster. This chart owns the app deployment
only — it does not provision a database. Pick one of the data-layer options
in `docs/SELF_HOSTING.md#data-layer` (self-hosted Postgres, managed Postgres,
or Supabase) and have it reachable from the cluster before installing.

## Quick start

1. Build and push an image (nothing is published to a public registry yet):

   ```bash
   docker build -t <your-registry>/runback:0.4.0 .
   docker push <your-registry>/runback:0.4.0
   ```

2. Copy `values.yaml` and fill in `image.repository` plus everything under
   `secrets:` (or point `secrets.existingSecret` at a Secret you manage
   out-of-band — see the comments in `values.yaml`).

3. Install:

   ```bash
   helm install runback ./deploy/helm/runback -f my-values.yaml
   ```

4. Follow the printed NOTES, or:

   ```bash
   kubectl rollout status deployment/runback
   kubectl port-forward svc/runback 8080:80
   ```

## What this chart does not do

- Provision Postgres/Supabase, object storage, or DNS.
- Publish a container image — you build and host that yourself.
- Configure the AWS/Azure Marketplace metering path described in
  `web/lib/marketplaceMetering.ts` — that's a separate, optional integration
  for cloud-marketplace listings, not required for a normal self-hosted
  install.

See `docs/SELF_HOSTING.md` for the full picture, including the
docker-compose path if you don't need Kubernetes at all.
