export interface AtmsBridgeHost {
  getHost?: () => unknown
  isAndroidTV?: () => unknown
}

export interface AtmsBridgeWindow {
  AtmsBridge?: AtmsBridgeHost
}

export interface MobileVoiceDeviceInput {
  userAgent?: string
  maxTouchPoints?: number
  viewportWidth?: number
  viewportHeight?: number
  bridgeWindow?: AtmsBridgeWindow | null
}

export interface AndroidTvCompactViewportInput {
  androidTv: boolean
  viewportWidth: number
  viewportHeight: number
}

function currentWindow(): AtmsBridgeWindow | null {
  if (typeof window === 'undefined') return null
  return window as Window & AtmsBridgeWindow
}

export function isAndroidTvShell(bridgeWindow: AtmsBridgeWindow | null = currentWindow()): boolean {
  const bridge = bridgeWindow?.AtmsBridge
  if (!bridge) return false

  try {
    if (bridge.isAndroidTV?.() === true) return true
  } catch {
    // Ignore a broken shell bridge and fall back to the host string.
  }

  try {
    return bridge.getHost?.() === 'android-tv'
  } catch {
    return false
  }
}

export function isMobileVoiceUserAgent(userAgent: string, androidTv = false): boolean {
  if (androidTv) return false
  return /Android|iPhone|iPad|iPod|Mobile|MiuiBrowser|XiaoMi|HarmonyOS/i.test(userAgent)
}

export function isMobileVoiceDevice(input: MobileVoiceDeviceInput): boolean {
  if (isAndroidTvShell(input.bridgeWindow ?? currentWindow())) return false
  const userAgent = input.userAgent ?? ''
  if (isMobileVoiceUserAgent(userAgent)) return true
  const maxTouchPoints = input.maxTouchPoints ?? 0
  const width = input.viewportWidth ?? Number.POSITIVE_INFINITY
  const height = input.viewportHeight ?? Number.POSITIVE_INFINITY
  return maxTouchPoints > 0 && Math.min(width, height) <= 620
}

export function isAndroidTvCompactViewport(input: AndroidTvCompactViewportInput): boolean {
  if (!input.androidTv) return false
  return input.viewportWidth <= 1100 && input.viewportHeight <= 650
}
