// BGM 宣告式編曲資料：每主題 = bpm + swing + 8 小節和弦進行 + 多音軌 pattern。
// 純資料（不碰 Web Audio），由 bgmComposer.computeStepEvents 解讀成音符事件。
//
// 音軌（track）欄位：
//   inst         預設樂器（BGM_INSTRUMENTS 的鍵；音符可用 inst 覆寫）
//   mode         'perc' 無音高｜'chord' 度數指向當小節和弦組成音｜'scale' 度數指向主題音階
//   minIntensity 0=永遠播｜1=一般強度起｜2=高潮才進來（轉輪中/發牌中疊上去的層）
//   every        每小節重複的 pattern：{ 步序(0~15): [音符…] }
//   bars         逐小節樂句（長度必須 === bars，休息小節填 null）
// 音符（note）欄位：
//   deg 度數（'all'=整組和弦，給 pad）｜oct 八度偏移｜dur 時值（拍）｜vol 音量｜
//   prob 觸發機率（0~1，氣泡這類「偶發」點綴用）｜pitch 無音高打擊樂的音高係數
import {
  PENTATONIC_MAJOR, PENTATONIC_MINOR, AEOLIAN,
  MAJ, MIN, MAJ7, MIN7, MIN9, DOM7, POWER, chord,
} from './musicTheory'

export const BGM_THEMES = {
  // 老虎機：C 宮調五聲、96bpm 喜慶律動。C–Am–F–G 進行（華語流行最耐聽的循環），
  // 旋律限定五聲音階所以永遠「中式且不刺耳」；intensity 2（轉輪中）疊高音琶音層。
  slot: {
    bpm: 96,
    swing: 0.06,
    bars: 8,
    root: 60, // C4：旋律音域中心
    scale: PENTATONIC_MAJOR,
    progression: [
      chord(48, MAJ), chord(45, MIN), chord(41, MAJ), chord(43, MAJ),
      chord(48, MAJ), chord(45, MIN), chord(41, MAJ), chord(43, DOM7),
    ],
    ambience: [
      { filterType: 'lowpass', freq: 420, gain: 0.03, lfoRate: 0.07, lfoDepth: 0.5 }, // 賭場室內底噪
      { filterType: 'bandpass', freq: 1250, q: 0.8, gain: 0.012, lfoRate: 0.13, lfoDepth: 0.7 }, // 遠處人聲低鳴
    ],
    tracks: {
      percussion: {
        inst: 'kick',
        mode: 'perc',
        every: {
          0: [{ vol: 0.5 }],
          4: [{ inst: 'shaker', vol: 0.3 }],
          8: [{ vol: 0.35 }],
          10: [{ inst: 'shaker', vol: 0.16, prob: 0.7 }],
          12: [{ inst: 'shaker', vol: 0.3 }],
        },
      },
      bass: {
        inst: 'bassPluck',
        mode: 'chord',
        every: {
          0: [{ deg: 0, oct: -1, dur: 1.5, vol: 0.5 }],
          6: [{ deg: 2, oct: -1, dur: 0.5, vol: 0.3 }],
          8: [{ deg: 0, oct: -1, dur: 1, vol: 0.4 }],
          12: [{ deg: 1, oct: -1, dur: 1, vol: 0.35 }],
        },
      },
      pad: {
        inst: 'pad',
        mode: 'chord',
        every: { 0: [{ deg: 'all', dur: 4, vol: 0.55 }] },
      },
      melody: {
        inst: 'pluckLead',
        mode: 'scale',
        minIntensity: 1,
        bars: [
          { 0: [{ deg: 2, dur: 1, vol: 0.3 }], 4: [{ deg: 3, vol: 0.28 }], 6: [{ deg: 4, vol: 0.28 }], 8: [{ deg: 3, dur: 1, vol: 0.3 }], 12: [{ deg: 2, dur: 1, vol: 0.28 }] },
          null,
          { 0: [{ deg: 4, dur: 1, vol: 0.3 }], 4: [{ deg: 5, vol: 0.3 }], 8: [{ deg: 4, vol: 0.28 }], 10: [{ deg: 3, vol: 0.26 }], 12: [{ deg: 2, dur: 1.5, vol: 0.3 }] },
          null,
          { 0: [{ deg: 2, dur: 1, vol: 0.3 }], 4: [{ deg: 3, vol: 0.28 }], 6: [{ deg: 4, vol: 0.28 }], 8: [{ deg: 3, dur: 1, vol: 0.3 }], 12: [{ deg: 2, dur: 1, vol: 0.28 }] },
          null,
          { 0: [{ deg: 2, vol: 0.28 }], 2: [{ deg: 3, vol: 0.28 }], 4: [{ deg: 4, dur: 1, vol: 0.3 }], 8: [{ deg: 5, dur: 2, vol: 0.32 }] },
          { 0: [{ deg: 4, vol: 0.28 }], 4: [{ deg: 3, vol: 0.26 }], 8: [{ deg: 1, dur: 2, vol: 0.3 }] },
        ],
      },
      sparkle: {
        inst: 'pluckLead',
        mode: 'scale',
        minIntensity: 2,
        every: {
          0: [{ deg: 5, oct: 1, vol: 0.14 }],
          2: [{ deg: 6, oct: 1, vol: 0.12 }],
          4: [{ deg: 7, oct: 1, vol: 0.14 }],
          6: [{ deg: 8, oct: 1, vol: 0.12 }],
          8: [{ deg: 9, oct: 1, vol: 0.14 }],
          10: [{ deg: 8, oct: 1, vol: 0.12 }],
          12: [{ deg: 7, oct: 1, vol: 0.14 }],
          14: [{ deg: 6, oct: 1, vol: 0.12 }],
        },
      },
    },
  },

  // 百家樂：A 小調 lounge、72bpm、重 swing。Am9–Dm7–Fmaj7–E7 慢和聲、刷鼓氣聲、
  // 顫音琴偶發動機——「貴氣不吵」；發牌/咪牌時（intensity 2）加輕柔 ride 推進。
  baccarat: {
    bpm: 72,
    swing: 0.12,
    bars: 8,
    root: 69, // A4
    scale: AEOLIAN,
    progression: [
      chord(45, MIN9), chord(50, MIN7), chord(53, MAJ7), chord(52, DOM7),
      chord(45, MIN9), chord(50, MIN7), chord(53, MAJ7), chord(52, DOM7),
    ],
    ambience: [
      { filterType: 'lowpass', freq: 380, gain: 0.028, lfoRate: 0.06, lfoDepth: 0.4 },
      { filterType: 'bandpass', freq: 1150, q: 0.9, gain: 0.01, lfoRate: 0.11, lfoDepth: 0.7 },
    ],
    tracks: {
      percussion: {
        inst: 'brushHat',
        mode: 'perc',
        every: {
          4: [{ vol: 0.22 }],
          12: [{ vol: 0.22 }],
          14: [{ vol: 0.1, prob: 0.6 }],
        },
      },
      bass: {
        inst: 'bassPluck',
        mode: 'chord',
        every: {
          0: [{ deg: 0, oct: -1, dur: 2, vol: 0.45 }],
          8: [{ deg: 2, oct: -1, dur: 1.5, vol: 0.3 }],
        },
      },
      pad: {
        inst: 'pad',
        mode: 'chord',
        every: { 0: [{ deg: 'all', dur: 4, vol: 0.5 }] },
      },
      melody: {
        inst: 'softLead',
        mode: 'scale',
        minIntensity: 1,
        bars: [
          null,
          { 4: [{ deg: 4, dur: 1, vol: 0.25 }], 8: [{ deg: 2, dur: 2, vol: 0.22 }] },
          null,
          { 8: [{ deg: 6, dur: 1.5, vol: 0.22 }], 12: [{ deg: 5, dur: 1, vol: 0.2 }] },
          null,
          { 0: [{ deg: 7, dur: 1, vol: 0.24 }], 4: [{ deg: 6, dur: 1, vol: 0.22 }], 8: [{ deg: 4, dur: 2, vol: 0.22 }] },
          null,
          { 8: [{ deg: 0, dur: 3, vol: 0.2 }] },
        ],
      },
      ride: {
        inst: 'ride',
        mode: 'perc',
        minIntensity: 2,
        every: {
          2: [{ vol: 0.12 }],
          6: [{ vol: 0.12 }],
          10: [{ vol: 0.12 }],
          14: [{ vol: 0.12 }],
        },
      },
    },
  },

  // 捕魚機：A 自然小調、64bpm 深海氛圍。極慢 attack 的 pad drone + sub-bass 脈動 +
  // 機率性氣泡點綴，沒有主旋律——沉浸靠「空間感」不靠旋律搶戲。
  fishing: {
    bpm: 64,
    swing: 0,
    bars: 8,
    root: 57, // A3
    scale: AEOLIAN,
    progression: [
      chord(45, MIN9), chord(45, MIN9), chord(41, MAJ7), chord(41, MAJ7),
      chord(48, MAJ7), chord(48, MAJ7), chord(43, MAJ), chord(43, MAJ),
    ],
    ambience: [
      { filterType: 'lowpass', freq: 250, gain: 0.045, lfoRate: 0.055, lfoDepth: 0.6 }, // 深海水體湧動
    ],
    tracks: {
      pad: {
        inst: 'pad',
        mode: 'chord',
        every: { 0: [{ deg: 'all', dur: 4, vol: 0.6, attack: 2.2, release: 2.4, cutoff: 750 }] },
      },
      bass: {
        inst: 'bassPluck',
        mode: 'chord',
        every: {
          0: [{ deg: 0, oct: -1, dur: 3, vol: 0.4 }],
          8: [{ deg: 0, oct: -1, dur: 1.5, vol: 0.26, prob: 0.6 }],
        },
      },
      bubbles: {
        inst: 'bubble',
        mode: 'perc',
        every: {
          3: [{ vol: 0.16, pitch: 0.9, prob: 0.16 }],
          7: [{ vol: 0.14, pitch: 1.15, prob: 0.14 }],
          11: [{ vol: 0.15, pitch: 0.75, prob: 0.16 }],
          14: [{ vol: 0.12, pitch: 1.3, prob: 0.12 }],
        },
      },
      shimmer: {
        inst: 'softLead',
        mode: 'scale',
        minIntensity: 1,
        bars: [
          null, null,
          { 8: [{ deg: 7, oct: 1, dur: 2, vol: 0.1 }] },
          null, null, null,
          { 4: [{ deg: 9, oct: 1, dur: 2, vol: 0.1 }] },
          null,
        ],
      },
    },
  },

  // Boss 降臨：A 五聲小調、132bpm。保留原版大鼓＋嗩吶 DNA，加低音 ostinato 與
  // 低頻 pad 撐住壓迫感；恆為高強度（minIntensity 全 0/1，無需 intensity 2 層）。
  boss: {
    bpm: 132,
    swing: 0,
    bars: 8,
    root: 57, // A3
    scale: PENTATONIC_MINOR,
    progression: [
      chord(45, POWER), chord(45, POWER), chord(45, POWER), chord(45, POWER),
      chord(48, POWER), chord(48, POWER), chord(43, POWER), chord(43, POWER),
    ],
    ambience: [
      { filterType: 'lowpass', freq: 300, gain: 0.025, lfoRate: 0.3, lfoDepth: 0.5 },
    ],
    tracks: {
      percussion: {
        inst: 'kick',
        mode: 'perc',
        every: {
          0: [{ vol: 0.6 }],
          2: [{ vol: 0.25 }],
          4: [{ vol: 0.45, pitch: 1.25 }],
          6: [{ vol: 0.25 }],
          8: [{ vol: 0.6 }],
          10: [{ vol: 0.25 }],
          12: [{ vol: 0.45, pitch: 1.25 }],
          14: [{ vol: 0.3, pitch: 1.5 }],
        },
      },
      bass: {
        inst: 'bassPluck',
        mode: 'chord',
        every: {
          0: [{ deg: 0, oct: -1, dur: 0.5, vol: 0.5 }],
          2: [{ deg: 0, oct: -1, dur: 0.5, vol: 0.38 }],
          4: [{ deg: 1, oct: -1, dur: 0.5, vol: 0.45 }],
          6: [{ deg: 0, oct: -1, dur: 0.5, vol: 0.38 }],
          8: [{ deg: 0, oct: -1, dur: 0.5, vol: 0.5 }],
          10: [{ deg: 0, oct: -1, dur: 0.5, vol: 0.38 }],
          12: [{ deg: 1, oct: -1, dur: 0.5, vol: 0.45 }],
          14: [{ deg: 2, oct: -1, dur: 0.5, vol: 0.4 }],
        },
      },
      pad: {
        inst: 'pad',
        mode: 'chord',
        every: { 0: [{ deg: 'all', oct: 0, dur: 4, vol: 0.4, cutoff: 620 }] },
      },
      horn: {
        inst: 'horn',
        mode: 'scale',
        minIntensity: 1,
        bars: [
          null,
          { 8: [{ deg: 4, oct: 1, dur: 1, vol: 0.3 }], 12: [{ deg: 5, oct: 1, dur: 1, vol: 0.28 }] },
          null,
          { 8: [{ deg: 4, oct: 1, dur: 1, vol: 0.3 }], 12: [{ deg: 5, oct: 1, dur: 1, vol: 0.28 }] },
          null,
          { 8: [{ deg: 7, oct: 1, dur: 1.5, vol: 0.3 }] },
          null,
          { 8: [{ deg: 7, oct: 1, dur: 1.5, vol: 0.3 }], 12: [{ deg: 9, oct: 1, dur: 1, vol: 0.26 }] },
        ],
      },
    },
  },
}
