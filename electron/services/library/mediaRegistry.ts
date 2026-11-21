// Files LAB opened that the app:// player may serve, keyed by a random token.
// Only the main process adds entries, after validating the path.
export const labMedia = new Map<string, string>()
export const LAB_MEDIA_HOST = 'lab'
