import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyCase, assessCompanyCase, suggestedRole } from "./company.mjs";

const inputs = { role: "investor", notionalMillions: 100, budgetMillions: 50, carryFloor: 0.042, concentrationCap: 0.35, appliedAt: "2026-11-10T00:00:00Z" };

test("company case keeps reported assets separate from user-entered exposure and records provenance", () => {
  const companyCase = createCompanyCase({ ...inputs,
    entry: { ticker: "BANK", name: "Example bank", cik: 1234, directory: { asOf: "2026-11-09", delivery: "bundled" } },
    snapshot: { profile: { name: "Example bank" }, delivery: "bundled", asOf: "2026-11-09", facts: [{ id: "assets", label: "Assets", taxonomy: "us-gaap", concept: "Assets", unit: "USD", latest: { value: 4e12, end: "2026-09-30", filed: "2026-11-02", form: "10-Q", url: "https://www.sec.gov/Archives/example" } }] },
  });
  assert.equal(companyCase.mandate.portfolioSizeDollars, 100e6);
  assert.equal(companyCase.company.publicFacts[0].latest.value, 4e12);
  assert.equal(companyCase.company.directory.delivery, "bundled");
  assert.equal(companyCase.company.publicFacts[0].concept, "Assets");
  assert.match(companyCase.scope, /not reported company holdings/);
});

test("mandate rejects unsupported exposure and impossible limits", () => {
  for (const notionalMillions of [NaN, 0, 9, 100.5, 751]) assert.throws(() => createCompanyCase({ ...inputs, notionalMillions }), /whole-million exposure/);
  for (const budgetMillions of [NaN, 0, -1, 101]) assert.throws(() => createCompanyCase({ ...inputs, budgetMillions }), /decision limit/);
  assert.throws(() => createCompanyCase({ ...inputs, role: "unknown" }), /mandate/);
  assert.throws(() => createCompanyCase({ ...inputs, carryFloor: 1 }), /carry floor/);
  assert.throws(() => createCompanyCase({ ...inputs, concentrationCap: 0.05 }), /concentration cap/);
});

test("decision limit is a post-optimization check, distinct from model feasibility", () => {
  const companyCase = createCompanyCase(inputs);
  const study = { config: { portfolioSize: 100e6 }, optimized: { cvarDollars: 60e6, feasible: true }, baseline: { cvarDollars: 80e6 } };
  const assessment = assessCompanyCase(companyCase, study);
  assert.equal(assessment.status, "above-decision-limit");
  assert.equal(assessment.headroomDollars, -10e6);
  assert.equal(assessment.modelConstraintsSatisfied, true);
  assert.ok(Math.abs(assessment.unchangedWeightsExposureScreenDollars - 100e6 * 50 / 60) < 1e-6);
  study.optimized.cvarDollars = 40e6;
  assert.equal(assessCompanyCase(companyCase, study).status, "within-decision-limit");
  study.optimized.feasible = false;
  assert.equal(assessCompanyCase(companyCase, study).status, "review-model-constraints");
  study.config.portfolioSize = 200e6;
  assert.equal(assessCompanyCase(companyCase, study).scopeChanged, true);
  study.config.carryFloor = 0.06;
  study.config.concentration = 0.4;
  assert.equal(assessCompanyCase(companyCase, study).settingsChanged, true);
  assert.equal(assessCompanyCase(companyCase, study).evaluatedCarryFloor, 0.06);
});

test("company roles are suggestions and uncovered companies can use a manually scoped case", () => {
  assert.equal(suggestedRole({ sic: "6021", name: "Example" }), "bank");
  assert.equal(suggestedRole({ sic: "6798", name: "Example" }), "investor");
  assert.equal(suggestedRole({ sic: "6311", name: "Example" }), "investor");
  assert.equal(suggestedRole({ sic: "3571", name: "Example" }), "treasury");
  const companyCase = createCompanyCase({ ...inputs, entry: { ticker: "UNPROFILED", name: "Unprofiled company", cik: 1 } });
  assert.equal(companyCase.company.financialSnapshotAvailable, false);
  assert.deepEqual(companyCase.company.publicFacts, []);
  assert.equal(companyCase.mandate.portfolioSizeDollars, 100e6);
});
