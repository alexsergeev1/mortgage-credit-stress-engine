const $ = (id) => document.getElementById(id);
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-US");
const pct = (value, decimals = 2) => Number.isFinite(value) ? (100 * value).toFixed(decimals) + "%" : "—";
const money = (value) => Number.isFinite(value) ? usd.format(value) : "—";
const colors = { base: "#f5bd8c", selected: "#a9e8ce", third: "#a5baf8", grid: "#30434e", text: "#a8bac2" };
let study, rankedPaths = [], macro, worker, metros;

function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function row(values) {
  const tr = document.createElement("tr");
  for (const [i, value] of values.entries()) tr.append(cell(value, i === values.length - 1 ? "action" : ""));
  return tr;
}

function kpi(label, value, reference) {
  const panel = document.createElement("div");
  panel.className = "panel kpi";
  for (const [tag, text] of [["span", label], ["strong", value], ["small", reference]]) {
    const item = document.createElement(tag);
    item.textContent = text;
    panel.append(item);
  }
  return panel;
}

function seriesChart(canvas, series, xLabel, cursor) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (width < 90) return;
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const left = 51, right = width - 13, top = 12, bottom = height - 24;
  const seriesLength = Math.max(...series.map((line) => line.values.length));
  const maximum = Math.min(1, Math.max(0.01, ...series.flatMap((line) => line.values)) * 1.09);
  const x = (index) => left + index / Math.max(1, seriesLength - 1) * (right - left);
  const y = (value) => bottom - value / maximum * (bottom - top);
  ctx.font = "10px Consolas, monospace";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const value = maximum * i / 4;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillStyle = colors.text;
    ctx.fillText(pct(value, 0), left - 6, y(value) + 3);
  }
  for (const line of series) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [i, value] of line.values.entries()) {
      if (i === 0) ctx.moveTo(x(i), y(value));
      else ctx.lineTo(x(i), y(value));
    }
    ctx.stroke();
  }
  if (Number.isInteger(cursor)) {
    ctx.strokeStyle = "#eaf2f4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(cursor), top);
    ctx.lineTo(x(cursor), bottom);
    ctx.stroke();
  }
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.fillText(xLabel[0], left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(xLabel[1], right, height - 8);
}

function showPath() {
  if (!rankedPaths.length) return;
  const i = Number($("path").value);
  const p = rankedPaths[i];
  $("path-label").textContent = `Rank ${i + 1} of ${count.format(rankedPaths.length)}`;
  $("path-detail").replaceChildren(...[
    ["Baseline loss", pct(p.baselineLoss)],
    ["Optimized loss", pct(p.optimizedLoss)],
    ["House-price change", pct(p.housePriceChange)],
    ["Peak unemployment", pct(p.unemploymentPeak / 100)],
  ].map(([label, value]) => {
    const div = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = value;
    div.append(label, strong);
    return div;
  }));
  seriesChart($("risk-chart"), [
    { color: colors.base, values: rankedPaths.map((path) => path.baselineLoss) },
    { color: colors.selected, values: rankedPaths.map((path) => path.optimizedLoss) },
  ], ["Lowest baseline loss", "Highest baseline loss"], i);
}

function showTimeline() {
  if (!study) return;
  seriesChart($("timeline"), [
    { color: colors.base, values: study.timeline.map((point) => point.meanDefault) },
    { color: colors.selected, values: study.timeline.map((point) => point.meanPrepay) },
    { color: colors.third, values: study.timeline.map((point) => point.meanPoolLoss) },
  ], ["Quarter 1", "Quarter " + study.timeline.at(-1).quarter]);
}

function showStudy(result) {
  study = result;
  const { baseline, optimized, config, assets } = study;
  const delta = baseline.cvarDollars - optimized.cvarDollars;
  $("kpis").replaceChildren(
    kpi("Optimized tail loss", money(optimized.cvarDollars), "Baseline " + money(baseline.cvarDollars)),
    kpi("Tail loss reduction", money(delta), "Mean loss in worst 5% of paths"),
    kpi("Expected credit loss", money(optimized.lossDollars), "Baseline " + money(baseline.lossDollars)),
    kpi("Annual spread carry", pct(optimized.expectedCarry), "Floor " + pct(config.carryFloor)),
  );
  const matched = study.carryMatched;
  $("decision-note").textContent = optimized.feasible
    ? `At the baseline carry target, modeled tail loss is ${money(matched.cvarDollars)} versus ${money(baseline.cvarDollars)} for equal weights. The trades below use your selected carry floor.`
    : "The selected limits did not produce a feasible holdout result. Treat the displayed weights as a diagnostic.";
  $("allocations").replaceChildren(...assets.map((asset, i) => {
    const trade = (optimized.weights[i] - baseline.weights[i]) * config.portfolioSize;
    return row([asset.label ?? asset.id, `${pct(asset.attachment)}–${pct(asset.detachment)}`, pct(asset.coupon), money(asset.issuePrincipal),
      pct(baseline.weights[i], 1), pct(optimized.weights[i], 1),
      Math.abs(trade) < 1 ? "Hold" : `${trade > 0 ? "Add" : "Cut"} ${money(Math.abs(trade))}`]);
  }));
  $("waterfall").replaceChildren(...study.waterfall.map((layer) =>
    row([layer.id, money(layer.initialPrincipal), money(layer.loss), money(layer.returnedPrincipal), money(layer.balance)])));
  rankedPaths = [...study.paths].sort((a, b) => a.baselineLoss - b.baselineLoss);
  $("path").max = rankedPaths.length - 1;
  $("path").value = Math.floor((rankedPaths.length - 1) * 0.97);
  $("path").disabled = rankedPaths.length < 2;
  $("export").disabled = false;
  showPath();
  showTimeline();
  const d = study.diagnostics;
  $("waterfall-note").textContent = `Path ${d.waterfallScenarioId}, near the 95th percentile of aggregate pool credit loss.`;
  $("status").textContent = `${count.format(rankedPaths.length)} holdout paths. Calibrated with ${count.format(macro.rows.length)} national months and ${count.format(d.regionalObservations)} overlapping metro-quarter changes.`;
  const coverage = d.historicalCoverage;
  const calibration = coverage ? ` Historical interval coverage on ${coverage.holdoutCount} later quarterly changes ranged from ${pct(Math.min(...coverage.variables.map((x) => x.observedCoverage)), 0)} to ${pct(Math.max(...coverage.variables.map((x) => x.observedCoverage)), 0)} for a nominal ${pct(coverage.centralInterval, 0)} interval.` : "";
  $("audit").textContent = `${count.format(d.trainingScenarios)} training paths, ${count.format(d.holdoutScenarios)} holdout paths, ${count.format(d.candidates)} allocation candidates evaluated. Waterfall reconciliation differed by at most ${money(d.maxReconciliationDollars)}. ${d.macroMethod}.${calibration}`;
}

function evidenceCard(title, description, href, linkLabel) {
  const card = document.createElement("article");
  card.className = "evidence-card";
  const h = document.createElement("h3");
  const p = document.createElement("p");
  h.textContent = title;
  p.textContent = description;
  card.append(h, p);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = linkLabel;
    card.append(link);
  }
  return card;
}

function showEvidence() {
  const months = `${macro.rows[0].month} to ${macro.rows.at(-1).month}`;
  $("sources").replaceChildren(
    ...macro.sources.map((source) => evidenceCard(source.label ?? source.series, months, source.url, "Source series ↗")),
    evidenceCard("Public reference deal", "Fannie Mae CAS 2025-R01. Published terms are included for comparison with the representative portfolio.", "./data/cas-2025-r01.json", "Inspect deal terms ↗"),
    evidenceCard("Modeled loan behavior", "Default, prepayment, severity, prices and positions are research assumptions. Holdout paths test the policy in simulation."),
    evidenceCard("Audit record", "The JSON export includes scenario losses, allocation, training and holdout diagnostics, and the model settings.", "./DATA.md", "Read data notes ↗"),
  );
}

async function dataFile(name) {
  const response = await fetch(new URL("./data/" + name, import.meta.url));
  if (!response.ok) throw new Error("Could not load " + name + ".");
  return response.json();
}

function showMetro() {
  const entry = metros.metros[Number($("metro").value)];
  $("metro-readout").textContent = `${count.format(Object.keys(entry.index).length)} quarterly observations. Worst year-over-year move ${entry.worstYoYPct?.toFixed(1) ?? "—"}% in ${entry.worstPeriod ?? "—"}. Latest year-over-year move ${entry.latestYoYPct?.toFixed(1) ?? "—"}%. Coverage ${count.format(metros.observations)} metro-quarter observations.`;
}

function loadEvidence() {
  $("metro").replaceChildren(...metros.metros.map((metro, index) => new Option(metro.name, index)));
  const defaultIndex = metros.metros.findIndex((metro) => metro.name.startsWith("Phoenix"));
  $("metro").value = String(Math.max(0, defaultIndex));
  $("metro").disabled = false;
  showMetro();
  dataFile("cas-2025-r01.json").then((deal) => {
    $("deal-summary").textContent = `${money(deal.referencePoolBalanceUsd)} reference balance and ${count.format(deal.referenceLoanCount)} disclosed mortgages. The study uses representative structures.`;
    $("deal-classes").replaceChildren(...deal.offeredClasses.map((note) =>
      row([note.class, money(note.initialPrincipalUsd), "+" + note.sofrSpreadBps + " bp"])));
  }).catch((error) => { $("deal-summary").textContent = error.message; });
}

function run() {
  if (!macro || !$("study").reportValidity()) return;
  $("run").disabled = true;
  $("status").textContent = "Simulating and optimizing…";
  worker.postMessage({
    stress: Number($("stress").value),
    portfolioSize: Number($("size").value) * 1e6,
    carryFloor: Number($("carry").value) / 100,
    concentration: Number($("cap").value) / 100,
    scenarios: Number($("paths").value),
    macroHistory: macro.rows,
    metroHistory: metros.metros,
  });
}

$("study").addEventListener("submit", (event) => { event.preventDefault(); run(); });
$("stress").addEventListener("input", () => { $("stress-value").textContent = Number($("stress").value).toFixed(1) + "×"; });
$("path").addEventListener("input", showPath);
$("metro").addEventListener("change", showMetro);
window.addEventListener("resize", () => { showPath(); showTimeline(); });
$("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ provenance: macro.sources, study }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "mortgage-credit-study.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    $("run").disabled = false;
    if (data.error) {
      $("status").textContent = data.error;
      return;
    }
    showStudy(data.study);
  });
  worker.addEventListener("error", () => {
    $("run").disabled = false;
    $("status").textContent = "The simulation worker could not start. Reload the page to retry.";
  });
  [macro, metros] = await Promise.all([dataFile("macro.json"), dataFile("metro-hpi.json")]);
  showEvidence();
  loadEvidence();
  run();
} catch (error) {
  $("status").textContent = error.message;
}
