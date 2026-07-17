const phaseLabels = {
  idle: '等待下注',
  betting: '下注中',
  dealing: '發牌中',
  squeezing: '等待咪牌',
  settled: '本局結算',
}

export default function BaccaratTableHeader({
  phase,
  balance,
  roundCount,
  sessionProfit,
  squeezeMode,
  onToggleSqueeze,
  onFullscreen,
  isFullscreen,
}) {
  const sessionProfitText =
    sessionProfit === null
      ? '-'
      : `${sessionProfit >= 0 ? '+' : '-'}${Math.abs(sessionProfit).toLocaleString()}`

  return (
    <header className="baccarat-table-header">
      <div className="baccarat-table-header__title">
        <p>VIP Table 08</p>
        <h2>
          Baccarat <span>百家樂</span>
        </h2>
      </div>

      <div className="baccarat-table-header__metrics">
        <div className="baccarat-table-header__status">
          <span>遊戲狀態</span>
          <strong>{phaseLabels[phase] || '等待下注'}</strong>
        </div>
        <div>
          <span>可用星幣</span>
          <strong>{Number(balance || 0).toLocaleString()}</strong>
        </div>
        <div>
          <span>本場局數</span>
          <strong>{roundCount}</strong>
        </div>
        <div>
          <span>本場損益</span>
          <strong className={sessionProfit === null ? '' : sessionProfit >= 0 ? 'is-positive' : 'is-negative'}>
            {sessionProfitText}
          </strong>
        </div>
      </div>

      <div className="baccarat-table-header__actions">
        <button
          type="button"
          onClick={onToggleSqueeze}
          className={['baccarat-squeeze-toggle', squeezeMode ? 'baccarat-squeeze-toggle--on' : ''].join(' ')}
          aria-pressed={squeezeMode}
        >
          {squeezeMode ? '咪牌：開' : '咪牌：關'}
        </button>
        <button type="button" onClick={onFullscreen} className="baccarat-squeeze-toggle" aria-pressed={isFullscreen}>
          {isFullscreen ? '退出全螢幕' : '全螢幕'}
        </button>
      </div>
    </header>
  )
}
