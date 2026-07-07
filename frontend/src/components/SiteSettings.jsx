import { useEffect, useId, useState } from 'react'
import { useSound } from '../casino-fx/sound/useSound'
import { useSitePreferences } from '../utils/sitePreferences'
import './SiteSettings.css'

const text = {
  openSettings: '\u958b\u555f\u8a2d\u5b9a',
  closeSettings: '\u95dc\u9589\u8a2d\u5b9a',
  title: '\u7db2\u7ad9\u8a2d\u5b9a',
  volume: '\u97f3\u91cf',
  sfx: '\u97f3\u6548',
  music: '\u97f3\u6a02',
  announcements: '\u5168\u7db2\u516c\u544a\u6548\u679c',
  background: '\u7db2\u7ad9\u80cc\u666f\u6548\u679c',
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="site-settings__icon">
      <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
      <path d="m19.4 13.5 1.2.9-1.8 3.1-1.5-.6a7.5 7.5 0 0 1-1.8 1l-.2 1.6h-3.6l-.2-1.6a7.5 7.5 0 0 1-1.8-1l-1.5.6-1.8-3.1 1.2-.9a7.6 7.6 0 0 1 0-2l-1.2-.9 1.8-3.1 1.5.6a7.5 7.5 0 0 1 1.8-1l.2-1.6h3.6l.2 1.6a7.5 7.5 0 0 1 1.8 1l1.5-.6 1.8 3.1-1.2.9a7.6 7.6 0 0 1 0 2Z" />
    </svg>
  )
}

function ToggleRow({ id, label, checked, onChange }) {
  return (
    <label className="site-settings__toggle-row" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="site-settings__switch" aria-hidden="true" />
    </label>
  )
}

export default function SiteSettings() {
  const [open, setOpen] = useState(false)
  const { play, settings, toggleSfx, toggleBgm, setVolume } = useSound()
  const [preferences, updatePreferences] = useSitePreferences()
  const volumeId = useId()
  const sfxId = useId()
  const bgmId = useId()
  const announcementsId = useId()
  const backgroundId = useId()

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const handleToggle = () => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (next) play('click')
      return next
    })
  }

  return (
    <div className="site-settings">
      <button
        type="button"
        className="site-settings__trigger"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={text.openSettings}
        title={text.title}
      >
        <GearIcon />
      </button>

      {open && (
        <>
          <button type="button" className="site-settings__scrim" aria-label={text.closeSettings} onClick={() => setOpen(false)} />
          <section className="site-settings__dialog" role="dialog" aria-modal="true" aria-labelledby="site-settings-title">
            <div className="site-settings__header">
              <div>
                <p>Settings</p>
                <h2 id="site-settings-title">{text.title}</h2>
              </div>
              <button type="button" className="site-settings__close" onClick={() => setOpen(false)} aria-label={text.closeSettings}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="site-settings__group">
              <label className="site-settings__volume" htmlFor={volumeId}>
                <span>{text.volume}</span>
                <strong>{Math.round(settings.volume * 100)}%</strong>
              </label>
              <input
                id={volumeId}
                className="site-settings__range"
                type="range"
                min="0"
                max="100"
                value={Math.round(settings.volume * 100)}
                onChange={(event) => setVolume(Number(event.target.value) / 100)}
              />

              <ToggleRow
                id={sfxId}
                label={text.sfx}
                checked={settings.sfxEnabled}
                onChange={() => {
                  toggleSfx()
                  play('click')
                }}
              />
              <ToggleRow
                id={bgmId}
                label={text.music}
                checked={settings.bgmEnabled}
                onChange={() => {
                  toggleBgm()
                  play('click')
                }}
              />
            </div>

            <div className="site-settings__group">
              <ToggleRow
                id={announcementsId}
                label={text.announcements}
                checked={preferences.announcementsEnabled}
                onChange={(announcementsEnabled) => updatePreferences({ announcementsEnabled })}
              />
              <ToggleRow
                id={backgroundId}
                label={text.background}
                checked={preferences.backgroundEffectsEnabled}
                onChange={(backgroundEffectsEnabled) => updatePreferences({ backgroundEffectsEnabled })}
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}