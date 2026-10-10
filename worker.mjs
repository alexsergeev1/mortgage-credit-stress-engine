import { runRiskAudit, runStudy } from "./engine.mjs?v=3";

self.addEventListener("message", ({ data }) => {
  try {
    if (data.kind === "audit") self.postMessage({ kind: "audit", audit: runRiskAudit(data.inputs, data.study) });
    else self.postMessage({ kind: "study", study: runStudy(data.inputs) });
  } catch (error) {
    self.postMessage({ kind: data.kind, error: error.message });
  }
});
