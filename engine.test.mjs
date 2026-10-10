import assert from "node:assert/strict";
import test from "node:test";
import { runStudy } from "./engine.mjs";

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
