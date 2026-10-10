import { mkdir, readFile, writeFile } from "node:fs/promises";
import { alignedMonths, closedMonthEnd, closedQuarter, metroRows, monthlyValues, parseFredCsv } from "./source-data.mjs";

const start = "1991-01-01";
const asOf = new Date();
const monthEnd = closedMonthEnd(asOf);
const quarterEnd = closedQuarter(asOf);
const dataDirectory = new URL("./data/", import.meta.url);
const metroUrl = "https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv";
const series = [
  { series: "MORTGAGE30US", label: "Freddie Mac 30-year fixed mortgage rate (weekly)", field: "mortgageRatePct" },
  { series: "UNRATE", label: "BLS unemployment rate, seasonally adjusted", field: "unemploymentPct" },
  { series: "HPIPONM226S", label: "FHFA purchase-only U.S. HPI, seasonally adjusted", field: "housePriceIndex" },
].map((item) => ({ ...item, url: "https://fred.stlouisfed.org/series/" + item.series }));

async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return response.text();
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const rounded = (value) => Number(value.toFixed(4));

async function fetchSeries(source) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.search = new URLSearchParams({ id: source.series, cosd: start, coed: monthEnd });
  const monthly = monthlyValues(parseFredCsv(await getText(url), source.series), { start, end: monthEnd });
  return {
    monthly,
    observations: [...monthly.values()].reduce((sum, values) => sum + values.length, 0),
    latestCompleteMonth: [...monthly.keys()].sort().at(-1),
    downloadUrl: url.href,
  };
}

function toMetroData(csv) {
  const places = new Map();
  let observations = 0, latestQuarter = "";
  for (const { code, name, period, value } of metroRows(csv)) {
    if (period < "1991Q1" || period > quarterEnd) continue;
    if (!places.has(code)) places.set(code, { code, name, index: {} });
    const place = places.get(code);
    if (period in place.index) throw new Error(`Duplicate FHFA period for ${code}: ${period}`);
    place.index[period] = value;
    observations++;
    if (period > latestQuarter) latestQuarter = period;
  }
  if (places.size < 300 || observations < 40_000) throw new Error("FHFA metro coverage is incomplete");
  const metros = [...places.values()].map(({ code, name, index }) => {
    const periods = Object.keys(index).sort();
    const yoy = periods.flatMap((period) => {
      const previous = index[(Number(period.slice(0, 4)) - 1) + period.slice(4)];
      return previous ? [[period, rounded(100 * (index[period] / previous - 1))]] : [];
    });
    const worst = yoy.reduce((low, item) => item[1] < low[1] ? item : low, ["", Infinity]);
    return { code, name, index, latestYoYPct: yoy.at(-1)?.[1] ?? null, worstYoYPct: Number.isFinite(worst[1]) ? worst[1] : null, worstPeriod: worst[0] || null };
  }).sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { source: metroUrl, observations, latestQuarter, metros };
}

const [downloads, metroCsv] = await Promise.all([Promise.all(series.map(fetchSeries)), getText(metroUrl)]);
const rows = alignedMonths(downloads.map(({ monthly }) => monthly)).map((month) => {
  const values = downloads.map(({ monthly }) => monthly.get(month));
  const fields = Object.fromEntries(series.map((source, i) => [source.field, rounded(mean(values[i]))]));
  const comparisonMonth = (Number(month.slice(0, 4)) - 1) + month.slice(4);
  const comparison = downloads[2].monthly.get(comparisonMonth);
  return {
    month,
    ...fields,
    hpiYoYPct: comparison ? rounded(100 * (fields.housePriceIndex / mean(comparison) - 1)) : null,
  };
});
if (rows.length < 410) {
  throw new Error("National macro history does not cover the intended period");
}
const sources = series.map((source, i) => ({
  ...source, observations: downloads[i].observations, latestCompleteMonth: downloads[i].latestCompleteMonth,
  downloadUrl: downloads[i].downloadUrl,
}));
const metro = toMetroData(metroCsv);
const lastMonth = rows.at(-1).month;
const [year, month] = lastMonth.split("-").map(Number);
const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const readPrevious = async (name) => {
  try {
    return JSON.parse(await readFile(new URL(name, dataDirectory), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const [previousMacro, previousMetro] = await Promise.all([readPrevious("macro.json"), readPrevious("metro-hpi.json")]);
const previousQuarter = previousMetro?.latestQuarter ??
  previousMetro?.metros.flatMap(({ index }) => Object.keys(index)).sort().at(-1);
if (lastMonth < previousMacro?.rows.at(-1).month || metro.latestQuarter < previousQuarter) {
  throw new Error("Source data is older than the pinned snapshot. Existing files were preserved.");
}
await mkdir(dataDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("macro.json", dataDirectory), JSON.stringify({ start, end, sources, rows }) + "\n"),
  writeFile(new URL("metro-hpi.json", dataDirectory), JSON.stringify(metro) + "\n"),
]);
console.log(`Joined ${rows.length} monthly observations through ${lastMonth} from ${downloads.reduce((sum, item) => sum + item.observations, 0)} national observations. Loaded ${metro.observations} observations through ${metro.latestQuarter} across ${metro.metros.length} metro series.`);
