import type { JobErrorCode } from './types/job'

/** One plain-language line per failure, shown on the job row. */
export const JOB_ERROR_TEXT: Record<JobErrorCode, string> = {
  INVALID_URL: "That doesn't look like a link.",
  UNSUPPORTED_SITE: "This site isn't supported.",
  DRM_PROTECTED: "This media is copy-protected (DRM). For your own uploads, use the site's creator download option.",
  AUTH_REQUIRED: 'This media needs you to be signed in.',
  UNAVAILABLE: "This media isn't available anymore.",
  NETWORK: "Couldn't reach the site. Check your connection and retry.",
  EXTRACTOR_OUTDATED: 'The site changed and yt-dlp needs an update. Go to Settings → Media tools → Check now, then retry.',
  PLAYLIST: "Playlists aren't supported yet.",
  LIVE: "Live streams can't be downloaded while they're live.",
  NO_MEDIA: 'No audio was found in this download.',
  TOOLS_MISSING: 'Media tools are missing. Reinstall Stash, or check Settings → Media tools.',
  ENCRYPTED: "Mega links are encrypted and can't be downloaded here.",
  CANCELED: 'Canceled.',
  UNKNOWN: 'Something went wrong. Try again.',
  FFMPEG: "FFmpeg couldn't process the media.",
  DISK: "Can't write to this folder. Choose another one or free up space.",
  DISK_FULL: 'The drive is full. Free up some space, or choose a folder on another drive.',
  FOLDER_BLOCKED:
    "Windows blocked Stash from saving here. If Ransomware protection is on, allow Stash in Windows Security (Controlled folder access), or choose another download folder in Settings.",
  FOLDER_MISSING: "The download folder doesn't exist anymore. Choose a folder in Settings → Downloads.",
  OUTPUT_CHECK: "The finished file didn't pass the quality check, so it wasn't saved."
}
