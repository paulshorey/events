import {
  defineRailway,
  github,
  postgres,
  project,
  service,
  volume,
} from "railway/iac";
import target from "./project.json" with { type: "json" };

export default defineRailway((ctx) => {
  if (ctx.projectId !== target.projectId)
    throw new Error("Select the Events Railway project.");
  const selected = Object.entries(target.environments).find(
    ([, env]) => env.id === ctx.environmentId,
  );
  if (!selected)
    throw new Error("Select the Events dev or production environment.");
  const [environment, configuration] = selected;
  // Provisioned by Railway's official Postgres template; credentials and the
  // product-managed mount stay on Railway, never in this definition.
  const database = postgres(configuration.database.name);
  database.networking = { tcpProxies: { "5432": {} } };
  const databaseVolume = volume(configuration.database.volumeName, {
    region: "us-east4-eqdc4a",
    sizeMB: 50000,
    allowOnlineResize: true,
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
  });
  const collector = service(target.serviceName, {
    // SDK 3.15.0's shorthand source object drops checkSuites during normalization.
    source: github(target.repository, {
      branch: configuration.branch,
      checkSuites: target.waitForCI,
    }),
    replicas: 1,
    env: {
      NODE_ENV: "production",
      APP_ENVIRONMENT: environment,
      PORT: "4500",
      DATABASE_URL: database.env.DATABASE_URL,
    },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      startCommand: "node src/server.mjs",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 60,
      restartPolicyMaxRetries: 5,
    },
  });
  return project("Events", {
    resources: [collector, database, databaseVolume],
  });
});
