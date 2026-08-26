---
name: app-deployment-readiness
description: Use when preparing an application repository with the files and configuration required for Kubernetes deployment readiness.
---

# App Deployment Readiness

Prepare the application repository so it contains everything required to be deployment-ready.

## Deployment-Ready Repository

Before declaring the app ready, inspect its existing files and ensure the repository contains:

```text
Dockerfile
.github/workflows/<build-and-deploy-workflow>.yaml
deploy/deployment.yaml
deploy/service.yaml
```

The repository owns all four. Its workflow must validate the app, build a `linux/arm64` image,
publish it to GHCR with an immutable commit-SHA tag, and update the image reference under
`deploy/` to that exact tag.

The image update must change only the intended image reference and must not rewrite unrelated
manifest content. Validation failures must prevent image promotion.

## Kubernetes Manifests

Keep all app Kubernetes desired state under `deploy/`. It must include a Deployment and Service,
plus app-owned non-secret configuration when needed. Reference Secrets and ConfigMaps by name;
never commit real secret values.

## Runtime Configuration

Do not hardcode environment-specific values into application code, Docker images, or CI workflows.
Any value that can vary between environments, deployments, tenants, clusters, domains, regions,
or operational contexts must be provided at runtime through Kubernetes configuration.

Use ConfigMaps for non-sensitive runtime configuration. Use Secrets for sensitive runtime
configuration. Deployment manifests may define or reference app-owned ConfigMaps for
non-sensitive values and must reference Secrets by name without committing secret values.

## Required Rules

- Build `linux/arm64`.
- Use an immutable image tag, such as `ghcr.io/OWNER/APP:sha-<commit>`. Never deploy `latest`.
- Run repository-appropriate tests and configuration validation before image promotion.
- Give every app container memory requests and limits.
- Add readiness and liveness probes that match the app's real HTTP health endpoint.
- Ensure the Dockerfile and application can run as a non-root user whenever possible.
- Keep the container port, Service `targetPort`, and probe ports consistent with the app's actual
  listening port.
- Add `.dockerignore` so secrets, dependencies, build output, and unrelated files are not sent to
  the container build context.
- Keep secrets out of Git.
- Ensure environment-specific values are runtime configuration from ConfigMaps or Secrets, not
  hardcoded in the image.

## Readiness Report

When the repository is ready, report these facts:

```text
Image repository and tag convention
Deploy path
Namespace used by the manifests
Container port and Service port
Health endpoint path
Required external Secret and ConfigMap names
```
