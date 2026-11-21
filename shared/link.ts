// Turns whatever the user pasted into a link the app can try:
// - "youtube.com/watch?v=x" or "www.tiktok.com/@a/video/1" → adds https://
// - "Check this out! https://youtu.be/x 🔥" (share text) → picks out the link
// - <https://…>, "https://…", trailing ")" or "." → cleaned up
// Returns null when there's no link in it at all.

const TRAILING = /[)\].,;:!?'"»”’>]+$/

export function normalizeLinkInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null

  // A full link anywhere in the text (share messages often wrap it in words).
  const found = text.match(/https?:\/\/[^\s<>"'`]+/i)
  if (found) return found[0].replace(TRAILING, '')

  // No scheme: accept things that look like a host name, with an optional port and path.
  const bare = text.replace(/^[<"'(]+/, '').replace(TRAILING, '')
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(bare) || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#]\S*)?$/.test(bare)) {
    return `https://${bare}`
  }
  return null
}

/**
 * Common address typos that make a link fail ("ww.youtube.com", "wwww.", ".con").
 * Returns the corrected link, or null when nothing looks wrong.
 */
export function suggestLinkFix(link: string): string | null {
  let u: URL
  try {
    u = new URL(link)
  } catch {
    return null
  }
  const host = u.hostname
  let fixed = host
  if (/^ww\.(?!w)/i.test(host)) fixed = `www.${host.slice(3)}`
  else if (/^w{4,}\./i.test(host)) fixed = host.replace(/^w{4,}\./i, 'www.')
  if (/\.(con|cmo|ocm|cpm)$/i.test(fixed)) fixed = fixed.replace(/\.(con|cmo|ocm|cpm)$/i, '.com')
  if (fixed === host) return null
  u.hostname = fixed
  return u.toString()
}
