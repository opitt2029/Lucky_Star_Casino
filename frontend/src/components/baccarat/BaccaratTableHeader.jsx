import InfoHint from '../InfoHint'

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
          <span>
            本場損益
            <InfoHint title="本場損益" align="right">
              這次進入牌桌後的累計盈虧，離開頁面就重新計算，
              <strong>不是</strong>你的錢包餘額。正數代表目前贏、負數代表目前輸。
            </InfoHint>
          </span>
          <strong className={sessionProfit === null ? '' : sessionProfit >= 0 ? 'is-positive' : 'is-negative'}>
            {sessionProfitText}
          </strong>
        </div>
      </div>

      <div className="baccarat-table-header__actions">
        <InfoHint title="咪牌" align="right">
          開啟後發牌不會直接翻開，你可以長按牌面一點一點把牌搓開（賭場常見的「咪牌」儀式），
          也可以按「直接開牌」跳過。<strong>只影響開牌演出，不影響輸贏結果</strong>——
          勝負在伺服器發牌當下就已決定。
        </InfoHint>
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
