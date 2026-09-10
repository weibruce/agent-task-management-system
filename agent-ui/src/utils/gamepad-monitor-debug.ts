export interface AtmsDebugApi {
  gamepadMonitor?: (visible?: boolean) => boolean
  [key: string]: unknown
}

export interface AtmsDebugHost {
  AtmsDebug?: AtmsDebugApi
}

export type GamepadMonitorCommand = (visible?: boolean) => boolean

/**
 * Installs the console-only gamepad monitor command without replacing other
 * Atms debug tools. The returned cleanup only removes this installation.
 */
export function installGamepadMonitorDebugApi(
  target: object,
  command: GamepadMonitorCommand,
): () => void {
  const host = target as AtmsDebugHost
  const existing = host.AtmsDebug
  const debugApi = existing && typeof existing === 'object' ? existing : {}
  debugApi.gamepadMonitor = command
  host.AtmsDebug = debugApi

  return () => {
    if (host.AtmsDebug?.gamepadMonitor !== command) return
    delete host.AtmsDebug.gamepadMonitor
    if (Object.keys(host.AtmsDebug).length === 0) delete host.AtmsDebug
  }
}
