import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = JSON.parse(
  await readFile(new URL("../.railway/project.json", import.meta.url)),
);
function command(program, args, environment = {}) {
  return execFileSync(program, args, {
    cwd: root,
    // SDK 3.15.0 probes the native CLI through _. Direct Node spawning otherwise
    // inherits the parent node/npm executable and misidentifies the CLI version.
    env: {
      ...process.env,
      ...environment,
      ...(program === "railway" ? { _: "railway" } : {}),
    },
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function api(query, variables) {
  const result = JSON.parse(
    command("railway", [
      "api",
      query,
      "--variables",
      JSON.stringify(variables),
    ]),
  );
  if (result.errors?.length)
    throw new Error(result.errors.map((e) => e.message).join("; "));
  return result.data;
}

try {
  if (!process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN)
    throw new Error(
      "Explicitly load the railway.webarts workspace profile and unset RAILWAY_TOKEN before verification.",
    );
  const data = api(
    `query($id:String!){project(id:$id){id name workspaceId environments{edges{node{id name deploymentTriggers{edges{node{id repository branch checkSuites serviceId}}}}}}}}`,
    { id: target.projectId },
  );
  assert.equal(data.project.name, "Events");
  assert.equal(data.project.workspaceId, target.workspaceId);
  const branches = command("git", [
    "ls-remote",
    "origin",
    ...Object.values(target.environments).map((e) => `refs/heads/${e.branch}`),
  ])
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/));
  const heads = new Map(branches.map(([sha, ref]) => [ref, sha]));
  const results = [];
  for (const [name, env] of Object.entries(target.environments)) {
    const current = data.project.environments.edges.find(
      (e) => e.node.id === env.id,
    )?.node;
    assert.equal(current?.name, name);
    const matching = current.deploymentTriggers.edges.filter(
      (e) => e.node.serviceId === target.serviceId,
    );
    assert.equal(matching.length, 1);
    const trigger = matching[0].node;
    assert.equal(trigger.repository, target.repository);
    assert.equal(trigger.branch, env.branch);
    assert.equal(trigger.checkSuites, target.waitForCI);
    const instance = api(
      `query($service:String!,$environment:String!){serviceInstance(serviceId:$service,environmentId:$environment){serviceId environmentId source{repo} builder dockerfilePath startCommand healthcheckPath healthcheckTimeout railwayConfigFile}}`,
      { service: target.serviceId, environment: env.id },
    ).serviceInstance;
    assert.equal(instance.source.repo, target.repository);
    const plan = JSON.parse(
      command(
        "railway",
        ["config", "plan", "--file", ".railway/railway.ts", "--json"],
        {
          RAILWAY_PROJECT_ID: target.projectId,
          RAILWAY_ENVIRONMENT_ID: env.id,
          RAILWAY_SERVICE_ID: undefined,
        },
      ),
    );
    assert.equal(plan.ok, true);
    assert.equal(
      plan.changeSet.changes.length,
      0,
      `${name}: infrastructure drift`,
    );
    const effective = plan.currentGraph.resources.find(
      (resource) => resource.address === `service.${target.serviceName}`,
    );
    assert.equal(effective.build.builder, "DOCKERFILE");
    assert.equal(instance.startCommand, "node src/server.mjs");
    assert.equal(instance.healthcheckPath, "/api/health");
    assert.ok(!instance.railwayConfigFile);
    const deployments = JSON.parse(
      command("railway", [
        "deployment",
        "list",
        "--project",
        target.projectId,
        "--environment",
        env.id,
        "--service",
        target.serviceId,
        "--limit",
        "5",
        "--json",
      ]),
    );
    assert.ok(deployments.length, `${name}: no deployment`);
    const deployment = deployments[0],
      expected = heads.get(`refs/heads/${env.branch}`);
    assert.ok(expected);
    assert.equal(
      deployment.status,
      "SUCCESS",
      `${name}: latest deployment is ${deployment.status}`,
    );
    assert.equal(
      deployment.meta?.commitHash,
      expected,
      `${name}: deployment differs from its branch head`,
    );
    assert.equal(deployment.meta?.branch, env.branch);
    // Raw ServiceInstance.builder can retain RAILPACK during Dockerfile detection.
    // The deployed manifest and normalized live graph describe the effective build.
    assert.equal(
      deployment.meta?.serviceManifest?.build?.builder,
      "DOCKERFILE",
    );
    assert.equal(
      deployment.meta?.serviceManifest?.build?.dockerfilePath,
      "Dockerfile",
    );
    const response = await fetch(`${env.url}/api/health`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.status, "ok");
    assert.equal(health.environment, name);
    assert.equal(health.commit, expected);
    assert.equal(health.branch, env.branch);
    assert.equal(health.schedulerRunning, false);
    assert.equal(health.collectionMode, "manual-only");
    assert.equal(health.capabilities.chromium, true);
    assert.equal(health.capabilities.sqliteEngine, true);
    assert.equal(health.capabilities.registeredCollections, 97);
    results.push({
      environment: name,
      branch: env.branch,
      url: env.url,
      commit: expected,
      deploymentId: deployment.id,
      status: deployment.status,
      waitForCI: trigger.checkSuites,
      configurationAligned: true,
      browserReady: true,
      schedulerRunning: false,
    });
  }
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        projectId: target.projectId,
        serviceId: target.serviceId,
        results,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
