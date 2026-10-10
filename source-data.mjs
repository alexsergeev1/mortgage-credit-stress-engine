export function closedMonthEnd(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
}

export function closedQuarter(now = new Date()) {
  const quarterStart = Math.floor(now.getUTCMonth() / 3) * 3;
  const previous = new Date(Date.UTC(now.getUTCFullYear(), quarterStart, 0));
  return `${previous.getUTCFullYear()}Q${Math.floor(previous.getUTCMonth() / 3) + 1}`;
}

export function parseFredCsv(csv, series) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (!header.endsWith("," + series)) throw new Error("Unexpected FRED header for " + series);
  const rows = lines.flatMap((line) => {
    const match = /^(\d{4}-\d{2}-\d{2}),(-?\d+(?:\.\d+)?)$/.exec(line.trim());
    return match ? [{ date: match[1], value: Number(match[2]) }] : [];
  });
  if (!rows.length) throw new Error("No observations for " + series);
  return rows;
}

export function monthlyValues(rows, { start = "", end = "9999-12-31" } = {}) {
  const monthly = new Map();
  for (const { date, value } of rows) {
    if (date < start || date > end) continue;
    const month = date.slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, []);
    monthly.get(month).push(value);
  }
  return monthly;
}

export function alignedMonths(monthly) {
  if (monthly.some((input) => !input)) return null;
  if (monthly.length === 0) return [];
  return [...monthly[0].keys()]
    .filter((month) => monthly.every((input) => input.has(month))).sort();
}

export function* metroRows(csv) {
  for (const line of csv.split(/\r?\n/)) {
    const match = /^"((?:[^"]|"")*)",(\d{5}),(\d{4}),([1-4]),([\d.]+),/.exec(line);
    if (!match) continue;
    const [, rawName, code, year, quarter, rawIndex] = match;
    const value = Number(rawIndex);
    if (!Number.isFinite(value) || value <= 0) continue;
    yield { code, name: rawName.replaceAll('""', '"'), period: year + "Q" + quarter, value };
  }
}
