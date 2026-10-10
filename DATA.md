# Data provenance

Company research shares SEC snapshots with the Tariff Sourcing Optimizer. `data/companies-index.json` records directory and retained financial coverage. Each company file preserves CIK, industry, metric taxonomy and concept, period, filing date, accession and source URL. Financial values can have different reporting periods, shown beside each value. Missing facts stay missing. The shared daily company refresh publishes status and data to that repository's `company-data` branch, retaining previous facts when the source cannot be fetched.

Reported assets and mortgage-related accounting concepts are company research context. The user chooses the mortgage-credit exposure, carry target, concentration limit and tail-loss decision limit for the modeled study. Those choices do not establish the company's actual holdings or policies. A company without retained financials can use a manually scoped scenario with its SEC filing links.

Run `node ingest.mjs` from this directory to refresh the browser data from January 1991 through the newest published periods. No API key is required. National data joins only closed calendar months with observations in all three series. The pipeline averages available weekly mortgage rates within each month and leaves missing months out. FHFA metro data includes published positive index values through the latest available closed quarter. A fresh download can reflect source revisions, so the committed files are the reproducible snapshot for the demo.

| Artifact | Observations |
| --- | --- |
| `data/macro.json` | 427 aligned months through August 2026. Freddie Mac 30-year rates, BLS monthly unemployment, and FHFA seasonally adjusted purchase-only house prices. The year-over-year comparison uses the same month of the prior year. |
| `data/metro-hpi.json` | 57,897 FHFA quarterly all-transactions observations across 410 metros and metro divisions through 2026 Q2. Worst year-over-year change compares the same quarter of the prior year. |
| `data/cas-2025-r01.json` | Fannie Mae CAS 2025-R01 terms and disclosed pool characteristics transcribed from the executed indenture and offering memorandum. |

The [national HPI](https://fred.stlouisfed.org/series/HPIPONM226S) uses purchase-only observations and seasonal adjustment. The [metro series](https://www.fhfa.gov/data/hpi/datasets) uses sale prices and appraisal data without seasonal adjustment. Compare growth rates within each series. FRED supplies current-vintage values, so a chronology check against these files is not a real-time-vintage backtest.

The public deal reference records actual disclosed terms. Replicating the trust's historical payments requires the full remittance files, principal tests, loss write-ups and exact reference-tranche definitions from Fannie Mae. The model runs representative mortgage pools and never represents its payouts as observations from this deal. See [Fannie Mae Data Dynamics](https://capitalmarkets.fanniemae.com/tools-applications/data-dynamics) for the historical disclosure access workflow.

Run `node check-sources.mjs data/source-status.json` after refreshing the data to update the bundled source report. The report compares each source's newest observation with the model snapshot and separately reports the latest month common to all three national series. The scheduled workflow publishes check metadata to `source-status`. Refreshing the model inputs requires the ingestion command above.
