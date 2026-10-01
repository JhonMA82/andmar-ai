// Manual smoke for real Jev decisions. Never runs in CI.
// Requires OPENROUTER_API_KEY in the environment and Node >= 22.18 (native
// type stripping, so the canonical question definition is imported instead of
// being copied here).
// Usage: OPENROUTER_API_KEY=... node scripts/intake-smoke.mjs
// The script never prints the API key.

import { INTAKE_QUESTIONS } from "../src/capabilities/intake/questions.ts";

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

const questions = Object.fromEntries(
  Object.entries(INTAKE_QUESTIONS).map(([id, question]) => {
    const { type, ...rest } = question;
    return [id, { type, ...rest }];
  }),
);

console.log(`intake-smoke: model=${model} samples=${samples.length} questions=${Object.keys(questions).length}`);

for (const sample of samples) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const started = Date.now();
  try {
    const body = JSON.stringify({ model, state: sample, questions });
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
