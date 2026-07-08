export default function FishingControlDock({
  activeAmmo,
  ammoOptions,
  cannonLevel,
  ammoTone,
  canSettle,
  disabledReason,
  isSettling,
  isAmmoLocked = false,
  onAmmoSelect,
  onSettle,
}) {
  const cannonTone = ammoTone || activeAmmo?.tone || 'copper'
  const ammoDisabled = isSettling || isAmmoLocked

  return (
    <div
      className="fishing-control-dock fishing-control-dock--ingame"
      aria-label="捕魚機彈藥與結算控制"
    >
      <div className="fishing-control-dock__title" aria-live="polite">
        <span>本局彈藥：{activeAmmo.label}</span>
        <strong>彈藥金額：{activeAmmo.costPerShot.toLocaleString()} / 發</strong>
      </div>

      <div className="fishing-dock-ammo-group" aria-label="本局彈藥">
        {ammoOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={ammoDisabled}
            onClick={() => onAmmoSelect?.(option)}
            aria-pressed={cannonLevel === option.level}
            className={`fishing-dock-ammo fishing-dock-ammo--${option.tone}`}
            title={
              ammoDisabled
                ? '本局彈藥已鎖定'
                : `${option.description}，每發 ${option.costPerShot.toLocaleString()} 星幣`
            }
          >
            <span className="fishing-dock-ammo__badge">{option.badge}</span>
            <strong>{option.label}</strong>
            <span>彈藥金額 {option.costPerShot.toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div
        className={`fishing-dock-cannon-bay fishing-dock-cannon-bay--${cannonTone}`}
        aria-label="砲台狀態"
      >
        <span>砲台</span>
        <strong>Lv {cannonLevel}</strong>
        <small>本局固定火力</small>
      </div>

      <button
        type="button"
        onClick={onSettle}
        disabled={!canSettle || isSettling}
        className="fishing-stage-settle fishing-stage-settle--dock"
        aria-label="結算並離開漁場"
        title={disabledReason || '結算並離開漁場'}
      >
        <strong>{isSettling ? '結算中' : '結算'}</strong>
        <span>{canSettle ? '帶回星幣' : '至少完成一發射擊'}</span>
      </button>
    </div>
  )
}
