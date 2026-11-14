export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : digits)} ${units[i]}`
}

export function formatSpeed(bps: number | null | undefined): string {
  if (!bps) return '–'
  return `${formatBytes(bps)}/s`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '–:––'
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`
  const h = Math.floor(seconds / 3600)
  return `${h} h ${Math.round((seconds % 3600) / 60)} min left`
}

export function formatRelative(epochSeconds: number | null | undefined, now = Date.now()): string {
  if (!epochSeconds) return ''
  const diff = Math.round((now - epochSeconds * 1000) / 1000)
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'],
  ]
  let unit: Intl.RelativeTimeFormatUnit = 'year'
  let div = 31557600
  for (let i = 0; i < steps.length; i++) {
    if (abs < steps[i][0]) {
      unit = steps[i][1]
      div = i === 0 ? 1 : steps[i - 1][0]
      break
    }
  }
  return rtf.format(-Math.round(diff / div), unit)
}

export function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatCount(n: number | null | undefined): string {
  if (!n) return ''
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export function resolutionLabel(height: number | null | undefined): string | null {
  if (!height) return null
  if (height >= 2160) return '4K'
  if (height >= 1440) return '1440p'
  return `${height}p`
}
