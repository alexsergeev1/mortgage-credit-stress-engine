import { readFile, writeFile } from "node:fs/promises";

const readSnapshot = async (filename) => JSON.parse(await readFile(new URL("./data/" + filename, import.meta.url), "utf8"));
const [macro, metro] = await Promise.all([readSnapshot("macro.json"), readSnapshot("metro-hpi.json")]);
const macroPeriod = macro.rows.at(-1).month;
const metroPeriod = [...new Set(metro.metros.flatMap(({ index }) => Object.keys(index)))].sort().at(-1);

async function requestText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.text();
}

async function latestFredDate(series) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.search = new URLSearchParams({ id: series, cosd: macroPeriod + "-01" });
  const csv = await requestText(url);
  if (!csv.split(/\r?\n/, 1)[0].endsWith("," + series)) throw new Error("Unexpected CSV header");
  const dates = [...csv.matchAll(/^(\d{4}-\d{2}-\d{2}),-?\d+(?:\.\d+)?\r?$/gm)].map((match) => match[1]);
  if (dates.length === 0) throw new Error("No observations");
  return dates.sort().at(-1);
}

async function latestMetroQuarter() {
  const csv = await requestText(metro.source);
  let latest = "";
  for (const [, year, quarter] of csv.matchAll(/^"[^\r\n]+",\d{5},(\d{4}),([1-4]),[\d.]+,/gm)) {
    const period = year + "Q" + quarter;
    if (period > latest) latest = period;
  }
  if (!latest) throw new Error("No indexed metro quarters");
  return latest;
}

async function sourceStatus(name, url, snapshot, readLatest, comparePeriod) {
  try {
    const latest = await readLatest();
    return { name, url, snapshot, latest, status: comparePeriod(latest) > snapshot ? "newer" : "current" };
  } catch (error) {
    console.warn(`${name}: ${error.message}`);
    return { name, url, snapshot, latest: null, status: "unavailable" };
  }
}

const fredNames = {
  MORTGAGE30US: "Freddie Mac 30-year mortgage rate",
  UNRATE: "BLS unemployment rate",
  HPIPONM226S: "FHFA national purchase-only HPI",
};
const sources = await Promise.all([
  ...macro.sources.map(({ series, label, url }) =>
    sourceStatus(fredNames[series] ?? label, url, macroPeriod, () => latestFredDate(series), (date) => date.slice(0, 7))),
  sourceStatus("FHFA metropolitan HPI", "https://www.fhfa.gov/data/hpi/datasets", metroPeriod, latestMetroQuarter, (quarter) => quarter),
]);
const output = JSON.stringify({ checkedAt: new Date().toISOString(), sources }, null, 2) + "\n";
if (process.argv[2]) await writeFile(process.argv[2], output);
process.stdout.write(output);
