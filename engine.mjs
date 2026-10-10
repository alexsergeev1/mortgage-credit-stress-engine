const QUARTERS = 20;
const BASELINE_SEED = 51026;
const EPSILON = 1e-10;
const REPLAY_WINDOWS = [
  { id: "housing-crisis", label: "Housing bust and financial crisis", start: "2006-12", end: "2011-12" },
  { id: "recovery", label: "Housing recovery and expansion", start: "2012-12", end: "2017-12" },
  { id: "pandemic", label: "Pandemic shock and reopening", start: "2019-12", end: "2024-12" },
  { id: "rate-reset", label: "Mortgage rate reset", start: "2021-12", end: "2025-09" },
];
const AUDIT_SEEDS = [104729, 224737, 350377, 479909, 611953];

const deals = [
  {
    id: "R19", vintage: 2019, principal: 15.0e9, loanRate: 0.039,
    collateral: [[0.53, 0.59, 0.0036], [0.35, 0.71, 0.0080], [0.12, 0.84, 0.0170]],
    cuts: [0.0020, 0.0080, 0.0170, 0.0350], coupons: [0.080, 0.057, 0.039],
  },
  {
    id: "R22", vintage: 2022, principal: 19.2e9, loanRate: 0.052,
    collateral: [[0.38, 0.71, 0.0050], [0.43, 0.83, 0.0110], [0.19, 0.93, 0.0250]],
    cuts: [0.0025, 0.0095, 0.0200, 0.0440], coupons: [0.105, 0.071, 0.051],
  },
  {
    id: "R24", vintage: 2024, principal: 16.8e9, loanRate: 0.067,
    collateral: [[0.44, 0.69, 0.0043], [0.40, 0.79, 0.0096], [0.16, 0.90, 0.0205]],
    cuts: [0.0022, 0.0087, 0.0190, 0.0410], coupons: [0.093, 0.064, 0.045],
  },
];

const trancheNames = ["B", "M2", "M1"];
const assets = deals.flatMap((deal, dealIndex) => trancheNames.map((label, i) => ({
  id: `${deal.id}-${label}`,
  label: `${deal.vintage} · ${label}`,
  vintage: deal.vintage,
  dealIndex,
  attachment: deal.cuts[i],
  detachment: deal.cuts[i + 1],
  issuePrincipal: (deal.cuts[i + 1] - deal.cuts[i]) * deal.principal,
  coupon: deal.coupons[i],
})));
const assetCount = assets.length;
const totalPool = deals.reduce((sum, deal) => sum + deal.principal, 0);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function bounded(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function parameters(options) {
  return {
    stress: bounded(options.stress, 1, 0, 2.5),
    portfolioSize: bounded(options.portfolioSize, 100e6, 1e6, 750e6),
    scenarios: Math.round(bounded(options.scenarios, 1200, 80, 8000)),
    carryFloor: bounded(options.carryFloor, 0.042, 0, 0.15),
    concentration: bounded(options.concentration, 0.35, 1 / assetCount, 1),
    vintageCap: bounded(options.vintageCap, 0.56, 1 / deals.length, 1),
    confidence: bounded(options.confidence, 0.95, 0.8, 0.99),
    seed: Math.round(bounded(options.seed, BASELINE_SEED, 0, 4294967295)),
    quarters: QUARTERS,
  };
}

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  return Math.sqrt(-2 * Math.log(Math.max(random(), Number.EPSILON))) * Math.cos(2 * Math.PI * random());
}

function monthNumber(month) {
  const [year, index] = month.split("-").map(Number);
  return 12 * year + index;
}

function percentile(sorted, proportion) {
  const position = (sorted.length - 1) * proportion;
  const i = Math.floor(position);
  return sorted[i] + (position - i) * (sorted[Math.ceil(position)] - sorted[i]);
}

function historyCoverage(vectors) {
  if (vectors.length < 40) return null;
  const trainingCount = Math.floor(0.8 * vectors.length);
  const calibration = vectors.slice(0, trainingCount);
  // Skip the first two holdout observations so their three-month windows do not overlap training.
  const holdout = vectors.slice(trainingCount + 2);
  const labels = ["Unemployment change", "Mortgage rate change", "Log house-price change"];
  return {
    trainingCount,
    holdoutCount: holdout.length,
    centralInterval: 0.8,
    variables: labels.map((label, i) => {
      const training = calibration.map((vector) => vector[i]).sort((a, b) => a - b);
      const minimum = percentile(training, 0.1), maximum = percentile(training, 0.9);
      const contained = holdout.filter((vector) => vector[i] >= minimum && vector[i] <= maximum);
      return { label, minimum, maximum, observedCoverage: contained.length / holdout.length };
    }),
  };
}

function calibrateMacro(history) {
  const byMonth = new Map();
  for (const row of Array.isArray(history) ? history : []) {
    if (row && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) &&
      Number.isFinite(row.mortgageRatePct) && Number.isFinite(row.unemploymentPct) &&
      Number.isFinite(row.housePriceIndex) && row.housePriceIndex > 0) {
      byMonth.set(monthNumber(row.month), row);
    }
  }
  const sorted = [...byMonth].sort(([a], [b]) => a - b);
  const vectors = [];
  for (const [month, row] of sorted) {
    const previous = byMonth.get(month - 3);
    if (!previous) continue;
    vectors.push([
      row.unemploymentPct - previous.unemploymentPct,
      (row.mortgageRatePct - previous.mortgageRatePct) / 100,
      Math.log(row.housePriceIndex / previous.housePriceIndex),
    ]);
  }
  const means = [0, 0, 0];
  for (const vector of vectors) {
    for (let i = 0; i < means.length; i++) means[i] += vector[i] / vectors.length;
  }
  const last = sorted.at(-1)?.[1];
  const nationalQuarters = new Map(sorted.filter(([month]) => month % 3 === 0)
    .map(([month, row]) => [month / 3, row.housePriceIndex]));
  return {
    months: sorted.length,
    lastMonth: last?.month ?? null,
    mortgageRate: last ? last.mortgageRatePct / 100 : 0.065,
    unemployment: last?.unemploymentPct ?? 4.3,
    innovations: vectors.map((vector) => vector.map((value, i) => value - means[i])),
    historicalCoverage: historyCoverage(vectors),
    nationalQuarters,
    monthly: byMonth,
  };
}

function calibrateRegional(history, nationalQuarters) {
  const betas = [];
  let observations = 0;
  for (const metro of Array.isArray(history) ? history : []) {
    const local = new Map();
    for (const [label, index] of Object.entries(metro?.index ?? {})) {
      if (!/^\d{4}Q[1-4]$/.test(label) || !Number.isFinite(index) || index <= 0) continue;
      local.set(Number(label.slice(0, 4)) * 4 + Number(label.at(-1)), index);
    }
    let count = 0, sumNational = 0, sumLocal = 0, sumSquares = 0, crossProducts = 0;
    for (const [quarter, index] of local) {
      const localPrevious = local.get(quarter - 1);
      const national = nationalQuarters.get(quarter);
      const nationalPrevious = nationalQuarters.get(quarter - 1);
      if (!localPrevious || !national || !nationalPrevious) continue;
      const x = Math.log(national / nationalPrevious);
      const y = Math.log(index / localPrevious);
      count++;
      sumNational += x;
      sumLocal += y;
      sumSquares += x * x;
      crossProducts += x * y;
    }
    if (count < 28) continue;
    const variance = sumSquares - sumNational ** 2 / count;
    if (variance <= EPSILON) continue;
    const covariance = crossProducts - sumNational * sumLocal / count;
    betas.push(clamp(covariance / variance, 0.45, 1.85));
    observations += count;
  }
  betas.sort((a, b) => a - b);
  return { betas, observations };
}

function macroPath(random, macro, stress) {
  const regimeDraw = random();
  const regime = regimeDraw < 0.16 ? "Recession" : regimeDraw < 0.41 ? "Slowdown" : "Expansion";
  const intensity = ({ Recession: 1.15, Slowdown: 0.48, Expansion: 0 })[regime] * stress;
  const magnitude = 0.75 + 0.5 * random();
  const path = [];
  let unemployment = macro.unemployment;
  let mortgageRate = macro.mortgageRate;
  let houseIndex = 1;
  let unemploymentPeak = unemployment;
  for (let quarter = 0; quarter < QUARTERS; quarter++) {
    const shock = gaussian(random);
    const vector = macro.innovations.length >= 20
      ? macro.innovations[Math.floor(random() * macro.innovations.length)]
      : [0.38 * shock, 0.0029 * gaussian(random), 0.011 * gaussian(random) - 0.006 * shock];
    const pulse = quarter < 8 ? 1 : Math.max(0, (15 - quarter) / 7);
    unemployment = clamp(unemployment + 0.15 * (macro.unemployment - unemployment) +
      0.56 * vector[0] + 0.62 * intensity * magnitude * pulse, 2.4, 15);
    mortgageRate = clamp(mortgageRate + 0.19 * (macro.mortgageRate - mortgageRate) +
      0.79 * vector[1] - 0.0013 * intensity * pulse, 0.018, 0.12);
    const houseGrowth = 0.008 + 0.75 * vector[2] - 0.020 * intensity * magnitude * pulse -
      0.0014 * Math.max(0, unemployment - macro.unemployment);
    houseIndex *= Math.exp(clamp(houseGrowth, -0.16, 0.12));
    unemploymentPeak = Math.max(unemploymentPeak, unemployment);
    path.push({ unemployment, mortgageRate, houseIndex, unemploymentBase: macro.unemployment });
  }
  return { path, regime, housePriceChange: houseIndex - 1, unemploymentPeak };
}

function notesForDeal(deal) {
  const cuts = [0, ...deal.cuts, 1];
  const names = ["Retained first loss", ...trancheNames, "Senior residual"];
  return names.map((name, i) => {
    const initialPrincipal = (cuts[i + 1] - cuts[i]) * deal.principal;
    return {
      id: `${deal.id}-${name}`, name, vintage: deal.vintage, initialPrincipal,
      attachment: cuts[i], detachment: cuts[i + 1],
      balance: initialPrincipal, loss: 0, returnedPrincipal: 0, income: 0,
      coupon: deal.coupons[i - 1] ?? 0,
    };
  });
}

// Principal amortizes from senior to junior. Credit losses absorb from junior to senior.
function distribute(notes, losses, principal) {
  for (const note of notes) {
    const absorbed = Math.min(note.balance, losses);
    note.loss += absorbed;
    note.balance -= absorbed;
    losses -= absorbed;
  }
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    const returned = Math.min(note.balance, principal);
    note.returnedPrincipal += returned;
    note.balance -= returned;
    principal -= returned;
  }
  return Math.abs(losses) + Math.abs(principal);
}

function projectDeal(deal, path, localRisk, recordNoteLosses = false) {
  const cohorts = deal.collateral.map(([share, ltv, hazard]) =>
    ({ balance: deal.principal * share, ltv, hazard }));
  const notes = notesForDeal(deal);
  const timeline = [];
  let maxUnallocated = 0, poolLoss = 0, poolDefault = 0, poolPrepay = 0;
  let poolPrincipal = 0;
  for (const [quarter, state] of path.entries()) {
    let losses = 0, principal = 0;
    for (const cohort of cohorts) {
      const scheduled = cohort.balance * 0.006;
      const atRisk = cohort.balance - scheduled;
      const houseIndex = state.houseIndex ** localRisk;
      const ltv = cohort.ltv * 0.994 ** quarter / houseIndex;
      const defaultRate = clamp(cohort.hazard * Math.exp(
        0.39 * (state.unemployment - state.unemploymentBase) +
        2.8 * Math.max(0, ltv - 0.8) +
        1.6 * Math.max(0, 1 - houseIndex),
      ), 0, 0.8);
      const refi = 1 / (1 + Math.exp(-(deal.loanRate - state.mortgageRate - 0.005) / 0.009));
      const prepayRate = 0.037 + 0.23 * refi * Math.exp(-0.021 * quarter);
      const exits = atRisk * -Math.expm1(-(defaultRate + prepayRate) / 4);
      const defaults = exits * defaultRate / (defaultRate + prepayRate);
      const prepays = exits - defaults;
      const severity = clamp(0.035 + Math.max(0, 1 - 0.78 / ltv) +
        0.11 * Math.max(0, 1 - houseIndex), 0.035, 0.72);
      const loss = defaults * severity;
      losses += loss;
      principal += scheduled + prepays + defaults - loss;
      poolDefault += defaults;
      poolPrepay += prepays;
      cohort.balance = atRisk - exits;
    }
    const opening = notes.map((note) => note.balance);
    maxUnallocated = Math.max(maxUnallocated, distribute(notes, losses, principal));
    for (const [i, note] of notes.entries()) {
      note.income += note.coupon * (opening[i] + note.balance) / 8;
    }
    poolLoss += losses;
    poolPrincipal += principal;
    const point = { poolLoss, poolDefault, poolPrepay };
    if (recordNoteLosses) point.noteLosses = notes.slice(1, -1).map((note) => note.loss / note.initialPrincipal);
    timeline.push(point);
  }
  const outstanding = cohorts.reduce((sum, cohort) => sum + cohort.balance, 0);
  const lossMismatch = Math.abs(poolLoss - notes.reduce((sum, note) => sum + note.loss, 0));
  const balanceMismatch = Math.abs(outstanding - notes.reduce((sum, note) => sum + note.balance, 0));
  const principalMismatch = Math.abs(poolPrincipal - notes.reduce((sum, note) => sum + note.returnedPrincipal, 0));
  const identityMismatch = Math.abs(deal.principal - poolLoss - poolPrincipal - outstanding);
  return {
    notes, timeline, poolLoss,
    reconciliation: Math.max(maxUnallocated, lossMismatch, balanceMismatch, principalMismatch, identityMismatch),
  };
}

function generateScenario(random, macro, regional, stress, index, record) {
  const factors = macroPath(random, macro, stress);
  const pools = deals.map((deal) => {
    const beta = regional.betas.length
      ? regional.betas[Math.floor(random() * regional.betas.length)]
      : clamp(1 + 0.14 * gaussian(random), 0.72, 1.38);
    return projectDeal(deal, factors.path, beta);
  });
  const notes = pools.flatMap((pool) => pool.notes.slice(1, -1));
  return {
    id: index + 1,
    losses: notes.map((note) => note.loss / note.initialPrincipal),
    carries: notes.map((note) => note.income / note.initialPrincipal / (QUARTERS / 4)),
    regime: factors.regime,
    housePriceChange: factors.housePriceChange,
    unemploymentPeak: factors.unemploymentPeak,
    poolLoss: pools.reduce((sum, pool) => sum + pool.poolLoss, 0),
    reconciliation: Math.max(...pools.map((pool) => pool.reconciliation)),
    pools: record ? pools : null,
  };
}

function meansFor(scenarios, key) {
  const means = new Float64Array(assetCount);
  for (const scenario of scenarios) {
    for (let i = 0; i < assetCount; i++) means[i] += scenario[key][i];
  }
  return means.map((value) => value / scenarios.length);
}

function weightedSum(values, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += values[i] * weights[i];
  return total;
}

function tailMetrics(losses, confidence) {
  losses.sort();
  const count = losses.length;
  const mass = count * (1 - confidence);
  const integral = Math.floor(mass);
  let tail = 0;
  for (let i = count - integral; i < count; i++) tail += losses[i];
  if (mass > integral) tail += (mass - integral) * losses[count - integral - 1];
  return { var: losses[Math.max(0, Math.ceil(count * confidence) - 1)], cvar: tail / mass };
}

function groups(weights) {
  const allocations = [0, 0, 0];
  for (let i = 0; i < assetCount; i++) allocations[assets[i].dealIndex] += weights[i];
  return allocations;
}

function positionCap(i, config) {
  return Math.min(config.concentration, assets[i].issuePrincipal / config.portfolioSize);
}

function meetsConstraints(weights, expectedCarry, config) {
  return expectedCarry + EPSILON >= config.carryFloor &&
    Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < EPSILON &&
    weights.every((value, i) => value >= -EPSILON && value <= positionCap(i, config) + EPSILON) &&
    groups(weights).every((value) => value <= config.vintageCap + EPSILON);
}

function maxCarryAllocation(carries, config) {
  const weights = Array(assetCount).fill(0);
  const vintage = groups(weights);
  const order = Array.from({ length: assetCount }, (_, i) => i).sort((a, b) => carries[b] - carries[a]);
  let remaining = 1;
  for (const i of order) {
    const group = assets[i].dealIndex;
    const amount = Math.min(remaining, positionCap(i, config), config.vintageCap - vintage[group]);
    weights[i] = Math.max(0, amount);
    vintage[group] += weights[i];
    remaining -= weights[i];
  }
  return weights;
}

function measure(scenarios, weights, carries, config) {
  const losses = Float64Array.from(scenarios, (scenario) => weightedSum(scenario.losses, weights));
  const expectedLoss = losses.reduce((sum, value) => sum + value, 0) / scenarios.length;
  const expectedCarry = weightedSum(carries, weights);
  const tail = tailMetrics(losses, config.confidence);
  return {
    weights: [...weights],
    expectedCarry, expectedLoss, ...tail,
    lossDollars: expectedLoss * config.portfolioSize,
    cvarDollars: tail.cvar * config.portfolioSize,
    carryDollars: expectedCarry * config.portfolioSize,
    maxPosition: Math.max(...weights),
    vintageWeights: groups(weights),
    feasible: meetsConstraints(weights, expectedCarry, config),
  };
}

function optimize(scenarios, baseline, carries, config) {
  const maximum = maxCarryAllocation(carries, config);
  const maxCarry = weightedSum(carries, maximum);
  if (!meetsConstraints(maximum, maxCarry, config)) {
    return { weights: maximum, candidates: 0, maxCarry, status: "carry-floor-infeasible" };
  }
  const weights = meetsConstraints(baseline, weightedSum(carries, baseline), config)
    ? [...baseline] : maximum;
  const loss = Float64Array.from(scenarios, (scenario) => weightedSum(scenario.losses, weights));
  const scratch = new Float64Array(scenarios.length);
  scratch.set(loss);
  let best = tailMetrics(scratch, config.confidence).cvar;
  let currentCarry = weightedSum(carries, weights);
  let candidates = 0;

  for (const step of [0.12, 0.06, 0.03, 0.015, 0.006, 0.002]) {
    for (let sweep = 0; sweep < 12; sweep++) {
      const vintage = groups(weights);
      let move = null;
      for (let from = 0; from < assetCount; from++) {
        if (weights[from] < step - EPSILON) continue;
        for (let to = 0; to < assetCount; to++) {
          if (from === to || weights[to] + step > positionCap(to, config) + EPSILON) continue;
          const group = assets[to].dealIndex;
          if (assets[from].dealIndex !== group && vintage[group] + step > config.vintageCap + EPSILON) continue;
          const carry = currentCarry + step * (carries[to] - carries[from]);
          if (carry + EPSILON < config.carryFloor) continue;
          for (const [index, scenario] of scenarios.entries()) {
            scratch[index] = loss[index] + step * (scenario.losses[to] - scenario.losses[from]);
          }
          const cvar = tailMetrics(scratch, config.confidence).cvar;
          candidates++;
          if (cvar < (move?.cvar ?? best) - EPSILON) move = { from, to, carry, cvar };
        }
      }
      if (!move) break;
      const { from, to, carry, cvar } = move;
      weights[from] -= step;
      weights[to] += step;
      currentCarry = carry;
      best = cvar;
      for (const [index, scenario] of scenarios.entries()) {
        loss[index] += step * (scenario.losses[to] - scenario.losses[from]);
      }
    }
  }
  return { weights, candidates, maxCarry, status: "optimized" };
}

export function runStudy(options = {}) {
  const config = parameters(options);
  const macro = calibrateMacro(options.macroHistory);
  const regional = calibrateRegional(options.metroHistory, macro.nationalQuarters);
  const random = randomSource(config.seed);
  const split = Math.floor(0.65 * config.scenarios);
  const all = Array.from({ length: config.scenarios }, (_, i) =>
    generateScenario(random, macro, regional, config.stress, i, i >= split));
  const train = all.slice(0, split), holdout = all.slice(split);
  const equal = Array(assetCount).fill(1 / assetCount);
  const trainCarry = meansFor(train, "carries");
  const holdoutCarry = meansFor(holdout, "carries");
  const holdoutLoss = meansFor(holdout, "losses");
  const allocation = optimize(train, equal, trainCarry, config);
  const trainingBaseline = measure(train, equal, trainCarry, config);
  const matchedFloor = Math.max(config.carryFloor, trainingBaseline.expectedCarry);
  const matchedConfig = { ...config, carryFloor: matchedFloor };
  const matchedAllocation = matchedFloor === config.carryFloor ? allocation : optimize(train, equal, trainCarry, matchedConfig);
  const baseline = measure(holdout, equal, holdoutCarry, config);
  const optimized = measure(holdout, allocation.weights, holdoutCarry, config);
  const carryMatched = measure(holdout, matchedAllocation.weights, holdoutCarry, matchedConfig);
  const ranked = [...holdout].sort((a, b) => a.poolLoss - b.poolLoss);
  const example = ranked[Math.min(ranked.length - 1, Math.ceil(config.confidence * ranked.length) - 1)];
  const timeline = Array.from({ length: QUARTERS }, (_, quarter) => {
    let loss = 0, defaults = 0, prepays = 0;
    for (const scenario of holdout) {
      for (const pool of scenario.pools) {
        loss += pool.timeline[quarter].poolLoss;
        defaults += pool.timeline[quarter].poolDefault;
        prepays += pool.timeline[quarter].poolPrepay;
      }
    }
    const denominator = totalPool * holdout.length;
    return {
      quarter: quarter + 1,
      meanPoolLoss: loss / denominator,
      meanDefault: defaults / denominator,
      meanPrepay: prepays / denominator,
    };
  });
  return {
    config,
    assets: assets.map((asset, i) => ({
      ...asset, meanLoss: holdoutLoss[i], meanCarry: holdoutCarry[i], positionCap: positionCap(i, config),
      baselineDollars: config.portfolioSize * baseline.weights[i],
      optimizedDollars: config.portfolioSize * optimized.weights[i],
    })),
    baseline, optimized, carryMatched,
    paths: holdout.map((scenario) => ({
      id: scenario.id, regime: scenario.regime, housePriceChange: scenario.housePriceChange,
      unemploymentPeak: scenario.unemploymentPeak, poolLoss: scenario.poolLoss / totalPool,
      trancheLosses: scenario.losses,
      baselineLoss: weightedSum(scenario.losses, baseline.weights),
      optimizedLoss: weightedSum(scenario.losses, optimized.weights),
    })),
    timeline,
    waterfall: example.pools.flatMap((pool) => pool.notes),
    diagnostics: {
      status: allocation.status,
      method: "Deterministic pairwise allocation search on training scenarios",
      candidates: allocation.candidates,
      trainingScenarios: train.length,
      holdoutScenarios: holdout.length,
      holdoutTailMass: holdout.length * (1 - config.confidence),
      trainingBaseline,
      trainingOptimized: measure(train, allocation.weights, trainCarry, config),
      carryMatchedStatus: matchedAllocation.status,
      carryMatchedTrainingFloor: matchedFloor,
      carryMatchedTraining: measure(train, matchedAllocation.weights, trainCarry, matchedConfig),
      maxTrainingCarry: allocation.maxCarry,
      historicalMonths: macro.months,
      historicalQuarterlyChanges: macro.innovations.length,
      historicalThrough: macro.lastMonth,
      macroMethod: macro.innovations.length >= 20 ? "Joint historical quarterly changes plus modeled regimes" : "Parametric shocks plus modeled regimes",
      historicalCoverage: macro.historicalCoverage,
      regionalMetroCount: regional.betas.length,
      regionalObservations: regional.observations,
      regionalBetaP10: regional.betas.length ? percentile(regional.betas, 0.1) : null,
      regionalBetaP90: regional.betas.length ? percentile(regional.betas, 0.9) : null,
      waterfallScenarioId: example.id,
      waterfallPoolLoss: example.poolLoss,
      maxReconciliationDollars: all.reduce((maximum, scenario) => Math.max(maximum, scenario.reconciliation), 0),
      cvarSavings: baseline.cvarDollars - optimized.cvarDollars,
    },
  };
}

function replayWindow(window, monthly, portfolios) {
  const start = monthNumber(window.start), end = monthNumber(window.end);
  const base = monthly.get(start);
  const months = Array.from({ length: end - start }, (_, i) => monthly.get(start + i + 1));
  if (!base || months.some((row) => !row)) return { ...window, status: "missing-months" };

  const path = [];
  for (let i = 0; i < months.length; i += 3) {
    const [first, second, third] = months.slice(i, i + 3);
    const unemployment = (first.unemploymentPct + second.unemploymentPct + third.unemploymentPct) / 3;
    const mortgageRate = (first.mortgageRatePct + second.mortgageRatePct + third.mortgageRatePct) / 300;
    path.push({
      month: third.month, unemployment, mortgageRate,
      houseIndex: third.housePriceIndex / base.housePriceIndex,
      unemploymentBase: base.unemploymentPct,
    });
  }

  const pools = deals.map((deal) => projectDeal(deal, path, 1, true));
  const timeline = path.map((point, i) => {
    const losses = pools.flatMap((pool) => pool.timeline[i].noteLosses);
    return {
      month: point.month,
      quarter: i + 1,
      housePriceChange: point.houseIndex - 1,
      unemploymentPct: point.unemployment,
      mortgageRatePct: point.mortgageRate * 100,
      baselineLoss: weightedSum(losses, portfolios.baseline),
      optimizedLoss: weightedSum(losses, portfolios.optimized),
      carryMatchedLoss: weightedSum(losses, portfolios.carryMatched),
      poolLoss: pools.reduce((sum, pool) => sum + pool.timeline[i].poolLoss, 0) / totalPool,
    };
  });
  const carries = pools.flatMap((pool) => pool.notes.slice(1, -1)
    .map((note) => note.income / note.initialPrincipal / (path.length / 4)));
  const last = timeline.at(-1);
  return {
    ...window,
    status: "replayed",
    quarters: path.length,
    baselineLoss: last.baselineLoss,
    optimizedLoss: last.optimizedLoss,
    carryMatchedLoss: last.carryMatchedLoss,
    baselineCarry: weightedSum(carries, portfolios.baseline),
    optimizedCarry: weightedSum(carries, portfolios.optimized),
    carryMatchedCarry: weightedSum(carries, portfolios.carryMatched),
    poolLoss: last.poolLoss,
    housePriceChange: last.housePriceChange,
    unemploymentPeak: Math.max(base.unemploymentPct, ...months.map((row) => row.unemploymentPct)),
    mortgageRateEnd: months.at(-1).mortgageRatePct,
    timeline,
    maxReconciliationDollars: Math.max(...pools.map((pool) => pool.reconciliation)),
  };
}

function fixedPortfolios(study) {
  return Object.fromEntries(["baseline", "optimized", "carryMatched"].map((name) => {
    const weights = study[name]?.weights;
    if (!Array.isArray(weights) || weights.length !== assetCount ||
      weights.some((value) => !Number.isFinite(value) || value < -EPSILON) ||
      Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > EPSILON) {
      throw new RangeError(`A fully invested ${name} allocation is required for the audit.`);
    }
    return [name, [...weights]];
  }));
}

export function runRiskAudit(options = {}, study = null) {
  const fitted = study ?? runStudy(options);
  const config = parameters({ ...options, ...fitted.config });
  const portfolios = fixedPortfolios(fitted);
  const macro = calibrateMacro(options.macroHistory);
  const regional = calibrateRegional(options.metroHistory, macro.nationalQuarters);
  const historical = REPLAY_WINDOWS.map((window) => replayWindow(window, macro.monthly, portfolios));
  const scenarioCount = Math.round(bounded(options.auditScenarios, 800, 200, 3000));
  const matchedFloor = fitted.diagnostics?.carryMatchedTrainingFloor ?? config.carryFloor;
  const matchedConfig = { ...config, carryFloor: matchedFloor };

  const runs = AUDIT_SEEDS.map((offset) => {
    const seed = (config.seed + offset) >>> 0;
    const random = randomSource(seed);
    const paths = Array.from({ length: scenarioCount }, (_, i) =>
      generateScenario(random, macro, regional, config.stress, i, false));
    const carries = meansFor(paths, "carries");
    const baseline = measure(paths, portfolios.baseline, carries, config);
    const optimized = measure(paths, portfolios.optimized, carries, config);
    const carryMatched = measure(paths, portfolios.carryMatched, carries, matchedConfig);
    return {
      seed, scenarios: paths.length, baseline, optimized, carryMatched,
      cvarDelta: baseline.cvar - optimized.cvar,
      cvarDeltaDollars: baseline.cvarDollars - optimized.cvarDollars,
      matchedCvarDelta: baseline.cvar - carryMatched.cvar,
      matchedCvarDeltaDollars: baseline.cvarDollars - carryMatched.cvarDollars,
      matchedCarryGapBps: (carryMatched.expectedCarry - baseline.expectedCarry) * 10_000,
    };
  });
  const deltas = runs.map((run) => run.cvarDeltaDollars).sort((a, b) => a - b);
  const matchedDeltas = runs.map((run) => run.matchedCvarDeltaDollars).sort((a, b) => a - b);
  return {
    config,
    historical,
    robustness: {
      runs, scenarioCount,
      totalScenarios: runs.length * scenarioCount,
      optimizedWins: runs.filter((run) => run.cvarDelta > EPSILON).length,
      matchedWins: runs.filter((run) => run.matchedCvarDelta > EPSILON).length,
      optimizedFeasibleRuns: runs.filter((run) => run.optimized.feasible).length,
      matchedFeasibleRuns: runs.filter((run) => run.carryMatched.feasible).length,
      deltaRangeDollars: [deltas[0], deltas.at(-1)],
      matchedDeltaRangeDollars: [matchedDeltas[0], matchedDeltas.at(-1)],
      medianDeltaDollars: percentile(deltas, 0.5),
      medianMatchedDeltaDollars: percentile(matchedDeltas, 0.5),
    },
    diagnostics: {
      historicalMethod: "Observed quarterly average mortgage rates and unemployment with quarter-end national house prices",
      historicalScope: "Representative pools are exposed to the observed national path with no modeled regime overlay or refit",
      robustnessMethod: "Five predetermined seeds resample the same model inputs with all fitted portfolio weights held fixed",
      carryMatchedTrainingFloor: matchedFloor,
      studyStatus: fitted.diagnostics?.status ?? null,
    },
  };
}
