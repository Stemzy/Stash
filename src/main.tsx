import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './app/styles/global.css'
import { App } from './app/App'
import { runSplash } from './app/splash'

// Files dropped anywhere except a drop zone do nothing (instead of opening in the window).
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    e.preventDefault()
    if (e.dataTransfer && !(e.target as Element | null)?.closest?.('[data-dropzone]')) e.dataTransfer.dropEffect = 'none'
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* "user" = follow the Windows reduce-motion setting */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>
)

void runSplash()
