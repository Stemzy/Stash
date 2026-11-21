// Turns cloud "share" page links into links yt-dlp can download directly.
// Dropbox, Google Drive and Box already have yt-dlp extractors, so they pass
// through unchanged. Pure function: no I/O.

export type ShareLink = { url: string; note?: string } | { blocked: 'ENCRYPTED' }

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')

export function rewriteShareLink(input: string): ShareLink {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return { url: input }
  }
  const host = u.hostname.toLowerCase()

  // Mega encrypts files in the browser; there is no plain download URL to fetch.
  if (host === 'mega.nz' || host.endsWith('.mega.nz') || host === 'mega.io') return { blocked: 'ENCRYPTED' }

  // Personal OneDrive (1drv.ms short links and onedrive.live.com share pages):
  // the public shares API redirects straight to the file.
  if (host === '1drv.ms' || host === 'onedrive.live.com') {
    if (u.pathname.includes('/shares/')) return { url: input }
    return { url: `https://api.onedrive.com/v1.0/shares/u!${b64url(input)}/root/content`, note: 'onedrive' }
  }

  // OneDrive for work/school and SharePoint share links: ?download=1 returns the file.
  if (host.endsWith('.sharepoint.com') && /\/:[a-z]:\//i.test(u.pathname)) {
    u.searchParams.set('download', '1')
    return { url: u.toString(), note: 'sharepoint' }
  }

  return { url: input }
}

/** "My%20Song.mp3" or a Content-Disposition name → "My Song". */
export function titleFromFilename(name: string): string {
  let n = name
  try {
    n = decodeURIComponent(name)
  } catch {
    /* keep raw */
  }
  return n.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Reads the file name from a Content-Disposition header (RFC 6266, incl. filename*=UTF-8''…). */
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/)
  return (plain?.[1] ?? plain?.[2])?.trim() || undefined
}
