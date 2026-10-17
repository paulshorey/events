import assert from "node:assert/strict";

export function verifyDatabaseVolume(connection, expected) {
  assert.equal(
    connection?.pageInfo?.hasNextPage,
    false,
    "Database volume inventory is incomplete",
  );
  const attachments = connection.edges
    .map(({ node }) => node)
    .filter(
      (node) =>
        node.environmentId === expected.environmentId &&
        node.serviceId === expected.serviceId &&
        node.mountPath === "/var/lib/postgresql/data" &&
        !node.deletedAt,
    );
  assert.equal(
    attachments.length,
    1,
    "Expected exactly one active database data-volume attachment",
  );
  const attachment = attachments[0];
  assert.equal(
    attachment.volumeId,
    expected.volumeId,
    "Database volume identity changed",
  );
  assert.equal(
    attachment.isPendingDeletion,
    false,
    "Database volume is pending deletion",
  );
  return {
    volumeId: attachment.volumeId,
    volumeInstanceId: attachment.id,
    mountPath: attachment.mountPath,
  };
}
