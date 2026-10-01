// Deterministic model fixture only. OpenCode executes every requested tool
// normally; no shell, hook, storage, permission or receipt result is mocked.
import { readFileSync } from "node:fs";
export function createAcceptanceModel(options) {
  let step = 0;
  const frames = JSON.parse(readFileSync(options.frames, "utf8"));
  return { languageModel: id => ({
    specificationVersion: "v3", provider: "acceptance", modelId: id, supportedUrls: {},
    async doStream() {
      const frame = frames[step++];
      const parts = [{ type: "stream-start", warnings: [] }];
      if (frame) parts.push({ type: "tool-call", toolCallId: `acceptance-${step}`, toolName: frame.name, input: JSON.stringify(frame.input) });
      else parts.push({ type: "text-start", id: "done" }, { type: "text-delta", id: "done", delta: "Runtime acceptance finished." }, { type: "text-end", id: "done" });
      parts.push({ type: "finish", finishReason: { unified: frame ? "tool-calls" : "stop", raw: frame ? "tool_calls" : "stop" }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } });
      return { stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) };
    },
    async doGenerate() { return { content: [{ type: "text", text: "Acceptance" }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] }; },
  }) };
}
