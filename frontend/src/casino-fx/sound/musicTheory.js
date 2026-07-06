// 音樂理論基礎表：MIDI→頻率、音階、和弦。純資料＋純函式（不碰 Web Audio），
// 供 bgmThemes / bgmComposer 使用，可獨立單元測試。
//
// 為什麼用 MIDI 編號而不是直接寫頻率：音高運算（升降八度、音階度數換算）在
// MIDI 整數域是加減法，換成頻率才需要指數運算，資料表因此可讀可驗證。

// MIDI 編號 → 頻率（A4 = 69 = 440Hz，十二平均律）
export function noteFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// ---- 音階（相對根音的半音偏移）----
export const PENTATONIC_MAJOR = [0, 2, 4, 7, 9] // 宮調五聲：宮商角徵羽（中式喜慶）
export const PENTATONIC_MINOR = [0, 3, 5, 7, 10] // 五聲小調（Boss 緊張感）
export const AEOLIAN = [0, 2, 3, 5, 7, 8, 10] // 自然小調（lounge / 深海）

// ---- 和弦品質（組成音的半音音程集合）----
export const MAJ = [0, 4, 7]
export const MIN = [0, 3, 7]
export const MAJ7 = [0, 4, 7, 11]
export const MIN7 = [0, 3, 7, 10]
export const MIN9 = [0, 3, 7, 10, 14]
export const DOM7 = [0, 4, 7, 10]
export const POWER = [0, 7, 12] // 強力和弦（無三音，重低壓迫感）

// 建立和弦：根音 MIDI + 品質音程集合
export function chord(rootMidi, intervals) {
  return { root: rootMidi, intervals }
}

// 音階度數 → MIDI。degree 可為負或超出音階長度，自動升降八度：
// degreeToMidi(60, PENTATONIC_MAJOR, 5) === 72（第 5 度 = 高八度的宮音）
export function degreeToMidi(rootMidi, scale, degree) {
  const len = scale.length
  const idx = ((degree % len) + len) % len
  const octaveShift = Math.floor(degree / len)
  return rootMidi + scale[idx] + octaveShift * 12
}

// 和弦組成音第 degree 個 → MIDI（同樣支援超出組成音數自動升八度）
export function chordToneMidi(chordSpec, degree, octave = 0) {
  const iv = chordSpec.intervals
  const idx = ((degree % iv.length) + iv.length) % iv.length
  const octaveShift = Math.floor(degree / iv.length)
  return chordSpec.root + iv[idx] + (octave + octaveShift) * 12
}

// 整組和弦組成音 → 頻率陣列（給 pad 鋪和聲用）
export function chordFreqs(chordSpec, octave = 0) {
  return chordSpec.intervals.map((iv) => noteFreq(chordSpec.root + iv + octave * 12))
}
