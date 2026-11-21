import type { JobErrorCode } from './types/job'

/** One plain-language line per failure, shown on the job row. */
export const JOB_ERROR_TEXT: Record<JobErrorCode, string> = {
  INVALID_URL: "That doesn't look like a link.",
  UNSUPPORTED_SITE: "This site isn't supported.",
  DRM_PROTECTED: "This media is copy-protected (DRM). For your own uploads, use the site's creator download option.",
  AUTH_REQUIRED: 'This media needs you to be signed in.',
  UNAVAILABLE: "This media isn't available anymore.",
  NETWORK: "Couldn't reach the site. Check your connection and retry.",
  EXTRACTOR_OUTDATED: 'The site changed. Run npm run fetch-binaries to update yt-dlp, then retry.',
  PLAYLIST: "Playlists aren't supported yet.",
  LIVE: "Live streams can't be downloaded while they're live.",
  NO_MEDIA: 'No audio was found in this download.',
  TOOLS_MISSING: 'Media tools are missing. Run npm run fetch-binaries.',
  ENCRYPTED: "Mega links are encrypted and can't be downloaded here.",
  CANCELED: 'Canceled.',
  UNKNOWN: 'Something went wrong. Try again.',
  FFMPEG: "FFmpeg couldn't process the media.",
  DISK: "Can't write to this folder. Choose another one or free up space.",
  OUTPUT_CHECK: "The finished file didn't pass the quality check, so it wasn't saved."
}
