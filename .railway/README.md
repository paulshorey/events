# Events Railway infrastructure

`.railway/project.json` owns the non-secret project/workspace/environment IDs and branch mapping. `.railway/railway.ts` owns the complete desired service graph for each of these two environments. Do not apply it to another project or add unrelated resources to the project without updating ownership.

| Environment | GitHub source | Service | Start / readiness |
| --- | --- | --- | --- |
| dev | `paulshorey/events:main` | `events` | [HTTPS health](https://events-dev-7362.up.railway.app/api/health) |
| production | `paulshorey/events:prod` | `events` | [HTTPS health](https://events-production-832d.up.railway.app/api/health) |

Both environments start `node src/server.mjs` and use `/api/health` as the deployment healthcheck.

Railway builds the root Dockerfile. It pins Node 26.9.0 by image digest, installs lockfile production dependencies and the matching Playwright Chromium plus Linux dependencies, then runs as the `node` user. The service probes Chromium launch, the SQLite engine in memory, and the source registry before returning healthy. The health response includes Railway's Git commit/branch, making release verification possible.

The service is a passive deployment host. It does not run a collection scheduler, scrape websites, execute database queries, expose administrative operations or import the local `.artifacts` journal. Containers currently have ephemeral writable storage; durable hosted mining still requires storage for the job journal/captures and an observation importer before collection is enabled. The Mac's existing operational journal and captures remain local and ignored.

## PostgreSQL

| Environment | Database service | Volume | App connection |
| --- | --- | --- | --- |
| dev | `Postgres` | `postgres-volume` | `DB_EVENTS_URL` → `Postgres.DATABASE_PUBLIC_URL` |
| production | `Postgres-production` | `postgres-production-volume` | `DB_EVENTS_URL` → `Postgres-production.DATABASE_PUBLIC_URL` |

Both use Railway's official PostgreSQL 18 SSL template, independent generated credentials, separate persistent volumes mounted at `/var/lib/postgresql/data`, and public TCP access on application port 5432. `.railway/project.json` records IDs, never credentials. The native template's volume capacity is 50,000 MB in `us-east4-eqdc4a`; this is its configured capacity, not evidence of that much data being used. Do not shrink, replace or detach these volumes while reconciling IaC.

The git-ignored, mode-0600 `.env.local` uses each public endpoint with `sslmode=require`: development is active as `DB_EVENTS_URL` and production is commented. The app’s `DB_EVENTS_URL` references the database’s `DATABASE_PUBLIC_URL`. Both local and hosted clients use the public endpoint; private-network optimization is deferred until explicitly requested. `npm run db:check` verifies the active local connection using `psql`, a read-only transaction policy and a statement timeout. SQL checks passed over TLS for both databases on October 17, 2026; neither has application tables. `/api/health` remains a runtime check and makes no database-readiness claim.

Daily and weekly volume backups were enabled with Railway's native database workflow in both environments. These are volume snapshots, not an enabled PITR/HA setup. The managed database helper preserves native credentials/mounts; the TypeScript graph explicitly retains both its database and imported volume resources. Backup schedules are maintained by the native workflow and checked by `hosting:verify`, because SDK 3.15.0's `postgres()` config does not expose them. Verify a restore into an isolated environment before storing irreplaceable production data.

```sh
# In the explicit railway.webarts profile shell, with IDs from project.json:
railway postgres pitr schedule list --project PROJECT_ID --environment ENVIRONMENT_ID --service DATABASE_SERVICE_ID --json
# Repair schedule drift only after inspection:
railway postgres pitr schedule set --daily --weekly --project PROJECT_ID --environment ENVIRONMENT_ID --service DATABASE_SERVICE_ID --json
```

The October 17 provisioning is already applied live. Adopt this updated definition before the next IaC apply: older definitions containing only `events` omit the new persistent database resources. Branch autodeploys do not evaluate IaC, so an application push alone does not delete databases.

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

The definition uses the typed `github()` source helper. With SDK 3.15.0, the shorthand `{ repo, branch, checkSuites }` silently drops `checkSuites`; regression tests assert that the normalized graph retains the CI gate for both environments.

GitHub autodeploy triggers map `main` to dev and `prod` to production. Check suites are enabled; Railway waits for the repository's CI test job. CI runs the IaC type check, parser/framework tests and real Chromium readiness test. A push deploys the configuration already applied to Railway. Editing `.railway/railway.ts` additionally requires its reviewed plan/apply; CI deliberately does not hold a workspace-wide token or silently apply infrastructure.

Feature work should use a feature branch and PR into main. Promote the full reviewed main branch to prod when authorized. The initial repository/bootstrap task was explicitly authorized to commit directly to main and create prod.

Inspect deployment status and logs using explicit project/environment/service targets. Verify the exact deployed commit, successful deployment state and validated HTTPS readiness in both environments. A passing health response establishes runtime capability, not event completeness, database connectivity or long-term worker reliability.

Provider references: [Railway IaC](https://docs.railway.com/infrastructure-as-code), [GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys), [Playwright Docker guidance](https://playwright.dev/docs/docker).

## Read-only verification

```sh
(
  source "$HOME/.config/railway/webarts.env"
  unset RAILWAY_TOKEN
  npm run hosting:verify
)
```

The verifier checks workspace/project identity, both branch triggers and CI gates, a clean IaC plan for both environments, the latest application deployment's successful status and exact remote branch head, HTTPS runtime readiness, PostgreSQL deployment status, retained volume configuration, public TCP configuration and daily/weekly backup schedules. It also checks the live environment-scoped volume attachment against the recorded volume ID, database service, environment and data mount, rejecting detached/replaced/deleting volumes and incomplete inventories. The report contains the verified live volume/attachment IDs rather than merely echoing configuration. It reads no secret values and starts no collection work. SQL connectivity is a separate `db:check` operation. The effective Docker builder comes from the normalized live graph and deployed service manifest; the raw ServiceInstance builder can retain its Railpack default during Dockerfile detection.

The database-level `DATABASE_PUBLIC_URL` is defined from its generated user/password, public TCP host/port and database name, with `sslmode=require`. The provider’s native `DATABASE_URL` remains on the database service; it is not an Events client setting. Neither web service defines generic `DATABASE_URL`, and Events code must never fall back to a globally configured value. `npm run db:check` explicitly selects `.env.local` even when the shell exports another `DB_EVENTS_URL`; missing local credentials fail. For an explicitly selected operational target, direct `node scripts/check-database.mjs` reads the environment instead.

Provider database references: [PostgreSQL](https://docs.railway.com/databases/postgresql), [backups and restores](https://docs.railway.com/guides/postgres-backups-restores), [IaC database intent and volume lifecycle](https://docs.railway.com/infrastructure-as-code/reference).
