import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import SlotMachine from '../components/SlotMachine'
import InfoHint from '../components/InfoHint'
import WinningTicker from '../components/WinningTicker'
import { spinSlot, clearGameResult } from '../store/slices/gameSlice'
import { setBalance } from '../store/slices/walletSlice'
import { soundEngine } from '../casino-fx/sound/SoundEngine'
import { useBgm } from '../casino-fx/sound/useBgm'
import GoldBurst from '../casino-fx/fx/GoldBurst'
import { CoinRainPro, RedEnvelopeRain } from '../casino-fx/fx/FallRain'
import BrushBanner, { pickBannerForMultiplier } from '../casino-fx/fx/BrushBanner'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

const betOptions = [100, 500, 1000, 'MAX']

const slotRules = [
  '選擇下注額後按下 SPIN。MAX 會依目前餘額取最高 5,000 星幣。',
  '每局先扣下注額，再由三個轉輪揭露結果。',
  '中線三連相同為主要派彩，左二同也會依符號給小獎。',
  '派彩金額已含本金，餘額會在轉輪動畫結束後同步更新。',
]

const slotPayouts = [
  { label: '三連', value: '依符號 5x / 8x / 18x / 40x / 70x' },
  { label: '大獎', value: '紅 7 三連 70x' },
  { label: '左二同', value: '依符號 1x / 2x / 5x' },
  { label: '單局上限', value: '5,000 星幣' },
]

function formatCoins(value) {
  return Number(value || 0).toLocaleString()
}

export default function SlotGame() {
  const dispatch = useDispatch()
  const fullscreenTargetRef = useRef(null)
  const [selectedBet, setSelectedBet] = useState(100)
  const [visualLock, setVisualLock] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenMessage, setFullscreenMessage] = useState('')
  const [sessionProfit, setSessionProfit] = useState(null)
  const [sessionRounds, setSessionRounds] = useState(0)
  const [settled, setSettled] = useState(null)
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })
  const [shaking, setShaking] = useState(false)

  const balance = useSelector((state) => state.wallet.balance)
  const player = useSelector((state) => state.auth.player)
  const { status, loading, error, slotGrid, winningCells } = useSelector((state) => state.game)
  const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)

  useBgm('slot', true, { intensity: loading || visualLock ? 2 : 1 })

  const syncFullscreenState = (active) => {
    const fullscreenTarget = fullscreenTargetRef.current
    setIsFullscreen(active)
    fullscreenTarget?.classList.toggle('slot-game-surface--fullscreen', active)
    if (!active) fullscreenTarget?.classList.remove('slot-game-surface--fullscreen-entering')
    document.body.classList.toggle('slot-fullscreen-active', active)
  }

  const resolvedBet = selectedBet === 'MAX' ? Math.max(Math.min(balance, 5000), 100) : selectedBet
  const canAfford = balance >= resolvedBet
  const lastPayout = settled ? settled.payout : null
  const lastMultiplier = settled ? settled.multiplier : null
  const payoutCaption =
    lastMultiplier === null ? '尚未完成本局' : lastMultiplier > 0 ? `中線倍率 ${lastMultiplier}x` : '本局未中獎'
  const roundStatus = loading || visualLock ? 'spinning' : status
  const hasLineWin = (settled?.winningCells?.length ?? 0) > 0
  const topAwardHit = (settled?.multiplier ?? 0) >= 70 && (settled?.winningCells?.length ?? 0) === 3
  const sessionProfitLabel =
    sessionProfit === null
      ? '-'
      : sessionProfit >= 0
        ? `+${formatCoins(sessionProfit)}`
        : formatCoins(sessionProfit)
  const sessionProfitTone = sessionProfit === null ? '' : sessionProfit >= 0 ? 'slot-mini-metric--up' : 'slot-mini-metric--down'
  const flowLabel = roundStatus === 'spinning' ? '轉動中' : roundStatus === 'result' ? '已結算' : '待下注'

  useGameLeaveGuard(loading || visualLock, '老虎機正在轉動，離開頁面可能會中斷視覺結算。')

  useEffect(() => {
    dispatch(clearGameResult())
    setSettled(null)
  }, [dispatch])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const handleFullscreenChange = () => {
      syncFullscreenState(document.fullscreenElement === fullscreenTargetRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    const fullscreenTarget = fullscreenTargetRef.current
    document.body.classList.toggle('slot-fullscreen-active', isFullscreen)
    return () => {
      document.body.classList.remove('slot-fullscreen-active')
      fullscreenTarget?.classList.remove('slot-game-surface--fullscreen')
      fullscreenTarget?.classList.remove('slot-game-surface--fullscreen-entering')
    }
  }, [isFullscreen])

  const handleToggleFullscreen = async () => {
    const target = fullscreenTargetRef.current
    if (!fullscreenSupported || !target) {
      setFullscreenMessage('此瀏覽器不支援全螢幕模式')
      return
    }

    try {
      setFullscreenMessage('')
      if (document.fullscreenElement === target) {
        syncFullscreenState(false)
        await document.exitFullscreen()
      } else {
        target.classList.add('slot-game-surface--fullscreen-entering')
        syncFullscreenState(true)
        await target.requestFullscreen()
        target.classList.remove('slot-game-surface--fullscreen-entering')
      }
    } catch {
      target.classList.remove('slot-game-surface--fullscreen-entering')
      syncFullscreenState(document.fullscreenElement === target)
      setFullscreenMessage('無法切換全螢幕，請再試一次')
    }
  }

  const handleSpinRound = async () => {
    if (balance < resolvedBet) return null
    const betAtSpin = resolvedBet
    setSettled(null)
    setVisualLock(true)
    return dispatch(spinSlot({ bet: betAtSpin })).unwrap()
  }

  const handleSettled = (spinResult) => {
    if (!spinResult || spinResult.game !== 'slot') return

    const multiplier = spinResult.multiplier ?? 0
    const payout = spinResult.payout ?? 0
    const won = payout > 0

    setSettled({ payout, multiplier, winningCells: spinResult.winningCells ?? [] })
    dispatch(setBalance(spinResult.wallet))
    setSessionProfit((prev) => (prev ?? 0) + payout - (spinResult.bet ?? 0))
    setSessionRounds((prev) => prev + 1)

    if (!won) return

    const bannerPick = pickBannerForMultiplier(multiplier)
    setBanner((prev) => ({ trigger: prev.trigger + 1, ...bannerPick }))
    setBurstTrigger((n) => n + 1)

    if (multiplier >= 8) {
      soundEngine.play('winEpic')
      setShaking(true)
      setCoinDensity('epic')
      setCoinTrigger((n) => n + 1)
      setEnvelopeTrigger((n) => n + 1)
      announcePlayerWin({
        playerName: player?.nickname || player?.username,
        game: 'slot',
        amount: payout,
      })
    } else if (multiplier >= 3) {
      soundEngine.play('winBig')
      setCoinDensity('heavy')
      setCoinTrigger((n) => n + 1)
    } else {
      soundEngine.play('winSmall')
      setCoinDensity('light')
      setCoinTrigger((n) => n + 1)
    }
  }

  return (
    <AppShell>
      <GoldBurst trigger={burstTrigger} origin={{ x: 38, y: 48 }} />
      <CoinRainPro trigger={coinTrigger} density={coinDensity} />
      <RedEnvelopeRain trigger={envelopeTrigger} density="heavy" />
      <BrushBanner trigger={banner.trigger} text={banner.text} level={banner.level} />
      <WinningTicker game="slot" />

      <section
        ref={fullscreenTargetRef}
        className={[
          'slot-game-surface slot-game-surface--single-screen',
          isFullscreen ? 'slot-game-surface--fullscreen' : '',
        ].join(' ')}
      >
        <div className="slot-game-topbar">
          <div>
            <p className="slot-game-topbar__eyebrow">Lucky Star Deluxe</p>
            <h2 className="slot-game-topbar__title">星幣老虎機</h2>
          </div>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            disabled={!fullscreenSupported}
            className="slot-fullscreen-button"
            aria-pressed={isFullscreen}
            title={fullscreenMessage || (isFullscreen ? '離開全螢幕' : '進入全螢幕')}
          >
            {isFullscreen ? '離開全螢幕' : '全螢幕'}
          </button>
        </div>
        {fullscreenMessage && <p className="slot-fullscreen-message">{fullscreenMessage}</p>}

        <div className="slot-game-layout">
          <div
            className={['slot-game-machine', shaking ? 'slot-shake' : ''].join(' ')}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              setShaking(false)
            }}
          >
            <SlotMachine
              fullscreen={isFullscreen}
              fitToContainer
              jackpotHit={topAwardHit}
              winAmount={lastPayout ?? 0}
              winMultiplier={lastMultiplier ?? 0}
              grid={slotGrid}
              winningCells={winningCells}
              spinning={loading}
              canSpin={canAfford && !visualLock}
              onSpin={handleSpinRound}
              onSettled={handleSettled}
              onSpinComplete={() => setVisualLock(false)}
            />
          </div>

          <aside className="slot-game-control-panel">
            <div className="slot-dashboard-strip" aria-label="老虎機即時資訊">
              <div className="slot-mini-metric slot-mini-metric--light">
                <span>錢包</span>
                <strong>{formatCoins(balance)}</strong>
                <small>星幣</small>
              </div>
              <div className="slot-mini-metric">
                <span>下注</span>
                <strong>{formatCoins(resolvedBet)}</strong>
                <small>最高 5,000</small>
              </div>
              <div className="slot-mini-metric">
                <span>派彩</span>
                <strong>{lastPayout === null ? '-' : formatCoins(lastPayout)}</strong>
                <small>{payoutCaption}</small>
              </div>
              <div className={['slot-mini-metric', sessionProfitTone].filter(Boolean).join(' ')}>
                <span>本場</span>
                <strong>{sessionProfitLabel}</strong>
                <small>{sessionProfit === null ? '尚未開始' : sessionRounds + ' 局'}</small>
              </div>
            </div>

            {!canAfford && (
              <p className="slot-inline-alert">
                星幣不足，請降低下注或先儲值。
              </p>
            )}

            <div className="slot-bet-panel luxury-panel-soft rounded p-3">
              <div className="slot-panel-heading">
                <div>
                  <p className="gold-muted text-xs font-black uppercase">Bet</p>
                  <h3 className="brand-title text-lg font-black">下注面額</h3>
                </div>
                <InfoHint title="下注面額" align="right">
                  每按一次 SPIN 要扣掉的星幣。<strong>MAX</strong> 會用目前餘額能下的最大注，上限 5,000 星幣。
                </InfoHint>
              </div>
              <div className="slot-bet-options">
                {betOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedBet(option)}
                    disabled={loading || visualLock}
                    className={[
                      'slot-bet-chip',
                      selectedBet === option ? 'slot-bet-chip--active' : '',
                    ].join(' ')}
                  >
                    {option === 'MAX' ? 'MAX' : formatCoins(option)}
                  </button>
                ))}
              </div>
            </div>

            <div className="slot-status-panel luxury-panel-soft rounded p-3">
              <div className="slot-panel-heading">
                <div>
                  <p className="gold-muted text-xs font-black uppercase">Round</p>
                  <h3 className="brand-title text-lg font-black">本局狀態</h3>
                </div>
                <InfoHint title="本局狀態" align="right">
                  流程顯示待下注、轉動中或已結算；中線命中代表本局產生得分組合。
                </InfoHint>
              </div>
              <div className="slot-status-grid">
                <div>
                  <span>流程</span>
                  <strong className={['slot-signal', loading || visualLock ? 'slot-signal--active' : status === 'result' ? 'slot-signal--ready' : 'slot-signal--idle'].join(' ')}>{flowLabel}</strong>
                </div>
                <div>
                  <span>中線</span>
                  <strong className={['slot-signal', hasLineWin ? 'slot-signal--win' : 'slot-signal--idle'].join(' ')}>
                    {hasLineWin ? '命中' : '未命中'}
                  </strong>
                </div>
              </div>
            </div>

            <GameRuleCard
              title="老虎機規則"
              subtitle="三轉輪中線判定，下注後由動畫結算同一局結果。"
              rules={slotRules}
              payouts={slotPayouts}
            />

            {error && <p className="slot-inline-alert">{error}</p>}
          </aside>
        </div>
      </section>
    </AppShell>
  )
}
