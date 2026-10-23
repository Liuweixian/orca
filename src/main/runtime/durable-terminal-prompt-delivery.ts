/** Whether this host can park and deliver terminal prompts through its own sqlite store. */
export function supportsDurableTerminalPromptDelivery(): boolean {
  if (typeof process.getBuiltinModule !== 'function') {
    return false
  }
  try {
    return process.getBuiltinModule('node:sqlite') !== undefined
  } catch {
    return false
  }
}
