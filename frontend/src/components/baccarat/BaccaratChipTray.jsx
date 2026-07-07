const chips = [100, 200, 500, 1000, 2000, 3000, 5000]

export default function BaccaratChipTray({
  amount,
  disabled,
  canSubmit,
  submitLabel,
  clearDisabled,
  repeatDisabled,
  doubleDisabled,
  hint,
  onAmountChange,
  onChipSelect,
  onClear,
  onRepeat,
  onDouble,
  onSubmit,
}) {
  return (
    <section className="baccarat-chip-tray" aria-label="下注操作列">
      <div className="baccarat-chip-tray__chips">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onChipSelect(chip)}
            disabled={disabled}
            className={['baccarat-chip', Number(amount) === chip ? 'baccarat-chip--selected' : ''].join(' ')}
          >
            {chip.toLocaleString()}
          </button>
        ))}
      </div>

      <div className="baccarat-chip-tray__controls">
        <label className="baccarat-field">
          <span>自訂金額</span>
          <input
            type="number"
            min="100"
            max="5000"
            step="1"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            disabled={disabled}
            className="baccarat-bet-input"
            placeholder="100 ~ 5000"
          />
        </label>

        <div className="baccarat-chip-tray__buttons">
          <button type="button" onClick={onClear} disabled={disabled || clearDisabled} className="baccarat-secondary-button">
            清除下注
          </button>
          <button type="button" onClick={onRepeat} disabled={disabled || repeatDisabled} className="baccarat-secondary-button">
            重複上局
          </button>
          <button type="button" onClick={onDouble} disabled={disabled || doubleDisabled} className="baccarat-secondary-button">
            加倍下注
          </button>
          <button type="button" onClick={onSubmit} disabled={!canSubmit} className="baccarat-action-button">
            {submitLabel}
          </button>
        </div>
      </div>

      {hint && <p className="baccarat-chip-tray__hint">{hint}</p>}
    </section>
  )
}
