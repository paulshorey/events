# Events Railway infrastructure

`.railway/project.json` owns the non-secret project/workspace/environment IDs and branch mapping. `.railway/railway.ts` owns the complete desired service graph for each of these two environments. Do not apply it to another project or add unrelated resources to the project without updating ownership.

| Environment | GitHub source | Service | Start / readiness |
| --- | --- | --- | --- |
| dev | `paulshorey/events:main` | `events` | `node src/server.mjs` / `/api/health` |
| production | `paulshorey/events:prod` | `events` | `node src/server.mjs` / `/api/health` |

Railway builds the root Dockerfile. It pins Node 26.9.0 by image digest, installs lockfile production dependencies and the matching Playwright Chromium plus Linux dependencies, then runs as the `node` user. The service probes Chromium launch, the SQLite engine in memory, and the source registry before returning healthy. The health response includes Railway's Git commit/branch, making release verification possible.

The service is a passive deployment host. It does not run a scheduler, scrape websites, connect a central database, expose administrative operations or import the local `.artifacts` journal. Containers currently have ephemeral writable storage; durable hosted mining requires a volume/object store and/or central database before collection is enabled. The Mac's existing operational journal and captures remain local and ignored.

## Apply desired state

Use the existing `railway.webarts` workspace profile. Never print it or copy it into this repository. The native Railway CLI is 5.62.1; the repository pins SDK 3.15.0. No broad Railway credential is installed in GitHub Actions.

```sh
npm ci
npm run railway:check
(
  source "$HOME/.config/railway/webarts.env"
  unset RAILWAY_TOKEN RAILWAY_SERVICE_ID
  export RAILWAY_PROJECT_ID=a0315029-9b64-41a0-9c83-e4367366947d
  export RAILWAY_ENVIRONMENT_ID=fb0a7dbd-2f66-4183-b3c3-7b1e7a7afe24
  npm run railway:plan
  # Review every change before applying. Use production's ID from project.json for production.
  npm run railway:apply -- --yes
  npm run railway:plan
)
```

For pinned plans, commit `.railway/` first, then use `railway config plan --file .railway/railway.ts --out .artifacts/PLAN.json` and apply that exact artifact with `railway config apply --plan .artifacts/PLAN.json --yes`. Require a clean follow-up plan. Keep the legacy Railway Config File setting empty; this TypeScript definition is evaluated by config plan/apply, not by a source build.

## Deployment contract

GitHub autodeploy triggers map `main` to dev and `prod` to production. Check suites are enabled; Railway waits for the repository's CI test job. CI runs the IaC type check, parser/framework tests and real Chromium readiness test. A push deploys the configuration already applied to Railway. Editing `.railway/railway.ts` additionally requires its reviewed plan/apply; CI deliberately does not hold a workspace-wide token or silently apply infrastructure.

Feature work should use a feature branch and PR into main. Promote the full reviewed main branch to prod when authorized. The initial repository/bootstrap task was explicitly authorized to commit directly to main and create prod.

Inspect deployment status and logs using explicit project/environment/service targets. Verify the exact deployed commit, successful deployment state and validated HTTPS readiness in both environments. A passing health response establishes runtime capability, not event completeness, database connectivity or long-term worker reliability.

Provider references: [Railway IaC](https://docs.railway.com/infrastructure-as-code), [GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys), [Playwright Docker guidance](https://playwright.dev/docs/docker).
