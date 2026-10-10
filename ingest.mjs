import { mkdir, writeFile } from "node:fs/promises";

const start = "1991-01-01";
const end = "2025-12-31";
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
  url.search = new URLSearchParams({ id: source.series, cosd: start, coed: end });
  const [header, ...lines] = (await getText(url)).trim().split(/\r?\n/);
  if (!header.endsWith("," + source.series)) throw new Error("Unexpected FRED header: " + header);
  const monthly = new Map();
  for (const line of lines) {
    const [date, rawValue] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start || date > end || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const month = date.slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, []);
    monthly.get(month).push(value);
  }
  return {
    monthly,
    observations: [...monthly.values()].reduce((sum, values) => sum + values.length, 0),
    downloadUrl: url.href,
  };
}

function toMetroData(csv) {
  const places = new Map();
  let observations = 0;
  for (const line of csv.split(/\r?\n/)) {
    // Published layout: quoted place, CBSA code, year, quarter, index, standard error.
    const match = /^"((?:[^"]|"")*)",(\d{5}),(\d{4}),([1-4]),([\d.]+),/.exec(line);
    if (!match) continue;
    const [, rawName, code, year, quarter, rawIndex] = match;
    const value = Number(rawIndex);
    if (year < "1991" || year > "2025" || !Number.isFinite(value) || value <= 0) continue;
    const period = year + "Q" + quarter;
    if (!places.has(code)) places.set(code, { code, name: rawName.replaceAll('""', '"'), index: {} });
    const place = places.get(code);
    if (period in place.index) throw new Error(`Duplicate FHFA period for ${code}: ${period}`);
    place.index[period] = value;
    observations++;
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
  return { source: metroUrl, observations, metros };
}

const [downloads, metroCsv] = await Promise.all([Promise.all(series.map(fetchSeries)), getText(metroUrl)]);
const referenceMonths = [...downloads[2].monthly.keys()].sort();
const rows = referenceMonths.flatMap((month) => {
  const values = downloads.map(({ monthly }) => monthly.get(month));
  if (values.some((samples) => !samples?.length)) return [];
  const fields = Object.fromEntries(series.map((source, i) => [source.field, rounded(mean(values[i]))]));
  const comparisonMonth = (Number(month.slice(0, 4)) - 1) + month.slice(4);
  const comparison = downloads[2].monthly.get(comparisonMonth);
  return [{
    month,
    ...fields,
    hpiYoYPct: comparison ? rounded(100 * (fields.housePriceIndex / mean(comparison) - 1)) : null,
  }];
});
if (rows.length < 410 || rows.at(-1).month !== end.slice(0, 7)) {
  throw new Error("National macro history does not cover the intended period");
}
const sources = series.map((source, i) => ({
  ...source, observations: downloads[i].observations, downloadUrl: downloads[i].downloadUrl,
}));
const metro = toMetroData(metroCsv);
await mkdir(dataDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("macro.json", dataDirectory), JSON.stringify({ start, end, sources, rows }) + "\n"),
  writeFile(new URL("metro-hpi.json", dataDirectory), JSON.stringify(metro) + "\n"),
]);
console.log(`Joined ${rows.length} monthly observations from ${downloads.reduce((sum, item) => sum + item.observations, 0)} national observations; loaded ${metro.observations} quarterly observations across ${metro.metros.length} metro series.`);
