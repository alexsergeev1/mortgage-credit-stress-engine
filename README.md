# Mortgage Credit Stress Engine

[Live study](https://alexsergeev1.github.io/mortgage-credit-stress-engine/)

A structured credit research simulator that allocates a fixed portfolio across representative mortgage credit tranches under a carry floor and concentration limit. It traces mortgage defaults, prepayments and recoveries through a quarterly principal waterfall, then compares the proposed allocation with a baseline on held-out simulated paths.

## Run a study

```sh
node --test
node serve.mjs
node study.mjs 6000 1.4 > audit.json
```

The local dashboard opens at [127.0.0.1:4176](http://127.0.0.1:4176). Use the scenario explorer to inspect a tail outcome. The export records the assumptions, weights, simulated paths and audit diagnostics.

**Run risk audit** replays four observed national macro periods through the representative tranche rules. It also tests the current weights on 4,000 fresh simulated paths across five predetermined seeds. Historical replays illustrate sensitivity to observed conditions. The loan behavior and tranche losses remain modeled, and the audit reports carry-matched differences even when they are negative.

**Public data updates** shows the latest source check and flags newer releases. GitHub Actions checks FRED and FHFA daily. Studies use the documented macro and metro snapshots for reproducibility.

## What the data establishes

- **Historical observations.** 419 monthly observations align mortgage rates, unemployment and house prices. Quarterly joint changes inform the simulated macro shocks. The metro explorer includes 57,077 FHFA observations across 410 metros and metro divisions. Overlapping national and metro changes estimate the range of regional sensitivities used in the simulation.
- **Public deal terms.** The Fannie Mae CAS 2025-R01 reference uses actual offering documents and disclosed pool statistics. It provides a concrete example of deal scale and offered classes.
- **Modeled economics.** Securities, loan transition parameters, shock regimes and portfolio returns are representative. Holdout results measure policy behavior on independently generated scenarios. Historical deal remittances, executable prices and realized hedge P&L would require additional data.

See [data provenance](DATA.md) for the ingestion steps and source links. The model is a research prototype.
