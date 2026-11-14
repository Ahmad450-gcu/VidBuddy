/** Pull the first http(s) URL out of share-sheet text ("Check this out https://…"). */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/[^\s<>"']+/)
  return m ? m[0].replace(/[).,;!]+$/, '') : null
}
