import { memo } from 'react'
import type { ThemeId } from '@/entities/settings/themes'
import art from '@/assets/bg-wireframe-mask.webp'

// A faint illustration behind the whole app (2000s ambient wallpaper feel).
// The image is a transparency mask filled with the theme's text colour, so it
// is a soft light wireframe on dark themes and soft grey lines on Light, and
// it follows Pink/Ocean's tint. It never takes clicks and never moves.
// Thin lines only, so a little more opacity than a filled picture would need; still very faint.
const OPACITY: Record<ThemeId, number> = { default: 0.13, night: 0.11, light: 0.14, pink: 0.13, ocean: 0.13 }

export const BackgroundArt = memo(function BackgroundArt({ theme }: { theme: ThemeId }) {
  const mask = `url(${art})`
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute bottom-0 right-[-2%] aspect-square h-[min(96%,1100px)] bg-fg transition-opacity duration-500"
        style={{
          opacity: OPACITY[theme],
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'bottom right',
          WebkitMaskPosition: 'bottom right'
        }}
      />
    </div>
  )
})
