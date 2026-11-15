import { describe, expect, it } from 'vitest'
import { composeHeaders, countHeaders, urlFromCurl } from './analysisStore'

describe('request headers', () => {
  it('composes the referer field with the free-form headers', () => {
    expect(composeHeaders('', '')).toBe('')
    expect(composeHeaders(' https://a.example/ ', 'Origin: https://a.example\n')).toBe(
      'Referer: https://a.example/\nOrigin: https://a.example',
    )
  })

  it('counts headers for the toggle badge', () => {
    expect(countHeaders('', '')).toBe(0)
    expect(countHeaders('https://a.example/', 'Origin: x\n\n# note\n:authority: y\nX-Token: 1')).toBe(3)
    expect(countHeaders('', "curl 'https://c.example/i.m3u8' -H 'referer: x' -H 'origin: y' --compressed")).toBe(2)
    expect(countHeaders('', '{"Referer": "x", "Origin": "y"}')).toBe(2)
  })

  it('finds the stream URL in a pasted cURL command', () => {
    expect(urlFromCurl("curl 'https://cdn.example/v/index.m3u8?t=1' -H 'referer: x'")).toBe('https://cdn.example/v/index.m3u8?t=1')
    expect(urlFromCurl('curl ^"https://cdn.example/v/index.m3u8^" ^\n  -H ^"referer: x^"')).toBe('https://cdn.example/v/index.m3u8')
    expect(urlFromCurl('https://not.curl/x')).toBeNull()
  })
})
