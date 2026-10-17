import test from "node:test";
import assert from "node:assert/strict";
import { verifyDatabaseVolume } from "../scripts/hosting-volume.mjs";

const expected = {
  environmentId: "dev",
  serviceId: "postgres",
  volumeId: "original-volume",
};
const attachment = {
  id: "original-attachment",
  volumeId: "original-volume",
  environmentId: "dev",
  serviceId: "postgres",
  mountPath: "/var/lib/postgresql/data",
  deletedAt: null,
  isPendingDeletion: false,
};
const connection = (...nodes) => ({
  pageInfo: { hasNextPage: false },
  edges: nodes.map((node) => ({ node })),
});

test("hosting volume proof returns the live volume and attachment identity", () => {
  assert.deepEqual(verifyDatabaseVolume(connection(attachment), expected), {
    volumeId: "original-volume",
    volumeInstanceId: "original-attachment",
    mountPath: "/var/lib/postgresql/data",
  });
});

test("hosting volume proof rejects replacement, detached, mis-scoped and deleting volumes", () => {
  const broken = [
    connection({ ...attachment, volumeId: "same-name-empty-replacement" }),
    connection(),
    connection({ ...attachment, serviceId: null }),
    connection({ ...attachment, serviceId: "other-database" }),
    connection({ ...attachment, environmentId: "production" }),
    connection({ ...attachment, mountPath: "/other" }),
    connection({ ...attachment, deletedAt: "2026-10-17T00:00:00Z" }),
    connection({ ...attachment, isPendingDeletion: true }),
    connection(attachment, { ...attachment, id: "duplicate" }),
    { ...connection(attachment), pageInfo: { hasNextPage: true } },
  ];
  for (const inventory of broken)
    assert.throws(() => verifyDatabaseVolume(inventory, expected));
});
