import { create } from 'zustand'
import { api } from '../lib/api'
import type { Preferences } from '../lib/types'

export const DEFAULT_PREFS: Preferences = {
  max_concurrent: 3,
  default_kind: 'video',
  default_quality: 'h1080',
  default_container: 'mp4',
  default_audio_format: 'mp3',
  default_audio_bitrate: 192,
  filename_template: '%(title)s [%(id)s].%(ext)s',
  subtitles: false,
  subtitle_langs: ['en'],
  embed_metadata: true,
  embed_thumbnail: true,
  skip_duplicates: false,
  download_dir: '',
}

interface PrefsState {
  prefs: Preferences
  loaded: boolean
  load: () => Promise<void>
  save: (patch: Partial<Preferences>) => Promise<Preferences>
}

export const usePrefs = create<PrefsState>((set) => ({
  prefs: DEFAULT_PREFS,
  loaded: false,
  load: async () => {
    const prefs = await api.settings()
    set({ prefs, loaded: true })
  },
  save: async (patch) => {
    const prefs = await api.saveSettings(patch)
    set({ prefs })
    return prefs
  },
}))
