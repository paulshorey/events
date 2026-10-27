import { fieldSummary } from "./event-fields.mjs";

export const coverageFields = [
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "startBoundary",
  "endBoundary",
  "textLocation",
  "city",
  "coordinates",
];
export function validateQualityPolicy(policy) {
  if (!policy) return;
  if (!policy.scope || typeof policy.scope !== "string")
    throw new Error("Quality policy requires a scope");
  for (const key of ["minRecords", "baselineMinRecords"])
    if (
      policy[key] != null &&
      (!Number.isSafeInteger(policy[key]) || policy[key] < 1)
    )
      throw new Error(`Invalid quality ${key}`);
  for (const [field, value] of Object.entries(policy.minCoverage ?? {}))
    if (
      !coverageFields.includes(field) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    )
      throw new Error(`Invalid quality coverage ${field}`);
  for (const key of ["maxRejectedRate", "maxReviewRate", "maxCoverageDrop"])
    if (
      policy[key] != null &&
      (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1)
    )
      throw new Error(`Invalid quality ${key}`);
}

// Rates describe source claims, not independent semantic approval. Unknown values stay null.
export function assessQuality(records, results, policy, baseline = null) {
  validateQualityPolicy(policy);
  const fields = {
      ...fieldSummary(records),
      startBoundary: records.filter(
        (r) => r.startLocal || (r.allDay === true && r.startDate),
      ).length,
      endBoundary: records.filter(
        (r) => r.endLocal || (r.allDay === true && r.endDate),
      ).length,
    },
    rates = Object.fromEntries(
      coverageFields.map((key) => [
        key,
        records.length ? fields[key] / records.length : 0,
      ]),
    ),
    // Detail enrichment describes the same listing observations again.
    // Keep both rejection counts on the listing/API population.
    enumeration = results.filter((r) => r.acquisition?.kind !== "detail"),
    rejected = enumeration.reduce((n, r) => n + (r.rejected ?? 0), 0),
    observed = enumeration.reduce((n, r) => n + (r.observedCount ?? 0), 0),
    metrics = {
      fields,
      rates,
      rejected,
      observed,
      rejectedRate: observed ? rejected / observed : 0,
      reviewRate: records.length ? fields.needsReview / records.length : 0,
    },
    failures = [];
  const fail = (rule, actual, expected, field) =>
    failures.push({
      code: "source_quality_failed",
      rule,
      field,
      actual,
      expected,
    });
  if (policy) {
    if (records.length < (policy.minRecords ?? 1))
      fail("minRecords", records.length, policy.minRecords ?? 1);
    for (const [field, minimum] of Object.entries(policy.minCoverage ?? {}))
      if (rates[field] < minimum)
        fail("minCoverage", rates[field], minimum, field);
    if (
      policy.maxRejectedRate != null &&
      metrics.rejectedRate > policy.maxRejectedRate
    )
      fail("maxRejectedRate", metrics.rejectedRate, policy.maxRejectedRate);
    if (
      policy.maxReviewRate != null &&
      metrics.reviewRate > policy.maxReviewRate
    )
      fail("maxReviewRate", metrics.reviewRate, policy.maxReviewRate);
    if (
      baseline?.scope === policy.scope &&
      baseline.metrics?.fields.records >= (policy.baselineMinRecords ?? 20) &&
      policy.maxCoverageDrop != null
    )
      for (const field of coverageFields)
        if (
          baseline.metrics.rates[field] - rates[field] >
          policy.maxCoverageDrop
        )
          fail(
            "maxCoverageDrop",
            rates[field],
            baseline.metrics.rates[field] - policy.maxCoverageDrop,
            field,
          );
  }
  return {
    status: policy ? (failures.length ? "failed" : "passed") : "unconfigured",
    scope: policy?.scope ?? null,
    metrics,
    failures,
    baselineCompared: !!(
      policy &&
      baseline?.scope === policy.scope &&
      baseline.metrics?.fields.records >= (policy.baselineMinRecords ?? 20) &&
      policy.maxCoverageDrop != null
    ),
  };
}
