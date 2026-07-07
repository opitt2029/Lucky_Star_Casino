export default function FishingFullscreenButton({ isFullscreen, disabled, message, onToggle }) {
  const label = isFullscreen ? '離開全屏' : '全屏遊玩'

  return (
    <button
      type="button"
      className="fishing-canvas__fullscreen-button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={isFullscreen}
      title={message || label}
    >
      <span className="fishing-canvas__fullscreen-icon" aria-hidden="true">
        {isFullscreen ? '↙' : '↗'}
      </span>
      <span>{label}</span>
    </button>
  )
}
