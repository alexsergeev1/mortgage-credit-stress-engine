import { readFile, writeFile } from "node:fs/promises";
import { alignedMonths, closedMonthEnd, closedQuarter, metroRows, monthlyValues, parseFredCsv } from "./source-data.mjs";

const readSnapshot = async (filename) => JSON.parse(await readFile(new URL("./data/" + filename, import.meta.url), "utf8"));
const [macro, metro] = await Promise.all([readSnapshot("macro.json"), readSnapshot("metro-hpi.json")]);
const macroPeriod = macro.rows.at(-1).month;
const metroPeriod = metro.latestQuarter ?? metro.metros.flatMap(({ index }) => Object.keys(index)).sort().at(-1);
const checkedAt = new Date();
const monthEnd = closedMonthEnd(checkedAt);
const quarterEnd = closedQuarter(checkedAt);

async function requestText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.text();
}

async function fredDates(series) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.search = new URLSearchParams({ id: series, cosd: macroPeriod + "-01" });
  const rows = parseFredCsv(await requestText(url), series);
  return {
    latest: rows.map(({ date }) => date).sort().at(-1),
    monthly: monthlyValues(rows, { end: monthEnd }),
  };
}

async function latestMetroQuarter() {
  const csv = await requestText(metro.source);
  let latest = "";
  for (const { period } of metroRows(csv)) {
    if (period <= quarterEnd && period > latest) latest = period;
  }
  if (!latest) throw new Error("No indexed metro quarters");
  return latest;
}

function sourceStatus(name, url, snapshot, result, comparePeriod) {
  if (result.status === "rejected") {
    console.warn(`${name}: ${result.reason.message}`);
    return { name, url, snapshot, latest: null, status: "unavailable" };
  }
  const { latest, monthly } = result.value;
  const period = comparePeriod(latest);
  const status = period > snapshot ? "newer" : period === snapshot ? "current" : "behind";
  return { name, url, snapshot, latest, status, latestCompleteMonth: monthly && [...monthly.keys()].sort().at(-1) };
}

const fredNames = {
  MORTGAGE30US: "Freddie Mac 30-year mortgage rate",
  UNRATE: "BLS unemployment rate",
  HPIPONM226S: "FHFA national purchase-only HPI",
};
const results = await Promise.allSettled([
  ...macro.sources.map(({ series }) => fredDates(series)),
  latestMetroQuarter().then((latest) => ({ latest })),
]);
const nationalResults = results.slice(0, macro.sources.length);
const sources = macro.sources.map(({ series, label, url }, i) =>
  sourceStatus(fredNames[series] ?? label, url, macroPeriod, nationalResults[i], (date) => date.slice(0, 7)));
sources.push(sourceStatus("FHFA metropolitan HPI", "https://www.fhfa.gov/data/hpi/datasets", metroPeriod,
  results.at(-1), (quarter) => quarter));
const aligned = alignedMonths(nationalResults.map((result) => result.value?.monthly));
const output = JSON.stringify({
  checkedAt: checkedAt.toISOString(),
  snapshotMonth: macroPeriod,
  snapshotQuarter: metroPeriod,
  alignedMacroLatest: aligned?.at(-1) ?? null,
  sources,
}, null, 2) + "\n";
if (process.argv[2]) await writeFile(process.argv[2], output);
process.stdout.write(output);
