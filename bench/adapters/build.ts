export function buildArgs(modelRef: string, sessionID: string, prompt: string): string[] {
  return ["run", "--standalone", "--auto", "--format", "json", "--agent", "build", "--model", modelRef, "--session", sessionID, "--", prompt]
}
