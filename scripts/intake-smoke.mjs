// Manual smoke test for real Jev decisions. Never runs in CI.
// Requires OPENROUTER_API_KEY in the environment.
// Usage: OPENROUTER_API_KEY=... ANDMAR_INTAKE_TRACE=1 node scripts/intake-smoke.mjs
// The script never prints the API key.

import { readFile } from "node:fs/promises";

const key = (process.env.OPENROUTER_API_KEY ?? "").trim();
if (key === "") {
  console.error("intake-smoke: OPENROUTER_API_KEY is missing; skipping real Jev call.");
  process.exit(2);
}

const samples = [
  "Cambia Save por Guardar",
  "Agrega validación al formulario",
  "Haz que no se puedan falsificar los receipts",
  "Migra este plugin a OpenCode v2",
  "Agrega login con Google",
  "Esto falla cuando hay dos sesiones",
];

const endpoint = "https://openrouter.ai/api/alpha/decisions";
const model = (process.env.ANDMAR_INTAKE_MODEL ?? "typesafe/jev-1.13").trim() || "typesafe/jev-1.13";

// Load the exact questions the capability sends so the smoke matches runtime.
const questionsUrl = new URL("../src/capabilities/intake/questions.ts", import.meta.url);
void questionsUrl;
void readFile;

console.log(`intake-smoke: model=${model} samples=${samples.length}`);

for (const sample of samples) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const started = Date.now();
  try {
    // Import questions dynamically from TS source is not possible in plain
    // node; inline the six question ids for the smoke and rely on the
    // capability file as the canonical definition (see docs/INTAKE.md).
    const body = JSON.stringify({
      model,
      state: sample,
      questions: {
        task_kind: { type: "choice", instructions: "What kind of development work does this request describe? Choose the closest category.", criteria: { "trivial-ui": "Tiny UI/text change.", "docs-format": "Docs/format.", "known-test": "Known test.", feature: "Bounded feature.", bugfix: "Fix broken behavior.", refactor: "Refactor.", debug: "Unclear failure.", architecture: "Architecture.", security: "Security-sensitive.", migration: "Migration/port.", review: "Review.", internal: "Internal/other." } },
        needs_refinement: { type: "noul", instructions: "Does this request need internal refinement before execution?", criteria: { true: "Too vague to execute.", false: "Precise enough." } },
        specification_sufficiency: { type: "score", instructions: "How sufficient is the specification?", criteria: ["Empty.", "Goal only.", "Goal plus partial context.", "Clear intent.", "Fully specified."] },
        risk: { type: "score", instructions: "Risk if executed incorrectly?", criteria: ["Low.", "Medium.", "High.", "Critical."] },
        external_contract: { type: "noul", instructions: "Depends on external contract/upstream/auth provider?", criteria: { true: "Depends on external contract.", false: "Self-contained." } },
        product_decision_missing: { type: "noul", instructions: "Is a real product decision missing that must be asked?", criteria: { true: "Missing product decision.", false: "No missing decision." } },
        request_shape: { type: "choice", instructions: "What is the structural shape and level of detail of this request?", criteria: { compact: "Compact, concrete request.", underspecified: "Underspecified request.", structured: "Multiple requirements, constraints, acceptance criteria, or PRD-like content." } },
      },
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      console.log(`- ${JSON.stringify(sample)} -> HTTP ${response.status} (${latencyMs}ms)`);
      continue;
    }
    const payload = await response.json();
    console.log(`- ${JSON.stringify(sample)} (${latencyMs}ms, served=${payload.model ?? "?"})`);
    console.log(`  answers=${JSON.stringify(payload.answers)}`);
  } catch (error) {
    console.log(`- ${JSON.stringify(sample)} -> error=${error instanceof Error ? error.message.split(":")[0] : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
