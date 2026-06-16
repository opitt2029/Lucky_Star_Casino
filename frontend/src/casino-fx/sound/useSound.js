import { useCallback, useEffect, useState } from 'react'
import { soundEngine } from './SoundEngine'

// React 端音效介面：play 穩定參考可放進 useCallback 依賴；settings 跟引擎雙向同步。
export function useSound() {
  const [settings, setSettings] = useState(() => soundEngine.getSettings())

  useEffect(() => soundEngine.subscribe(setSettings), [])

  const play = useCallback((id, opts) => soundEngine.play(id, opts), [])

  return {
    play,
    settings,
    toggleSfx: useCallback(() => soundEngine.toggleSfx(), []),
    toggleBgm: useCallback(() => soundEngine.toggleBgm(), []),
    setVolume: useCallback((volume) => soundEngine.updateSettings({ volume }), []),
  }
}
