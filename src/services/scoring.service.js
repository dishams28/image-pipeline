const SEVERITY_WEIGHT = { info: 0, warning: 0.15, critical: 0.35 };

/**
 * Combines individual check results into a single 0-1 "risk score" and
 * issue count for the job. This is intentionally simple (weighted sum,
 * capped at 1) rather than a learned model -- the goal per the brief is
 * to *structure* uncertainty, not to claim ML-grade accuracy. Consumers
 * of the API get both the aggregate score AND the full per-check
 * breakdown, so they can apply their own business threshold instead of
 * trusting a single number blindly.
 */
function computeOverallScore(results) {
  const failing = results.filter((r) => !r.passed);
  let riskScore = 0;
  for (const r of failing) {
    riskScore += SEVERITY_WEIGHT[r.severity] ?? 0.1;
  }
  riskScore = Math.min(1, riskScore);

  return {
    overallIssueCount: failing.length,
    overallRiskScore: Number(riskScore.toFixed(2)),
    issueSummary: failing.map((r) => ({ check: r.checkName, severity: r.severity, message: r.message })),
  };
}

module.exports = { computeOverallScore };
