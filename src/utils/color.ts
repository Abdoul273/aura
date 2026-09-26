import type { AlbumColors } from "../types"

// Deterministic pseudo-random from a string seed so the same album always
// produces the same palette across reloads.
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

export function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
}

export function paletteFromSeed(seed: string): AlbumColors {
  const rand = seededRandom(seed)
  const baseHue = Math.floor(rand() * 360)
  const accentHue = (baseHue + 40 + Math.floor(rand() * 80)) % 360
  return {
    dominant: hsl(baseHue, 55 + rand() * 25, 45 + rand() * 12),
    accent: hsl(accentHue, 70 + rand() * 20, 58 + rand() * 10),
    muted: hsl(baseHue, 30 + rand() * 15, 22 + rand() * 8),
  }
}

// A CSS mesh-gradient background built from a palette.
export function meshGradient(c: AlbumColors): string {
  return [
    `radial-gradient(at 18% 22%, ${c.accent} 0px, transparent 55%)`,
    `radial-gradient(at 82% 18%, ${c.dominant} 0px, transparent 50%)`,
    `radial-gradient(at 68% 82%, ${c.muted} 0px, transparent 55%)`,
    `radial-gradient(at 25% 78%, ${c.dominant} 0px, transparent 45%)`,
  ].join(", ")
}

export function coverGradient(c: AlbumColors): string {
  return `linear-gradient(135deg, ${c.accent} 0%, ${c.dominant} 55%, ${c.muted} 100%)`
}
