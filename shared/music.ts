// Note names, scales and key spelling. Spelling follows the letter names of
// the scale (E♭ major is E♭ F G A♭ B♭ C D, never D# F G G#…).

import type { KeyMode } from './types/lab'

export type Spelling = 'sharp' | 'flat'

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]
export const SCALE_STEPS: Record<KeyMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10] // natural minor
}

const mod12 = (n: number) => ((n % 12) + 12) % 12

/** Pitch classes that are commonly written two ways (C♯/D♭…). */
export const isEnharmonicRoot = (pc: number) => [1, 3, 6, 8, 10].includes(mod12(pc))

export interface NoteName {
  letter: string
  /** -2..2: ♭♭ ♭ natural ♯ 𝄪 */
  accidental: number
}

const ACC_TEXT: Record<number, [string, string]> = {
  [-2]: ['bb', '𝄫'],
  [-1]: ['b', '♭'],
  0: ['', ''],
  1: ['#', '♯'],
  2: ['x', '𝄪']
}

/** "E♭" for display, or "Eb" when `ascii` (for copying and file names). */
export function noteText(n: NoteName, ascii = false): string {
  return n.letter + (ACC_TEXT[n.accidental] ?? ['', ''])[ascii ? 0 : 1]
}

/** Name of a root pitch class with the chosen spelling. */
export function rootName(pc: number, spelling: Spelling): NoteName {
  pc = mod12(pc)
  const natural = LETTER_PC.indexOf(pc)
  if (natural >= 0) return { letter: LETTERS[natural]!, accidental: 0 }
  if (spelling === 'sharp') return { letter: LETTERS[LETTER_PC.indexOf(pc - 1)]!, accidental: 1 }
  return { letter: LETTERS[LETTER_PC.indexOf(mod12(pc + 1))]!, accidental: -1 }
}

/** The seven notes of a key, spelled from its root letter. */
export function scaleNotes(tonic: number, mode: KeyMode, spelling: Spelling): { pc: number; name: NoteName }[] {
  const root = rootName(tonic, spelling)
  const li = LETTERS.indexOf(root.letter as (typeof LETTERS)[number])
  return SCALE_STEPS[mode].map((step, d) => {
    const pc = mod12(tonic + step)
    const letter = (li + d) % 7
    let acc = mod12(pc - LETTER_PC[letter]!)
    if (acc > 6) acc -= 12
    return { pc, name: { letter: LETTERS[letter]!, accidental: acc } }
  })
}

/** Accidentals in the key signature for this spelling (lower is easier to read). */
function signatureWeight(tonic: number, mode: KeyMode, spelling: Spelling): number {
  return scaleNotes(tonic, mode, spelling).reduce((s, n) => s + Math.abs(n.name.accidental) * (Math.abs(n.name.accidental) > 1 ? 3 : 1), 0)
}

/** The conventional spelling: fewest accidentals (F♯ major, E♭ minor on a tie). */
export function defaultSpelling(tonic: number, mode: KeyMode): Spelling {
  if (!isEnharmonicRoot(tonic)) {
    // Natural roots: the key's own signature decides (F major uses B♭, so flats).
    return signatureWeight(tonic, mode, 'flat') < signatureWeight(tonic, mode, 'sharp') ? 'flat' : 'sharp'
  }
  const s = signatureWeight(tonic, mode, 'sharp')
  const f = signatureWeight(tonic, mode, 'flat')
  if (s !== f) return s < f ? 'sharp' : 'flat'
  return mode === 'major' ? 'sharp' : 'flat'
}

export const modeLabel = (m: KeyMode) => (m === 'major' ? 'Major' : 'Minor')

export function keyName(k: { tonic: number; mode: KeyMode }, spelling?: Spelling, ascii = false): string {
  return `${noteText(rootName(k.tonic, spelling ?? defaultSpelling(k.tonic, k.mode)), ascii)} ${modeLabel(k.mode)}`
}

/** Name for any pitch class inside a key's context: scale spelling when it belongs, else the key's accidental direction. */
export function pcNameInKey(pc: number, key: { tonic: number; mode: KeyMode } | undefined, spelling?: Spelling): NoteName {
  if (!key) return rootName(pc, 'sharp')
  const sp = spelling ?? defaultSpelling(key.tonic, key.mode)
  const inScale = scaleNotes(key.tonic, key.mode, sp).find((n) => n.pc === mod12(pc))
  if (inScale) return inScale.name
  const flats = scaleNotes(key.tonic, key.mode, sp).some((n) => n.name.accidental < 0)
  return rootName(pc, flats ? 'flat' : 'sharp')
}

/** The relative key: same notes, other tonal center (C minor ↔ E♭ major). */
export function relativeOf(k: { tonic: number; mode: KeyMode }): { tonic: number; mode: KeyMode } {
  return k.mode === 'minor' ? { tonic: mod12(k.tonic + 3), mode: 'major' } : { tonic: mod12(k.tonic - 3), mode: 'minor' }
}
