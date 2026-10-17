import test from "node:test";
import assert from "node:assert/strict";
import { createRailwayContext } from "railway/iac";
import definition from "../.railway/railway.ts";
import target from "../.railway/project.json" with { type: "json" };

for (const [environment, configuration] of Object.entries(
  target.environments,
)) {
  test(`Railway normalized ${environment} graph retains its branch and CI gate`, () => {
    const graph = definition(
      createRailwayContext({
        projectId: target.projectId,
        environmentId: configuration.id,
      }),
    );
    assert.equal(graph.resources.length, 3);
    const collector = graph.resources[0];
    const database = graph.resources.find(
      (resource) => resource.type === "database",
    );
    const volume = graph.resources.find(
      (resource) => resource.type === "volume",
    );
    assert.equal(database.engine, "postgres");
    assert.equal(database.name, configuration.database.name);
    assert.equal(database.networking.tcpProxies["5432"] != null, true);
    assert.equal(volume.name, configuration.database.volumeName);
    assert.equal(volume.config.region, "us-east4-eqdc4a");
    assert.equal(volume.config.sizeMB, 50000);
    assert.deepEqual(collector.variables.DATABASE_URL, {
      type: "reference",
      resource: database.address,
      output: "DATABASE_URL",
    });
    assert.equal(collector.source.repo, "paulshorey/events");
    assert.equal(
      collector.source.branch,
      environment === "production" ? "prod" : "main",
    );
    // This fails with SDK 3.15.0's shorthand { repo, branch, checkSuites } form.
    assert.equal(collector.source.checkSuites, true);
    assert.equal(collector.build.builder, "DOCKERFILE");
    assert.equal(collector.deploy.healthcheckPath, "/api/health");
    assert.equal(collector.deploy.cronSchedule, undefined);
  });
}
test("Railway definition refuses unknown projects and environments", () => {
  assert.throws(
    () => definition(createRailwayContext({ projectId: "another-project" })),
    /Events Railway project/,
  );
  assert.throws(
    () =>
      definition(
        createRailwayContext({
          projectId: target.projectId,
          environmentId: "another-environment",
        }),
      ),
    /dev or production/,
  );
});
