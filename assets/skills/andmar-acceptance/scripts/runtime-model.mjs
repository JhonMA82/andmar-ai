// Only model generation is scripted; native tools/hooks/storage stay real.
import { readFileSync } from "node:fs";
export function createAcceptanceModel(options) {
  const phases = JSON.parse(readFileSync(options.frames, "utf8"));
  const steps = new Map();
  return { languageModel: id => ({
    specificationVersion: "v3", provider: "acceptance", modelId: id, supportedUrls: {},
    async doStream(request) {
      const user = request.prompt.filter(message => message.role === "user").at(-1);
      const text = (user?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
      const phase = text.match(/acceptance-phase:([a-z-]+)/)?.[1];
      if (!phase || !phases[phase]) throw new Error(`Unknown acceptance phase: ${phase}`);
      const step = steps.get(phase) ?? 0;
      steps.set(phase, step + 1);
      const frame = phases[phase][step];
      const parts = [{ type: "stream-start", warnings: [] }];
      if (frame) parts.push({ type: "tool-call", toolCallId: `acceptance-${phase}-${step + 1}`, toolName: frame.name, input: JSON.stringify(frame.input) });
      else parts.push({ type: "text-start", id: "done" }, { type: "text-delta", id: "done", delta: `Runtime acceptance ${phase} finished.` }, { type: "text-end", id: "done" });
      parts.push({ type: "finish", finishReason: { unified: frame ? "tool-calls" : "stop", raw: frame ? "tool_calls" : "stop" }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } });
      return { stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) };
    },
    async doGenerate() { return { content: [{ type: "text", text: "Acceptance" }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] }; },
  }) };
}
