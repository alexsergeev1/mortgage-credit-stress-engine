import assert from "node:assert/strict";
import test from "node:test";
import { alignedMonths, closedMonthEnd, closedQuarter, metroRows, monthlyValues, parseFredCsv } from "./source-data.mjs";

test("excludes partial periods and aligns all numeric series", () => {
  const now = new Date("2026-11-10T22:00:00Z");
  const end = closedMonthEnd(now);
  assert.equal(end, "2026-10-31");
  assert.equal(closedQuarter(now), "2026Q3");
  assert.equal(closedMonthEnd(new Date("2026-01-05Z")), "2025-12-31");
  assert.equal(closedQuarter(new Date("2026-01-05Z")), "2025Q4");

  const rates = parseFredCsv("observation_date,rate\n2026-08-06,6.1\n2026-08-13,6.2\n2026-09-03,6.3\n2026-11-05,6.4", "rate");
  const jobs = parseFredCsv("observation_date,jobs\n2026-08-01,4.1\n2026-09-01,.\n2026-10-01,4.2", "jobs");
  const prices = parseFredCsv("observation_date,prices\n2026-08-01,444.61\n2026-09-01,445.2", "prices");
  const monthly = [rates, jobs, prices].map((rows) => monthlyValues(rows, { end }));
  assert.deepEqual(monthly[0].get("2026-08"), [6.1, 6.2]);
  assert.equal(monthly[0].has("2026-11"), false);
  assert.deepEqual(alignedMonths(monthly), ["2026-08"]);
  assert.equal(alignedMonths([monthly[0], null, monthly[2]]), null);
});

test("rejects unpublished metro index values and unrecognized FRED data", () => {
  const csv = 'place,code,year,quarter,index,error\n"Some ""quoted"" place",12345,2026,2,130.50,1\n"Absent",12346,2026,2,.,1\n"Zero",12347,2026,3,0,1';
  assert.deepEqual([...metroRows(csv)], [{ code: "12345", name: 'Some "quoted" place', period: "2026Q2", value: 130.5 }]);
  assert.throws(() => parseFredCsv("unexpected", "series"), /Unexpected FRED header/);
  assert.throws(() => parseFredCsv("observation_date,series\n2026-10-01,.", "series"), /No observations/);
});
