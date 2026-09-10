import { describe, expect, it } from 'vitest'

import {
  formatRepositoryPayloadForDisplay,
  formatRepositoryReferencesForDisplay,
} from './dagRuntimePresentation'

describe('DAG runtime presentation', () => {
  it('shows GitHub clone URLs as owner/repository labels', () => {
    expect(formatRepositoryReferencesForDisplay(
      'git clone https://github.com/xiaotianfotos/atms source',
    )).toBe('git clone xiaotianfotos/atms source')
    expect(formatRepositoryReferencesForDisplay(
      'git clone git@github.com:xiaotianfotos/atms.git',
    )).toBe('git clone xiaotianfotos/atms')
  })

  it('formats repository URLs nested in tool payloads without mutating input', () => {
    const payload = {
      tool_calls: [{ input: { cmd: 'git clone https://github.com/xiaotianfotos/atms.git source' } }],
      result: 'checked https://github.com/xiaotianfotos/atms/pull/28',
    }

    const formatted = formatRepositoryPayloadForDisplay(payload)

    expect(formatted.tool_calls[0].input.cmd).toBe('git clone xiaotianfotos/atms source')
    expect(formatted.result).toBe('checked xiaotianfotos/atms/pull/28')
    expect(payload.tool_calls[0].input.cmd).toContain('https://github.com/')
  })
})
