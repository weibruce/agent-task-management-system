import { describe, expect, it, vi } from 'vitest'
import {
  installGamepadMonitorDebugApi,
  type AtmsDebugHost,
} from './gamepad-monitor-debug'

describe('gamepad monitor debug API', () => {
  it('opens, closes, and queries the monitor through the console command', () => {
    const host: AtmsDebugHost = {}
    let visible = false
    const command = vi.fn((next?: boolean) => {
      if (typeof next === 'boolean') visible = next
      return visible
    })

    const uninstall = installGamepadMonitorDebugApi(host, command)

    expect(host.AtmsDebug?.gamepadMonitor?.()).toBe(false)
    expect(host.AtmsDebug?.gamepadMonitor?.(true)).toBe(true)
    expect(host.AtmsDebug?.gamepadMonitor?.(false)).toBe(false)

    uninstall()
    expect(host.AtmsDebug).toBeUndefined()
  })

  it('preserves other debug commands and does not remove replacements', () => {
    const replacement = () => true
    const host: AtmsDebugHost = { AtmsDebug: { keep: 'value' } }
    const uninstall = installGamepadMonitorDebugApi(host, () => false)

    host.AtmsDebug!.gamepadMonitor = replacement
    uninstall()

    expect(host.AtmsDebug).toEqual({ keep: 'value', gamepadMonitor: replacement })
  })
})
