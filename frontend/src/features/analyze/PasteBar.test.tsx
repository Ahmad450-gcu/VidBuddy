import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnalysis } from './analysisStore'
import { AnalysisPanel } from './AnalysisPanel'
import { PasteBar } from './PasteBar'

afterEach(() => {
  vi.restoreAllMocks()
  useAnalysis.getState().reset()
})

describe('PasteBar + AnalysisPanel', () => {
  it('submits the link and shows a categorized error from the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: { code: 'drm', message: 'This media is DRM-protected and can\'t be downloaded.' } }), { status: 422 }),
    )
    render(
      <>
        <PasteBar />
        <AnalysisPanel />
      </>,
    )
    const button = screen.getByRole('button', { name: 'Get media' })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Media link'), 'https://example.com/protected{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('DRM-protected'))
    expect(screen.getByText(/Streaming services that use DRM/)).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/analyze')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ url: 'https://example.com/protected', refresh: false })
  })
})
