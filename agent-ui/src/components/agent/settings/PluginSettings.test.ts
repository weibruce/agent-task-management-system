import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { i18n } from '@/plugins/i18n'
import PluginSettings from './PluginSettings.vue'

const listAtmsPlugins = vi.fn()
const setAtmsPluginEnabled = vi.fn()

vi.mock('@/api/services/plugin-api', () => ({
  listAtmsPlugins: (...args: unknown[]) => listAtmsPlugins(...args),
  setAtmsPluginEnabled: (...args: unknown[]) => setAtmsPluginEnabled(...args),
}))

const registry = {
  registry_revision: 2,
  registry_fingerprint: 'a'.repeat(64),
  plugins: [{
    id: 'com.atms.core',
    name: 'Core',
    version: '0.1.0',
    package_digest: 'b'.repeat(64),
    manifest_digest: 'c'.repeat(64),
    source: 'builtin',
    enabled: true,
    locked: true,
    activation_revision: 1,
    capabilities: ['voice-generative-ui'],
    skills: ['voice-generative-ui'],
    tools: [],
    kinds: ['com.atms.core/notice'],
    renderers: ['core-notice'],
    actions: [],
  }, {
    id: 'com.atms.topic-outline',
    name: 'Topic Outline',
    version: '1.0.0',
    package_digest: 'd'.repeat(64),
    manifest_digest: 'e'.repeat(64),
    source: 'builtin',
    enabled: true,
    locked: false,
    activation_revision: 1,
    capabilities: ['compose-outline'],
    skills: ['topic-outline'],
    tools: ['upsert_topic_outline'],
    kinds: ['com.atms.topic-outline/outline'],
    renderers: ['topic-outline-main'],
    actions: [],
  }],
}

let app: App<Element> | null = null
let root: HTMLElement | null = null

async function mount(): Promise<HTMLElement> {
  listAtmsPlugins.mockResolvedValue({ success: true, data: structuredClone(registry) })
  setAtmsPluginEnabled.mockResolvedValue({
    success: true,
    data: {
      activation: { enabled: false },
      registry: {
        ...structuredClone(registry),
        registry_revision: 3,
        plugins: registry.plugins.map(plugin => (
          plugin.id === 'com.atms.topic-outline' ? { ...plugin, enabled: false } : plugin
        )),
      },
    },
  })
  root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(PluginSettings)
  app.use(i18n)
  app.mount(root)
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  return root
}

afterEach(() => {
  app?.unmount()
  root?.remove()
  app = null
  root = null
  vi.clearAllMocks()
})

describe('PluginSettings', () => {
  it('shows resolved capabilities, locks Core, and toggles an optional plugin', async () => {
    const mounted = await mount()
    const core = mounted.querySelector<HTMLInputElement>('[data-testid="agent-settings-plugin-toggle-com.atms.core"]')!
    const topic = mounted.querySelector<HTMLInputElement>('[data-testid="agent-settings-plugin-toggle-com.atms.topic-outline"]')!
    expect(core.disabled).toBe(true)
    expect(topic.disabled).toBe(false)
    expect(mounted.textContent).toContain('Topic Outline')
    expect(mounted.textContent).toContain('1 tool')
    expect(mounted.querySelector('[data-testid="agent-settings-plugins-count"]')?.textContent)
      .toContain('2')

    topic.checked = false
    topic.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(setAtmsPluginEnabled).toHaveBeenCalledWith('com.atms.topic-outline', false, 1, '1.0.0')
    expect(mounted.querySelector<HTMLInputElement>(
      '[data-testid="agent-settings-plugin-toggle-com.atms.topic-outline"]',
    )?.checked).toBe(false)
  })

  it('restores the last confirmed toggle state when activation fails', async () => {
    const mounted = await mount()
    setAtmsPluginEnabled.mockRejectedValueOnce(new Error('activation rejected'))
    const topic = mounted.querySelector<HTMLInputElement>(
      '[data-testid="agent-settings-plugin-toggle-com.atms.topic-outline"]',
    )!
    topic.checked = false
    topic.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()

    expect(topic.checked).toBe(true)
    expect(mounted.querySelector('[data-testid="agent-settings-plugins-error"]')?.textContent)
      .toContain('activation rejected')
  })

  it('serializes refresh and activation controls while a mutation is pending', async () => {
    const mounted = await mount()
    let release!: (value: unknown) => void
    setAtmsPluginEnabled.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const topic = mounted.querySelector<HTMLInputElement>(
      '[data-testid="agent-settings-plugin-toggle-com.atms.topic-outline"]',
    )!
    topic.checked = false
    topic.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(topic.disabled).toBe(true)
    expect(mounted.querySelector<HTMLButtonElement>('[data-testid="agent-settings-plugins-refresh"]')?.disabled)
      .toBe(true)

    release({
      success: true,
      data: {
        activation: { enabled: false },
        registry: {
          ...structuredClone(registry),
          registry_revision: 3,
          plugins: registry.plugins.map(plugin => (
            plugin.id === 'com.atms.topic-outline' ? { ...plugin, enabled: false } : plugin
          )),
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(topic.disabled).toBe(false)
    expect(topic.checked).toBe(false)
  })

  it('removes an uninstalled plugin when a newer registry snapshot omits it', async () => {
    const mounted = await mount()
    setAtmsPluginEnabled.mockResolvedValueOnce({
      success: true,
      data: {
        activation: { enabled: false },
        registry: {
          ...structuredClone(registry),
          registry_revision: 3,
          plugins: registry.plugins.filter(plugin => plugin.id !== 'com.atms.topic-outline'),
        },
      },
    })
    const topic = mounted.querySelector<HTMLInputElement>(
      '[data-testid="agent-settings-plugin-toggle-com.atms.topic-outline"]',
    )!
    topic.checked = false
    topic.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()

    expect(mounted.querySelector('[data-testid="agent-settings-plugin-com.atms.topic-outline"]'))
      .toBeNull()
    expect(mounted.textContent).not.toContain('Topic Outline')
  })
})
