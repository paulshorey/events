import { defineRailway, project, service } from "railway/iac";
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
  const collector = service(target.serviceName, {
    source: {
      repo: target.repository,
      branch: configuration.branch,
      checkSuites: true,
    },
    replicas: 1,
    env: { NODE_ENV: "production", APP_ENVIRONMENT: environment, PORT: "4500" },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      startCommand: "node src/server.mjs",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 60,
      restartPolicyMaxRetries: 5,
    },
  });
  return project("Events", { resources: [collector] });
});
