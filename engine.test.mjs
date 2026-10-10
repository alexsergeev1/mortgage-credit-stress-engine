import assert from "node:assert/strict";
import test from "node:test";
import { runRiskAudit, runStudy } from "./engine.mjs";

const sample = runStudy({ scenarios: 460 });
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} near ${expected}`);

test("produces an identical study for a fixed seed and keeps scenario splits separate", () => {
  assert.deepEqual(runStudy({ scenarios: 460 }), sample);
  assert.equal(sample.diagnostics.trainingScenarios + sample.paths.length, 460);
  assert.ok(sample.paths.every((scenario) => scenario.id > sample.diagnostics.trainingScenarios));
  assert.notDeepEqual(runStudy({ scenarios: 80, seed: 2 }).paths, runStudy({ scenarios: 80, seed: 3 }).paths);
});

test("keeps the tranche ledger balanced with junior-first credit loss and senior-first principal", () => {
  assert.ok(sample.diagnostics.maxReconciliationDollars < 0.01);
  near(sample.waterfall.reduce((sum, note) => sum + note.loss, 0), sample.diagnostics.waterfallPoolLoss, 0.01);
  for (const vintage of [2019, 2022, 2024]) {
    const notes = sample.waterfall.filter((note) => note.vintage === vintage);
    assert.equal(notes.length, 5);
    assert.ok(notes.at(-1).returnedPrincipal > 0);
    for (const [i, note] of notes.entries()) {
      assert.ok(note.balance >= 0 && note.loss >= 0 && note.returnedPrincipal >= 0);
      near(note.balance + note.loss + note.returnedPrincipal, note.initialPrincipal, 0.01);
      if (i > 0 && note.loss > 0.01) near(notes[i - 1].loss, notes[i - 1].initialPrincipal, 0.01);
    }
  }
});

test("improves training tail loss under fully invested exposure and carry constraints", () => {
  const { config, diagnostics, optimized, baseline } = sample;
  assert.equal(diagnostics.status, "optimized");
  assert.ok(diagnostics.trainingOptimized.feasible);
  assert.ok(diagnostics.trainingOptimized.cvar < diagnostics.trainingBaseline.cvar);
  assert.ok(diagnostics.trainingOptimized.expectedCarry >= config.carryFloor);
  near(optimized.weights.reduce((sum, weight) => sum + weight, 0), 1);
  assert.ok(optimized.weights.every((weight) => weight >= 0 && weight <= config.concentration + 1e-9));
  assert.ok(optimized.vintageWeights.every((weight) => weight <= config.vintageCap + 1e-9));
  assert.ok(optimized.cvar < baseline.cvar);
  assert.ok(diagnostics.carryMatchedTraining.expectedCarry >= diagnostics.carryMatchedTrainingFloor - 1e-9);
  assert.ok(diagnostics.carryMatchedTraining.cvar <= diagnostics.trainingBaseline.cvar + 1e-9);
  near(optimized.cvarDollars, optimized.cvar * config.portfolioSize);
});

test("reports an impossible carry floor with the attainable ceiling", () => {
  const { optimized, diagnostics } = runStudy({ scenarios: 100, carryFloor: 0.15 });
  assert.equal(diagnostics.status, "carry-floor-infeasible");
  assert.equal(optimized.feasible, false);
  assert.ok(diagnostics.maxTrainingCarry < 0.15);
});

test("does not allocate more than the representative tranche's issue principal", () => {
  const { assets, optimized } = runStudy({ scenarios: 200, portfolioSize: 750e6, concentration: 1 });
  assert.ok(optimized.feasible);
  assert.ok(assets.every((asset) => asset.optimizedDollars <= asset.issuePrincipal + 0.01));
  assert.ok(assets.some((asset) => asset.positionCap < 0.2));
});

test("uses only aligned monthly observations and reports chronological coverage", () => {
  const history = Array.from({ length: 84 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`,
    mortgageRatePct: 6 + Math.cos(i / 7),
    unemploymentPct: 5 + Math.sin(i / 9),
    housePriceIndex: 110 + 0.4 * i,
  }));
  const { diagnostics, paths } = runStudy({ scenarios: 100, macroHistory: history });
  assert.equal(diagnostics.historicalMonths, 84);
  assert.equal(diagnostics.historicalQuarterlyChanges, 81);
  assert.equal(diagnostics.historicalThrough, "2006-12");
  assert.equal(diagnostics.historicalCoverage.trainingCount, 64);
  assert.equal(diagnostics.historicalCoverage.holdoutCount, 15);
  assert.ok(paths.every((scenario) => Number.isFinite(scenario.optimizedLoss)));
});

test("fits regional housing sensitivity from aligned adjacent quarters", () => {
  const national = Array.from({ length: 96 }, (_, i) => ({
    month: `${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`,
    mortgageRatePct: 6,
    unemploymentPct: 5,
    housePriceIndex: 110 + 0.4 * i + Math.cos(i / 7),
  }));
  const index = {};
  for (const [i, row] of national.entries()) {
    if ((i + 1) % 3 !== 0) continue;
    const quarter = Math.ceil((i % 12 + 1) / 3);
    index[`${row.month.slice(0, 4)}Q${quarter}`] = 100 * (row.housePriceIndex / 100) ** 1.25;
  }
  const { diagnostics } = runStudy({ scenarios: 80, macroHistory: national, metroHistory: [{ index }] });
  assert.equal(diagnostics.regionalMetroCount, 1);
  assert.equal(diagnostics.regionalObservations, 31);
  near(diagnostics.regionalBetaP10, 1.25);
  near(diagnostics.regionalBetaP90, 1.25);
});

const replayMacro = Array.from({ length: 61 }, (_, i) => ({
  month: new Date(Date.UTC(2006, 11 + i)).toISOString().slice(0, 7),
  mortgageRatePct: 6 + i * 0.02,
  unemploymentPct: 5 + i * 0.03,
  housePriceIndex: 120 - i * 0.3,
}));
const replayInputs = { scenarios: 100, auditScenarios: 200, macroHistory: replayMacro };
const fitted = runStudy(replayInputs);

test("historical replay follows the observed path and rejects gaps instead of filling them", () => {
  const { historical } = runRiskAudit(replayInputs, fitted);
  const [bust, recovery] = historical;
  assert.equal(bust.status, "replayed");
  assert.equal(bust.quarters, 20);
  assert.equal(bust.timeline[0].month, "2007-03");
  assert.equal(bust.timeline.at(-1).month, "2011-12");
  near(bust.timeline[0].mortgageRatePct, 6.04);
  near(bust.housePriceChange, 102 / 120 - 1);
  near(bust.unemploymentPeak, 6.8);
  assert.ok(bust.timeline.every((point, i, points) => !i || point.optimizedLoss >= points[i - 1].optimizedLoss));
  assert.ok(bust.maxReconciliationDollars < 0.01);
  assert.equal(recovery.status, "missing-months");
  const incomplete = runRiskAudit({ ...replayInputs, macroHistory: replayMacro.filter((_, i) => i !== 16) }, fitted);
  assert.equal(incomplete.historical[0].status, "missing-months");
});

test("multi-seed audit keeps fitted allocations fixed and reuses paired scenario draws", () => {
  const first = runRiskAudit(replayInputs, fitted);
  assert.deepEqual(runRiskAudit(replayInputs, fitted), first);
  assert.equal(first.robustness.runs.length, 5);
  assert.equal(first.robustness.totalScenarios, 1000);
  assert.equal(new Set(first.robustness.runs.map((run) => run.seed)).size, 5);
  for (const run of first.robustness.runs) {
    assert.notEqual(run.seed, fitted.config.seed);
    assert.deepEqual(run.optimized.weights, fitted.optimized.weights);
    assert.deepEqual(run.carryMatched.weights, fitted.carryMatched.weights);
    near(run.cvarDelta, run.baseline.cvar - run.optimized.cvar);
    near(run.matchedCvarDeltaDollars, run.baseline.cvarDollars - run.carryMatched.cvarDollars);
  }
});
