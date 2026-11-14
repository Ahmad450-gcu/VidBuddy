import { api, mediaUrls } from '../../lib/api'
import { saveToDevice } from '../../lib/platform'
import type { MediaItem } from '../../lib/types'
import { usePlayer } from '../../stores/player'
import { toast, toastError } from '../../stores/ui'

/** Play a library item in the right player, with its siblings as next/previous context. */
export function playItem(item: MediaItem, siblings: MediaItem[], navigate: (to: string) => void) {
  if (item.status === 'missing') {
    toast({ tone: 'danger', title: 'File is missing', body: 'It was moved or deleted outside VidBuddy. Rescan the library from Storage.' })
    return
  }
  if (item.kind === 'video') {
    usePlayer.getState().setVideoContext(siblings.filter((s) => s.kind === 'video' && s.status === 'ready').map((s) => s.id))
    navigate(`/watch/${item.id}`)
  } else {
    const audio = siblings.filter((s) => s.kind === 'audio' && s.status === 'ready')
    const list = audio.some((a) => a.id === item.id) ? audio : [item]
    usePlayer.getState().playAudio(list, list.findIndex((a) => a.id === item.id))
  }
}

/** Play a video's soundtrack in the background audio player (screen off, other tabs, lock screen). */
export function listenToItem(item: MediaItem, startAt?: number) {
  if (item.status === 'missing') {
    toast({ tone: 'danger', title: 'File is missing', body: 'It was moved or deleted outside VidBuddy. Rescan the library from Storage.' })
    return
  }
  usePlayer.getState().playAudio([startAt !== undefined ? { ...item, play_position: startAt } : item])
}

/** Save the item's audio as an MP3 (extracted from the video on the server when needed). */
export async function saveAudio(item: MediaItem) {
  const name = item.filename.replace(/\.[^.]+$/, '') + '.mp3'
  toast({ tone: 'neutral', title: 'Preparing MP3…', body: 'Extracting the audio. Long videos take a moment.' })
  try {
    const result = await saveToDevice(mediaUrls.audio(item.id), name, 'audio/mpeg')
    if (result === 'saved') toast({ tone: 'success', title: 'MP3 saved to your device', body: name })
    else if (result === 'browser') toast({ tone: 'neutral', title: 'Download started', body: 'Your browser is saving the MP3 to its downloads folder.' })
  } catch (e) {
    toastError(e, "Couldn't save the MP3")
  }
}

export async function saveItem(item: MediaItem) {
  try {
    const result = await saveToDevice(mediaUrls.file(item.id), item.filename, item.mime)
    if (result === 'saved') toast({ tone: 'success', title: 'Saved to your device', body: item.filename })
    else if (result === 'browser') toast({ tone: 'neutral', title: 'Download started', body: 'Your browser is saving the file to its downloads folder.' })
  } catch (e) {
    toastError(e, "Couldn't save the file")
  }
}

export async function toggleFavorite(item: MediaItem, onDone?: (m: MediaItem) => void) {
  try {
    const m = await api.patchMedia(item.id, { favorite: !item.favorite })
    onDone?.(m)
  } catch (e) {
    toastError(e)
  }
}

export async function shareItem(item: MediaItem) {
  if (item.source_url && 'share' in navigator) {
    try {
      await navigator.share({ title: item.title, url: item.source_url })
    } catch {
      /* user dismissed the share sheet */
    }
  } else if (item.source_url) {
    await navigator.clipboard?.writeText(item.source_url)
    toast({ tone: 'success', title: 'Source link copied' })
  }
}
