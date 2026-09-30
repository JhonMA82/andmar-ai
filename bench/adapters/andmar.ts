import { buildArgs } from "./build.ts"
export function andmarArgs(modelRef: string, sessionID: string, prompt: string): string[] {
  const args = buildArgs(modelRef, sessionID, prompt)
  args[args.indexOf("--agent") + 1] = "andmar"
  return args
}
