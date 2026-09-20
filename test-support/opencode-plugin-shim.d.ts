declare module "@opencode/plugin" {
  export const Plugin: {
    define<T extends { id: string; setup(ctx: any): any }>(definition: T): T
  }
}
