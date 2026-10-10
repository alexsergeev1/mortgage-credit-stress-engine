const card = document.getElementById("source-freshness");
const refresh = document.getElementById("source-refresh");
const result = document.getElementById("source-results");
const note = document.getElementById("source-checked");

const rawUrl = "https://raw.githubusercontent.com/" + card.dataset.repo + "/source-status/source-status.json";
const labels = { newer: "Newer source data available", current: "Matches snapshot", unavailable: "Source unavailable", behind: "Source behind snapshot" };

async function readStatus(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error("Source status unavailable.");
  const payload = await response.json();
  if (!Array.isArray(payload.sources) || !Number.isFinite(Date.parse(payload.checkedAt))) {
    throw new Error("Invalid source status.");
  }
  return payload;
}

function sourceRow(source) {
  const item = document.createElement("li");
  const name = document.createElement("a");
  const state = document.createElement("strong");
  const detail = document.createElement("small");
  const url = new URL(source.url);
  if (url.protocol === "https:") name.href = url.href;
  name.textContent = source.name;
  state.textContent = labels[source.status] ?? "Unknown status";
  const partial = source.latestCompleteMonth && source.latest?.slice(0, 7) > source.latestCompleteMonth;
  detail.textContent = "Snapshot " + (source.snapshot ?? "—") + " · Latest " + (source.latest ?? "—") +
    (partial ? " (partial month)" : "");
  item.append(name, state, detail);
  return item;
}

async function showStatus() {
  refresh.disabled = true;
  note.textContent = "Reading the latest status report…";
  try {
    const [bundled, online] = await Promise.allSettled([readStatus("./data/source-status.json?v=2"), readStatus(rawUrl)]);
    const local = bundled.value, remote = online.value;
    const matches = remote && (!local ||
      (remote.snapshotMonth === local.snapshotMonth && remote.snapshotQuarter === local.snapshotQuarter));
    const useRemote = matches && (!local || Date.parse(remote.checkedAt) >= Date.parse(local.checkedAt));
    const payload = useRemote ? remote : local;
    if (!payload) throw new Error("No status report available.");
    result.replaceChildren(...payload.sources.map(sourceRow));
    const checked = new Date(payload.checkedAt).toLocaleString("en-US", { timeZone: "UTC" });
    const stale = Date.now() - Date.parse(payload.checkedAt) > 48 * 60 * 60 * 1000;
    const model = payload.snapshotMonth ? `Model snapshot ${payload.snapshotMonth} national · ${payload.snapshotQuarter} metro. ` : "";
    const alignment = payload.alignedMacroLatest
      ? `Latest month with all three national inputs is ${payload.alignedMacroLatest}. Newer individual series observations do not advance the model on their own.`
      : "The latest aligned national month could not be verified.";
    note.textContent = (useRemote ? "Online check from " : "Bundled check from ") + checked + " UTC. " +
      (stale ? "This report is more than 48 hours old. " : "") + model + alignment;
  } catch {
    note.textContent = "No status report is available yet. The pinned data remains available.";
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", showStatus);
showStatus();
