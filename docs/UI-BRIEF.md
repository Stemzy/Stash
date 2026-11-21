# UI brief: "Stash" desktop app (paste this into ChatGPT)

I'm building a Windows desktop app and want help redesigning parts of the **user interface**. Below is a full description of how it looks and works today. Please keep the tech stack, page structure and features the same unless I ask otherwise. Suggest UI/UX changes and, when you write code, write it for this stack: **Electron + React 19 + TypeScript + Tailwind CSS v4 (theme tokens in `@theme`) + Motion for React (`motion/react`) + lucide-react icons**. I've attached screenshots of every page.

---

## 1. What the app does

- **Videos**: paste any video link (YouTube, TikTok, direct .mp4, Dropbox, .m3u8/.mpd streams…), analyze it, pick a resolution (up to 4K+) and container (MP4/MKV), download.
- **Music**: paste a link, pick an audio format (MP3, M4A, Opus, FLAC, WAV) and quality, download the audio.
- **Library**: play downloaded videos and music inside the app.
- **Queue**: active downloads with pause/resume/cancel/reorder.
- **History**: finished/failed/canceled downloads.
- **Settings**: a popup window over the app.

The backend (yt-dlp, FFmpeg) is done and works. **This brief is only about the interface.**

---

## 2. Visual identity ("Graphite")

Calm, premium, dark, desktop-native. Inspired by the Liner desktop app but its own look.

**Avoid:** neon, glowing gradients, oversized pill-shaped cards, generic "admin dashboard" look, heavy shadows, bouncy/playful animation.

### Colors (design tokens)
| Token | Value | Use |
|---|---|---|
| `base` | `#0e0f11` | window background |
| `raised` | `#16181b` | sidebar, panels |
| `overlay` | `rgb(28 30 34 / 0.72)` + backdrop blur | popovers, drawers, toasts |
| `line` | `rgb(255 255 255 / 0.06)` | hairline dividers |
| `line-strong` | `rgb(255 255 255 / 0.12)` | input/panel borders |
| `fg` | `#ecedee` | titles, values |
| `fg-2` | `#9a9da3` | labels, metadata |
| `fg-3` | `#5f636a` | hints, disabled |
| `accent` | `#8fa8c8` (dusty steel blue) | selection, focus, primary emphasis |
| `success` / `warning` / `danger` | `#7fb89a` / `#d4b072` / `#d9817a` | status only, never decoration |

### Shape & type
- Radius: 6px (inputs, buttons), 10px (panels). Settings popup 14px.
- Font: Inter Variable (fallback Segoe UI). Sizes: title 22/28, section 15/20, body 13/18, label 12/16, meta 11/14. Numbers use tabular figures.
- Icons: Lucide, 14–16px, stroke 1.5.
- Motion: short (140–220ms), ease-out, small fades/slides (≈4–8px). Respects Windows "reduce motion" except the moving music/video background.

---

## 3. Window layout

- **Frameless window**, min 960×640. A 36px-tall custom title bar across the top: small app icon + "Stash" on the left, native Windows minimize/maximize/close on the right.
- **Left sidebar**, 176px wide, `raised` at 70% with blur, right hairline border. Items (icon + label), in groups separated by dividers:
  - Videos, Music
  - Library, LAB
  - Queue (shows a small count badge when downloads are active), History
  - Settings pinned at the bottom (opens the popup, doesn't change page)
  - The active item has a subtle filled background that slides between items.
- **Content area**: centered column, max width 880px, padding 32px sides / 28px top. Every page starts with a **page header**: title (22px) + one-line subtitle in `fg-2`.
- **Bottom bars**:
  - On Videos and Music: a slim **queue strip** (≈40px) at the bottom: a status dot + "No active downloads" or the current download's title, progress and speed. Clicking opens a drawer listing the queue.
  - When music is playing: a **music bar** (68px) at the very bottom across the content area: artwork + title/creator on the left; play/previous/next + a scrubber with times in the middle; volume on the right.
- **Toasts**: bottom-right, `overlay` style, stack upward; lift above the music bar when it's visible.
- **Ambient background**: behind Videos, Music and Library the app tints the background using the current item's thumbnail: "Blurred artwork" (default, a heavily blurred, dimmed copy of the thumbnail), "Color glow" (soft blobs of the thumbnail's colors), or Off. In Library, while something plays, the colors slowly drift and pulse with the beat of the music.

---

## 4. Pages

### Videos
1. **Link field**: full-width input with a link icon, a clear (×) button and an **Analyze** button inside the right end. Pasting a link analyzes automatically. Accepts links without https:// and pulls links out of pasted share text.
2. While analyzing: a skeleton of the media card. Errors show as an inline **error banner** (icon, title, one-line explanation, optional action like "Try again").
3. **Media card** (one panel, sections split by hairlines):
   - Top: 16:9 thumbnail (≈160px wide, placeholder icon if none), title, duration + site name, and a small technical line ("Fetches H.264 720p + AAC 128 kbps · merged, no re-encode").
   - **Resolution**: segmented buttons, one per available height (e.g. "2160p · Best", "1440p", "1080p"…). Tags like HDR/60fps when relevant.
   - **Format**: segmented MP4 / MKV.
   - **Save to**: folder field with a folder icon, the path and a **Change** button. (Music also has a **File name** field with the extension shown faintly at the end.)
   - Footer row: summary on the left ("~120 MB · MP4 · to C:\Users\…\Videos"), primary **Download** button on the right.
4. **Recent video downloads**: section heading + "View all" link, then a list of rows (small thumbnail, title, "1080p · MP4 · 2 h ago", status badge).

### Music
Same structure as Videos, with a square thumbnail and audio options:
- Source line: "Source audio MP3 · ~192 kbps · 44.1 kHz · stereo".
- **Format**: MP3 / M4A / Opus / FLAC / WAV.
- **Quality** depends on the format:
  - MP3: Original (no re-encode, only when the source already is MP3) / 128 / 192 / 256 / 320 kbps, each showing an estimated size.
  - M4A and Opus: bitrate presets.
  - FLAC/WAV: sample rate + bit depth (no bitrate).
  - A helper line under it explains the choice honestly (e.g. converting to a higher bitrate doesn't add quality).
- Button reads **Download Audio**.

### Library
- Header row: tabs **Videos (count)** / **Music (count)** as small outlined toggle buttons on the left; on the right, **Play all** (music tab) and a search field ("Search title or creator").
- **Videos tab**: 3-column grid of 16:9 thumbnail cards with the duration in the corner, title below and "MP4 · 1 min ago". Clicking opens the **video player view**: a large player with custom controls that fade out after a few seconds (big center play button, gradient control bar at the bottom with scrubber, time, volume, fullscreen; keyboard Space/K, ←/→, F, M). Below it: title, details, **Show in folder** and **Delete** (with a confirm dialog that deletes the file, the Library item and the History entry).
- **Music tab**: a track list: square artwork (40px), track number, title + creator, format badge (MP3), duration, row actions on hover. Clicking plays it in the music bar.

### Queue
- Subtitle "Up to N at a time. Paused downloads keep their progress."
- Draggable rows (reorder by dragging): thumbnail, title, spec summary, progress bar with percent, speed and time left, status badge, and icon buttons for pause/resume/cancel.
- Empty state: centered icon in a rounded square, "The queue is empty", short text, and **Go to Videos** / **Go to Music** buttons.

### History
- A search field ("Search history") at the top, then a list of finished, failed and canceled downloads, newest first. Each row: thumbnail, title, spec, time, status badge, and actions: **Show in folder**, **Download again** (or **Retry** for failures), **Remove from list**. (Clearing all history lives in Settings → Storage & data.)

### Settings (popup)
- Opens over the app. The whole app behind it is **blurred (14px) and darkened** (`rgb(8 9 10 / 0.55)`). Close with Esc, the × button, or by clicking outside.
- Panel 920×640, `rgb(20 21 24 / 0.78)` with its own blur, 14px radius, thin border.
- **Left column** (≈230px): search box ("Search settings…") on top, then grouped nav: *Interface* → Appearance; *Downloads* → Downloads, Media tools; *Application* → Storage & data, About.
- **Right side**: section title + subtitle, then a bordered card of rows (title, description, control on the right; or stacked for folder pickers).
  - Appearance: Background (Blurred artwork / Color glow / Off), Moving background (toggle).
  - Downloads: Video folder, Music folder, Downloads at the same time (1–4).
  - Media tools: status of yt-dlp / FFmpeg / FFprobe / Deno with versions.
  - Storage & data: Download history (clear button), Where data is kept.
  - About: app name + version, Responsible use note.

---

## 5. Shared components (reuse these)

- **Button**: variants `primary` (filled, slightly lighter surface + accent ring), default (outlined), `ghost`; sizes `sm` / default / `lg`; optional leading icon. **IconButton** for icon-only actions (with tooltip label).
- **SegmentedControl**: row of separate outlined buttons; the selected one gets an accent border and tint. Each option can have a second small line (e.g. "~241 KB", "1920×1080").
- **Select**: custom dropdown with an opaque `#1c1e22` menu.
- **Switch**: small pill toggle.
- **Panel**: `raised`-ish surface, 10px radius, `line-strong` border; sections inside split by hairline `Divider`s.
- **Field**: label (12px, `fg-2`) above a control, optional hint below.
- **Badge**: tiny outlined label (MP3, MP4, 1080p) or status (Completed in green, Failed in red, Paused, Queued).
- **ProgressBar**, **Skeleton** (loading placeholders), **EmptyState** (icon in a rounded square + title + body + actions), **Spinner**, **Scrubber** (seek bar), **ConfirmDialog**, **Toast**.

---

## 6. Rules for any redesign

- Keep it dark, quiet and readable; one accent color; status colors only for status.
- Keep the sidebar + centered content layout unless I ask to change it.
- Don't invent new features; restyle and reorganize what's there.
- Keep keyboard focus states visible and controls at least 28–32px tall.
- When you suggest code, use Tailwind v4 utility classes with the tokens above (`bg-raised`, `text-fg-2`, `border-line`, `text-accent`, `rounded-md`, `text-label`, …) and `motion/react` for animation.

## 7. What I want to change

(Write your requests here, e.g. "Make the Library feel more like a media app", "Redesign the media card on Videos", "Make the sidebar more compact".)
