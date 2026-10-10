import { loadCompanyIndex, loadCompanySnapshot } from "./company-source.mjs?v=1";

const roles = {
  bank: "A bank can test an explicitly scoped mortgage-credit investment sleeve. This model excludes deposits, liquidity, funding, capital ratios and the rest of the balance sheet.",
  investor: "A mortgage investor can compare representative tranche allocations. This model excludes company leverage, hedges, financing, actual security prices and disclosed portfolio composition.",
  treasury: "For a non-financial company, this is a hypothetical treasury investment case. The model does not forecast the company’s operating losses or establish that mortgage credit is suitable for its cash needs.",
  independent: "Compare representative mortgage tranches within an investment mandate you define. Company financials, when selected, are context rather than modeled holdings.",
};
const scope = "User-entered hypothetical mortgage-credit exposure. Public company financials are context only; representative model positions are not reported company holdings.";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const money = (value) => Number.isFinite(value) ? usd.format(value) : "—";
const secCompany = (cik) => "https://www.sec.gov/edgar/browse/?CIK=" + encodeURIComponent(String(cik)) + "&owner=exclude";

export function suggestedRole(profile) {
  const sic = Number(profile?.sic);
  if ((sic >= 6000 && sic < 6100) || /bank|bancorp|citigroup/i.test(profile?.name ?? "")) return "bank";
  if ((sic >= 6100 && sic < 6800) || /mortgage|reit|annaly|agnc|ritm/i.test(profile?.name ?? "")) return "investor";
  return "treasury";
}

export function createCompanyCase({ entry, snapshot, role, notionalMillions, budgetMillions, carryFloor, concentrationCap, appliedAt = new Date().toISOString() }) {
  if (!Object.hasOwn(roles, role)) throw new Error("Select a decision mandate.");
  if (!Number.isFinite(notionalMillions) || notionalMillions < 10 || notionalMillions > 750 || !Number.isInteger(notionalMillions)) {
    throw new Error("Enter a whole-million exposure from $10M to $750M.");
  }
  if (!Number.isFinite(budgetMillions) || budgetMillions <= 0 || budgetMillions > notionalMillions) {
    throw new Error("The tail-loss decision limit must be positive and no greater than the exposure in scope.");
  }
  if (!Number.isFinite(carryFloor) || carryFloor < 0 || carryFloor > 0.15 || !Number.isFinite(concentrationCap) || concentrationCap < 0.15 || concentrationCap > 1) {
    throw new Error("Check the study’s carry floor and concentration cap before applying this case.");
  }
  return {
    company: entry ? {
      ticker: entry.ticker, cik: entry.cik, name: snapshot?.profile?.name ?? entry.name,
      filingUrl: secCompany(entry.cik), financialSnapshotAvailable: Boolean(snapshot),
      delivery: snapshot?.delivery ?? null, asOf: snapshot?.asOf ?? null,
      snapshotRetrievedAt: snapshot?.retrievedAt ?? null,
      latestFiling: snapshot?.latestFiling ?? null,
      directory: entry.directory ?? null,
      sources: snapshot?.sources ?? null,
      publicFacts: snapshot?.facts?.map(({ id, label, taxonomy, concept, unit, latest }) => ({ id, label, taxonomy, concept, unit, latest })) ?? [],
    } : null,
    mandate: { role, portfolioSizeDollars: notionalMillions * 1e6, tailLossBudgetDollars: budgetMillions * 1e6, carryFloor, concentrationCap },
    scope, appliedAt,
  };
}

export function assessCompanyCase(companyCase, study) {
  if (!companyCase || !study) return null;
  const tail = study.optimized.cvarDollars;
  const budget = companyCase.mandate.tailLossBudgetDollars;
  const feasible = study.optimized.feasible === true;
  return {
    status: !feasible ? "review-model-constraints" : tail <= budget ? "within-decision-limit" : "above-decision-limit",
    modelConstraintsSatisfied: feasible,
    tailLossDollars: tail,
    tailLossBudgetDollars: budget,
    headroomDollars: budget - tail,
    baselineTailLossDollars: study.baseline.cvarDollars,
    evaluatedPortfolioSizeDollars: study.config.portfolioSize,
    evaluatedCarryFloor: study.config.carryFloor,
    evaluatedConcentrationCap: study.config.concentration,
    scopeChanged: study.config.portfolioSize !== companyCase.mandate.portfolioSizeDollars,
    settingsChanged: (Number.isFinite(study.config.carryFloor) && study.config.carryFloor !== companyCase.mandate.carryFloor) || (Number.isFinite(study.config.concentration) && study.config.concentration !== companyCase.mandate.concentrationCap),
    unchangedWeightsExposureScreenDollars: tail > 0 ? study.config.portfolioSize * budget / tail : null,
    method: "Holdout mean loss in worst 5% of simulated paths. Decision limit is evaluated after allocation optimization; it is not an optimization constraint.",
  };
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function secLink(label, href) {
  const link = element("a", label);
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && (url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov"))) link.href = url.href;
  } catch { /* Missing or invalid disclosure URL stays unlinked. */ }
  if (!link.hasAttribute("href")) return element("span", label);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function financialValue(fact) {
  if (fact.unit === "USD") return money(fact.latest.value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, notation: "compact" }).format(fact.latest.value) + " " + fact.unit;
}

export function setupCompanyResearch({ onApply }) {
  const $ = (id) => document.getElementById(id);
  let directory, selected, snapshot, busy = false, requestNumber = 0;

  function showScale() {
    const notional = Number($("company-notional").value) * 1e6;
    const assets = snapshot?.facts?.find((fact) => fact.id === "assets" && fact.unit === "USD" && fact.latest?.value > 0);
    $("company-scale").textContent = assets
      ? `Your ${money(notional)} case is ${(notional / assets.latest.value * 100).toFixed(3)}% of reported total assets (${money(assets.latest.value)}, ${assets.latest.end}). Total assets are a scale reference, not mortgage-credit exposure.`
      : "Enter the allocation to evaluate. The supported model range is $10M–$750M. No company exposure is inferred.";
    const budget = $("company-budget");
    budget.setCustomValidity(Number(budget.value) > Number($("company-notional").value) ? "The decision limit cannot exceed the exposure in scope." : "");
  }

  function showRole() { $("company-role-note").textContent = roles[$("company-role").value]; }

  function showSearch() {
    if (!directory) return;
    const query = $("company-search").value.trim().toUpperCase();
    const matches = query.length > 0 ? directory.companies.filter((entry) => entry.ticker.includes(query) || entry.name.toUpperCase().includes(query)) : directory.companies.filter((entry) => entry.hasSnapshot);
    matches.sort((a, b) => Number(b.ticker === query) - Number(a.ticker === query) || Number(Boolean(b.hasSnapshot)) - Number(Boolean(a.hasSnapshot)) || a.ticker.localeCompare(b.ticker));
    const visible = matches.slice(0, 8);
    $("company-results").replaceChildren(...visible.map((entry) => {
      const li = element("li");
      const button = element("button");
      button.type = "button";
      button.append(element("strong", entry.ticker), element("span", entry.name), element("small", entry.hasSnapshot ? "Public financials" : "SEC filing links · enter your own case"));
      button.addEventListener("click", () => selectCompany(entry));
      li.append(button);
      return li;
    }));
    $("company-directory-status").textContent = `${new Intl.NumberFormat("en-US").format(directory.companies.length)} SEC-listed tickers · ${directory.delivery} directory${directory.asOf ? " · " + directory.asOf : ""}. ${matches.length > 8 ? `Showing 8 of ${matches.length} matches.` : matches.length ? `${matches.length} matches.` : "No matches. Try a ticker or use the independent portfolio case."}`;
  }

  function showProfile(message) {
    const profile = snapshot?.profile;
    $("company-profile").replaceChildren(
      element("h3", selected ? `${selected.ticker} · ${profile?.name ?? selected.name}` : "Independent portfolio case"),
      element("p", profile?.sicDescription ? `${profile.sicDescription} · SIC ${profile.sic}. ${message ?? "Public statements provide company context; actual holdings are not imported into the model."}` : message ?? scope),
    );
    $("company-filings").replaceChildren();
    if (selected) $("company-filings").append(secLink("SEC company filings ↗", secCompany(selected.cik)));
    if (snapshot?.latestFiling?.url) {
      const filing = snapshot.latestFiling;
      $("company-filings").append(secLink(`${filing.form} filed ${filing.filed} ↗`, filing.url));
    }
    if (snapshot) $("company-filings").append(element("small", `Public snapshot ${snapshot.asOf ?? "date unavailable"} · ${snapshot.delivery} · retrieved ${snapshot.retrievedAt ?? "date unavailable"}`));
    if (snapshot?.status === "stale" || snapshot?.status === "partial") {
      $("company-filings").append(element("small", "The latest refresh was incomplete. Retained figures keep their original source dates."));
    }
    $("company-facts").replaceChildren();
    const preferred = ["assets", "equity", "mortgageLoans", "mortgageBackedSecurities", "mortgageServicingRights", "loans", "deposits", "cash", "netIncome", "revenue"];
    const facts = [...(snapshot?.facts ?? [])].filter((fact) => fact.latest && Number.isFinite(fact.latest.value)).sort((a, b) => {
      const ai = preferred.indexOf(a.id), bi = preferred.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    }).slice(0, 6);
    for (const fact of facts) {
      const card = element("article", undefined, "company-fact");
      card.append(element("span", fact.label), element("strong", financialValue(fact)));
      const point = fact.latest;
      const period = point.start && point.start !== point.end ? `${point.start}–${point.end}` : `As of ${point.end}`;
      card.append(element("small", `${period} · ${point.form}, filed ${point.filed}`));
      card.append(secLink(`${fact.taxonomy}:${fact.concept} ↗`, point.url));
      $("company-facts").append(card);
    }
    if (snapshot && !facts.length) $("company-facts").append(element("p", "No supported public financial fact was reported in this snapshot. Use the linked filings.", "subtle"));
    showScale();
  }

  async function selectCompany(entry) {
    const request = ++requestNumber;
    selected = { ...entry, directory: { asOf: directory?.asOf, retrievedAt: directory?.retrievedAt, delivery: directory?.delivery, sourceUrl: directory?.sourceUrl } };
    snapshot = undefined;
    $("company-search").value = entry.ticker;
    $("company-results").replaceChildren();
    $("company-role").value = suggestedRole(entry);
    showRole();
    showProfile(entry.hasSnapshot ? "Loading public financial statements…" : "Financial facts are not cached for this company. Review its SEC filings and enter your own hypothetical mortgage-credit case; no holdings are inferred.");
    if (!entry.hasSnapshot) return;
    try {
      const loaded = await loadCompanySnapshot(entry);
      if (request !== requestNumber) return;
      snapshot = loaded;
      $("company-role").value = suggestedRole(snapshot.profile);
      showRole();
      showProfile();
    } catch (error) {
      if (request !== requestNumber) return;
      showProfile(`Public financial snapshot unavailable: ${error.message} The SEC filing link and user-entered case remain available.`);
    }
  }

  $("company-search").addEventListener("input", showSearch);
  $("company-independent").addEventListener("click", () => {
    ++requestNumber;
    selected = undefined;
    snapshot = undefined;
    $("company-search").value = "";
    $("company-role").value = "independent";
    showRole();
    showProfile();
    showSearch();
  });
  $("company-role").addEventListener("change", showRole);
  $("company-notional").addEventListener("input", showScale);
  $("company-budget").addEventListener("input", showScale);
  $("company-case").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !$("company-case").reportValidity()) return;
    try {
      const companyCase = createCompanyCase({
        entry: selected, snapshot, role: $("company-role").value,
        notionalMillions: Number($("company-notional").value), budgetMillions: Number($("company-budget").value),
        carryFloor: Number($("carry").value) / 100, concentrationCap: Number($("cap").value) / 100,
      });
      onApply(companyCase);
      $("company-case-status").textContent = "Case applied. Evaluating the allocation against your decision limit…";
    } catch (error) { $("company-case-status").textContent = error.message; }
  });
  showRole();

  loadCompanyIndex().then((index) => {
    directory = index;
    const financialCount = index.companies.filter(({ hasFinancials }) => hasFinancials).length;
    $("company-coverage").textContent = `${index.companies.length.toLocaleString("en-US")} searchable tickers · ${index.snapshotCount ?? 0} company profiles · ${financialCount} with retained financials. Choose your own exposure for any company.`;
    $("company-search").disabled = false;
    showSearch();
  }).catch((error) => {
    $("company-directory-status").textContent = `SEC directory unavailable: ${error.message} You can still evaluate an independent portfolio case.`;
  });

  return {
    setBusy(value) { busy = value; $("company-apply").disabled = value; },
    showStudy(study, companyCase) {
      const decision = $("company-decision");
      if (!companyCase) return;
      const assessment = assessCompanyCase(companyCase, study);
      const company = companyCase.company?.ticker ?? "Independent";
      const title = assessment.status === "within-decision-limit" ? "Within your tail-loss decision limit" : assessment.status === "above-decision-limit" ? "Above your tail-loss decision limit" : "Review the allocation constraints";
      decision.dataset.status = assessment.status;
      decision.replaceChildren(element("h3", `${company} case · ${title}`));
      const figures = element("div", undefined, "company-decision-figures");
      for (const [label, value] of [["Modeled tail loss", assessment.tailLossDollars], ["Your decision limit", assessment.tailLossBudgetDollars], ["Headroom / (excess)", assessment.headroomDollars]]) {
        const item = element("div", label);
        item.append(element("strong", money(value)));
        figures.append(item);
      }
      decision.append(figures);
      const note = !assessment.modelConstraintsSatisfied
        ? "The allocation does not meet all model constraints on holdout paths. Review the carry floor, concentration cap and issue capacity before using the result."
        : assessment.status === "above-decision-limit"
          ? `The selected allocation exceeds your limit by ${money(-assessment.headroomDollars)}. At unchanged weights, an exposure of ${money(assessment.unchangedWeightsExposureScreenDollars)} would match the limit. This is a proportional screening estimate; rerun a smaller case to recheck carry, capacity and concentration.`
          : `The modeled allocation has ${money(assessment.headroomDollars)} of headroom. Validate the historical replay and seed stability before treating this as a candidate decision.`;
      decision.append(element("p", note));
      if (assessment.scopeChanged) decision.append(element("p", `The current study uses ${money(study.config.portfolioSize)}; the applied case originally specified ${money(companyCase.mandate.portfolioSizeDollars)}. The decision limit remains ${money(assessment.tailLossBudgetDollars)}.`));
      if (assessment.settingsChanged) decision.append(element("p", `Study assumptions changed after this case was applied. This result uses a ${(study.config.carryFloor * 100).toFixed(2)}% annual carry floor and ${(study.config.concentration * 100).toFixed(1)}% single-tranche cap. Both the original mandate and evaluated settings are retained in the export.`));
      decision.append(element("p", `${roles[companyCase.mandate.role]} ${scope}`, "subtle"));
      $("company-case-status").textContent = `${company} case evaluated at ${money(study.config.portfolioSize)}. Public company facts do not calibrate the loan or tranche model.`;
      return assessment;
    },
  };
}
