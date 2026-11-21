/** A finished download that still exists on disk and can be played in the app. */
export interface LibraryItem {
  id: string // job id
  kind: 'video' | 'audio'
  title: string
  creator?: string
  durationSec?: number
  thumbnailUrl?: string
  extractor: string
  ext: string
  sizeBytes: number
  addedAt: string
  /** app-media:// URL; served by the main process from the saved file. */
  mediaUrl: string
}
