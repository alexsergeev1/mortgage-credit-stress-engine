# Data provenance

Run `node ingest.mjs` from this directory to refresh the browser data. The pipeline joins monthly national data and parses the FHFA metropolitan history directly from source CSVs. No API key is required. It filters observations to January 1991 through December 2025. A fresh download can reflect source revisions, so the committed files are the reproducible snapshot for the demo.

| Artifact | Observations |
| --- | --- |
| `data/macro.json` | Freddie Mac 30-year rate observations averaged by calendar month, BLS monthly unemployment, and FHFA monthly seasonally adjusted purchase-only house prices. The year-over-year comparison uses the same month of the prior year. |
| `data/metro-hpi.json` | FHFA quarterly all-transactions metro and metro division indexes, excluding unpublished values. Worst year-over-year change compares the same quarter of the prior year. |
| `data/cas-2025-r01.json` | Fannie Mae CAS 2025-R01 terms and disclosed pool characteristics transcribed from the executed indenture and offering memorandum. |

The [national HPI](https://fred.stlouisfed.org/series/HPIPONM226S) uses purchase-only observations and seasonal adjustment. The [metro series](https://www.fhfa.gov/data/hpi/datasets) uses sale prices and appraisal data without seasonal adjustment. Compare growth rates within each series. FRED supplies current-vintage values, so a chronology check against these files is not a real-time-vintage backtest.

The public deal reference records actual disclosed terms. Replicating the trust's historical payments requires the full remittance files, principal tests, loss write-ups and exact reference-tranche definitions from Fannie Mae. The model runs representative mortgage pools and never represents its payouts as observations from this deal. See [Fannie Mae Data Dynamics](https://capitalmarkets.fanniemae.com/tools-applications/data-dynamics) for the historical disclosure access workflow.
