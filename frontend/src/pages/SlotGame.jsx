import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import SlotMachine from '../components/SlotMachine'
import InfoHint from '../components/InfoHint'
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

  const resolvedBet = selectedBet === 'MAX' ? Math.max(Math.min(balance, 5000), 100) : selectedBet
  const canAfford = balance >= resolvedBet
  const lastPayout = settled ? settled.payout : null
  const lastMultiplier = settled ? settled.multiplier : null
  const payoutCaption =
    lastMultiplier === null ? '尚未完成本局' : lastMultiplier > 0 ? `中線倍率 ${lastMultiplier}x` : '本局未中獎'
  const roundStatus = loading || visualLock ? 'spinning' : status
  const hasLineWin = (settled?.winningCells?.length ?? 0) > 0

  useGameLeaveGuard(loading || visualLock, '老虎機正在轉動，離開頁面可能會中斷視覺結算。')

  useEffect(() => {
    dispatch(clearGameResult())
    setSettled(null)
  }, [dispatch])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === fullscreenTargetRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('slot-fullscreen-active', isFullscreen)
    return () => document.body.classList.remove('slot-fullscreen-active')
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
        await document.exitFullscreen()
      } else {
        await target.requestFullscreen()
      }
    } catch {
      setFullscreenMessage('無法切換全螢幕，請再試一次')
    }
  }

  const handleSpinRound = async () => {
    if (balance < resolvedBet) return null
    const betAtSpin = resolvedBet
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

      <section
        ref={fullscreenTargetRef}
        className={[
          'slot-game-surface',
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
            <span aria-hidden="true">{isFullscreen ? '[]' : '[ ]'}</span>
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
            <MetricCard label="錢包星幣" value={formatCoins(balance)} caption="下注前餘額" tone="light" />
            <GameRuleCard
              title="老虎機規則"
              subtitle="三轉輪中線判定，下注後由動畫結算同一局結果。"
              rules={slotRules}
              payouts={slotPayouts}
            />
            <MetricCard label="本局下注" value={formatCoins(resolvedBet)} caption="單局最高 5,000" />
            {!canAfford && (
              <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                星幣不足，請降低下注或先儲值。
              </p>
            )}
            <MetricCard
              label="最近派彩"
              value={lastPayout === null ? '-' : formatCoins(lastPayout)}
              caption={payoutCaption}
              hint={(
                <InfoHint title="最近派彩" align="right">
                  上一局實際拿回的星幣，<strong>已含本金</strong>。所以「中線倍率 2x」＝拿回下注額的兩倍，
                  淨賺一倍；倍率 1x 等於剛好打平。沒中獎時為 0。
                </InfoHint>
              )}
            />
            <MetricCard
              label="本次遊玩損益"
              value={
                sessionProfit === null
                  ? '-'
                  : sessionProfit >= 0
                    ? `+${formatCoins(sessionProfit)}`
                    : formatCoins(sessionProfit)
              }
              caption={sessionProfit === null ? '尚未開始' : `已完成 ${sessionRounds} 局`}
              valueClass={sessionProfit === null ? '' : sessionProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}
            />

            <div className="slot-bet-panel luxury-panel-soft rounded p-4">
              <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Bet</p>
              <h3 className="brand-title mt-1 flex items-center gap-2 text-xl font-black">
                下注面額
                <InfoHint title="下注面額" align="right">
                  每按一次 SPIN 要扣掉的星幣。<strong>MAX</strong> 不是固定金額，而是「用目前餘額能下的最大注」，
                  上限 5,000 星幣；餘額不足 5,000 時就以餘額為準。注額越大，中獎時派彩也等比放大。
                </InfoHint>
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {betOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedBet(option)}
                    disabled={loading || visualLock}
                    className={[
                      'min-h-14 rounded border px-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50',
                      selectedBet === option
                        ? 'gold-button'
                        : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60 hover:text-yellow-100',
                    ].join(' ')}
                  >
                    {option === 'MAX' ? 'MAX' : formatCoins(option)}
                  </button>
                ))}
              </div>
            </div>

            <div className="slot-status-panel luxury-panel-soft rounded p-4">
              <p className="gold-muted flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em]">
                Round Status
                <InfoHint title="本局狀態" align="right">
                  「流程」顯示這一局走到哪：待下注 → 轉動中 → 已結算；轉動中時不能改注額。
                  「中線結果」則是這局中間那條線有沒有連成得分組合——命中才會有派彩。
                </InfoHint>
              </p>
              <div className="mt-3 grid gap-3">
                <div className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-3">
                  <span className="text-sm font-bold text-yellow-100/62">流程</span>
                  <span
                    className={[
                      'slot-signal',
                      loading || visualLock ? 'slot-signal--active' : status === 'result' ? 'slot-signal--ready' : 'slot-signal--idle',
                    ].join(' ')}
                  >
                    {roundStatus === 'spinning' ? '轉動中' : roundStatus === 'result' ? '已結算' : '待下注'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-3">
                  <span className="text-sm font-bold text-yellow-100/62">中線結果</span>
                  <span className={['slot-signal', hasLineWin ? 'slot-signal--win' : 'slot-signal--idle'].join(' ')}>
                    {hasLineWin ? '命中' : '未命中'}
                  </span>
                </div>
              </div>
            </div>

            {error && <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}
          </aside>
        </div>
      </section>
    </AppShell>
  )
}
