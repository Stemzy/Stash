// Motion rules from the plan: 120–180ms for small changes, 220ms for drawers
// and dialogs, 400ms for the ambient background crossfade. Only opacity and
// transform animate; nothing loops except the active progress bar.

const easeOut = [0.22, 1, 0.36, 1] as const

export const t = {
  fast: { duration: 0.14, ease: easeOut },
  base: { duration: 0.18, ease: easeOut },
  panel: { duration: 0.22, ease: easeOut },
  backdrop: { duration: 0.4, ease: easeOut }
}

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 }
}
