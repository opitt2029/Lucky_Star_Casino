import { describe, test, expect } from 'vitest'
import {
  noteFreq, degreeToMidi, chordToneMidi, chordFreqs, chord,
  PENTATONIC_MAJOR, MAJ, MIN9,
} from './musicTheory'

describe('musicTheory 基礎換算', () => {
  test('noteFreq：A4(69)=440Hz、低八度減半、高八度加倍', () => {
    expect(noteFreq(69)).toBeCloseTo(440)
    expect(noteFreq(57)).toBeCloseTo(220)
    expect(noteFreq(81)).toBeCloseTo(880)
  })

  test('degreeToMidi：度數超出音階長度自動升八度、負度數降八度', () => {
    // C4 宮調五聲：deg 5 = 高八度宮音
    expect(degreeToMidi(60, PENTATONIC_MAJOR, 0)).toBe(60)
    expect(degreeToMidi(60, PENTATONIC_MAJOR, 5)).toBe(72)
    // deg -1 = 低八度的羽音（60 + 9 - 12）
    expect(degreeToMidi(60, PENTATONIC_MAJOR, -1)).toBe(57)
  })

  test('chordToneMidi：組成音繞圈與八度偏移', () => {
    const c = chord(48, MAJ) // C3 大三和弦
    expect(chordToneMidi(c, 0)).toBe(48)
    expect(chordToneMidi(c, 2)).toBe(55) // 五音 G3
    expect(chordToneMidi(c, 3)).toBe(60) // 繞回根音、升八度
    expect(chordToneMidi(c, 0, -1)).toBe(36)
  })

  test('chordFreqs：回傳整組組成音頻率、皆為正有限值', () => {
    const freqs = chordFreqs(chord(45, MIN9))
    expect(freqs).toHaveLength(MIN9.length)
    freqs.forEach((f) => {
      expect(Number.isFinite(f)).toBe(true)
      expect(f).toBeGreaterThan(0)
    })
    expect(freqs[0]).toBeCloseTo(110) // A2
  })
})
