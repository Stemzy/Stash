import type { MediaErrorCode } from '../../../shared/types/media'

// Maps yt-dlp's stderr to the plain-language error states the UI shows.
// Order matters: the first match wins.
const RULES: [RegExp, MediaErrorCode][] = [
  [/\bDRM\b|drm protected|This video is DRM/i, 'DRM_PROTECTED'],
  [/Unsupported URL/i, 'UNSUPPORTED_SITE'],
  [/Sign in to confirm|Private video|login required|requires? (?:a )?login|members[- ]only|Join this channel|age[- ]restricted|confirm your age|account (?:is )?required|--cookies/i, 'AUTH_REQUIRED'],
  [/Video unavailable|has been removed|no longer available|not available in your country|geo[- ]?restrict|HTTP Error 404|HTTP Error 410|This video does not exist|copyright claim|terminated/i, 'UNAVAILABLE'],
  [/nsig extraction failed|Signature extraction failed|Unable to extract|Failed to parse JSON|please report this issue|Requested format is not available/i, 'EXTRACTOR_OUTDATED'],
  [/Unable to download (?:webpage|API page|JSON metadata)|getaddrinfo|Name or service not known|timed out|Connection (?:refused|reset)|Network is unreachable|No route to host|Temporary failure in name resolution|SSL|HTTP Error 5\d\d|HTTP Error 429/i, 'NETWORK']
]

export function classifyError(stderrTail: string[]): MediaErrorCode {
  // Judge by yt-dlp's ERROR lines. Warnings like "some formats were skipped as
  // they are DRM protected" must not make a video that has normal formats look
  // copy-protected.
  const errors = stderrTail.filter((l) => /^ERROR\b|\bERROR:/.test(l)).join('\n')
  const text = errors || stderrTail.join('\n')
  for (const [re, code] of RULES) {
    if (code === 'DRM_PROTECTED' && !errors) continue
    if (re.test(text)) return code
  }
  return 'UNKNOWN'
}

/** Keeps only ERROR lines, with URLs and paths trimmed, for the log. */
export function errorDetail(stderrTail: string[]): string {
  return stderrTail
    .filter((l) => /ERROR|error/i.test(l))
    .slice(-3)
    .map((l) => l.replace(/https?:\/\/\S+/g, '<url>').replace(/[A-Za-z]:\\[^\s"']+|\/(?:home|Users)\/[^\s"']+/g, '<path>'))
    .join('\n')
}
