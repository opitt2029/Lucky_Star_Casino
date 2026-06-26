import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import SlotMachine from '../components/SlotMachine'
import { spinSlot, clearGameResult } from '../store/slices/gameSlice'
import { setBalance } from '../store/slices/walletSlice'
import { soundEngine } from '../casino-fx/sound/SoundEngine'
import { useBgm } from '../casino-fx/sound/useBgm'
import GoldBurst from '../casino-fx/fx/GoldBurst'
import { CoinRainPro, RedEnvelopeRain } from '../casino-fx/fx/FallRain'
import BrushBanner, { pickBannerForMultiplier } from '../casino-fx/fx/BrushBanner'
import LuckyAura from '../casino-fx/fx/LuckyAura'
import { useLuckyAura } from '../casino-fx/fx/useLuckyAura'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

const betOptions = [100, 500, 1000, 'MAX']
const slotRules = [
  '先在下注面板選擇 100、500、1,000 或 MAX；MAX 會以可用星幣與單局上限 5,000 計算。',
  '按下 SPIN 後會先扣除本局下注，轉輪由左至右停止並顯示結果。',
  '中線由左到右計算：三格同符號為「三連」大獎，僅左二格同符號為「左二同」小獎。',
  '派彩 = 下注 × 倍率（含本金）；右二格相同不算中獎，未中獎時本局下注不返還。',
]
const slotPayouts = [
  { label: '三連大獎', value: '🍒5x 🍋8x 🔔18x ⭐50x 7️⃣70x' },
  { label: '左二同小獎', value: '🍒1x 🍋1x 🔔2x ⭐3x 7️⃣5x' },
  { label: '單局下注上限', value: '5,000 星幣' },
]

export default function SlotGame() {
  const dispatch = useDispatch()
  const [selectedBet, setSelectedBet] = useState(100)
  const [visualLock, setVisualLock] = useState(false)
  const [sessionProfit, setSessionProfit] = useState(null)
  const [sessionRounds, setSessionRounds] = useState(0)
  // 本局結算快照：只在輪停（handleSettled）才更新，讓側欄派彩/命中與轉輪同步揭曉，
  // 避免直接讀 redux result/winningCells（thunk 一回應就寫入）造成結果比動畫早 ~2 秒劇透。
  const [settled, setSettled] = useState(null)
  // 慶祝特效觸發器（遞增數字觸發一次性特效）
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })
  const balance = useSelector((state) => state.wallet.balance)
  const player = useSelector((state) => state.auth.player)
  const { status, loading, error, slotGrid, winningCells } = useSelector((state) => state.game)
  const aura = useLuckyAura()
  useBgm('slot')
  const resolvedBet = selectedBet === 'MAX' ? Math.max(Math.min(balance, 5000), 100) : selectedBet
  const canAfford = balance >= resolvedBet
  // 側欄結果一律讀「已結算快照」（輪停才更新），不直接讀 redux，避免動畫未停就揭曉結果。
  const lastPayout = settled ? settled.payout : null
  const lastMultiplier = settled ? settled.multiplier : null
  const payoutCaption =
    lastMultiplier === null ? '開始一局後顯示結果' : lastMultiplier > 0 ? `中獎倍率 ${lastMultiplier}x` : '本局未中獎'
  const roundStatus = loading || visualLock ? 'spinning' : status
  const hasLineWin = (settled?.winningCells?.length ?? 0) > 0
  useGameLeaveGuard(loading || visualLock, '轉輪進行中，確定要離開嗎？離開後本局下注不返還。')

  // 「重開即歸零」：進場時清掉上一場殘留的結果與最近派彩；本場損益/局數/結算快照為元件狀態，隨進場歸零。
  useEffect(() => {
    dispatch(clearGameResult())
    setSettled(null)
  }, [dispatch])

  const handleSpinRound = async () => {
    // 餘額不足直接擋下，不發任何請求（後端仍是最後防線）。
    if (balance < resolvedBet) return null
    const betAtSpin = resolvedBet
    setVisualLock(true)
    // 注意：視覺鎖（visualLock）的解除統一交給 SlotMachine 的 onSpinComplete，
    // 它綁定 runReels 動畫的真實生命週期（成功/失敗/中止各路徑都會呼叫）。
    // 不要在此用固定 setTimeout 解鎖——near-miss 慢停動畫長達 3.5s，會比動畫早解鎖造成脫鉤（AGENTS 雷區 13）。
    // 結算副作用（餘額/損益/局數/快照）一律延到 handleSettled（輪停）才套用，與轉輪同步揭曉、避免劇透。
    return dispatch(spinSlot({ bet: betAtSpin })).unwrap()
  }

  // 轉輪演出結束的瞬間引爆慶祝（音效 + 大字報 + 金幣特效，依倍率分級）。
  // LDW 原則：payout > 0 一律播贏錢音效（即使派彩低於下注，也讓大腦記住「有進帳」）。
  const handleSettled = (spinResult) => {
    if (!spinResult || spinResult.game !== 'slot') return
    const multiplier = spinResult.multiplier ?? 0
    const payout = spinResult.payout ?? 0
    const won = payout > 0

    // 輪停瞬間才套用結算：揭曉派彩/命中、更新餘額與本場損益，與轉輪畫面同步。
    setSettled({ payout, multiplier, winningCells: spinResult.winningCells ?? [] })
    dispatch(setBalance(spinResult.wallet))
    setSessionProfit((prev) => (prev ?? 0) + payout - (spinResult.bet ?? 0))
    setSessionRounds((prev) => prev + 1)

    aura.reportRound(won)
    if (!won) return

    const bannerPick = pickBannerForMultiplier(multiplier)
    setBanner((prev) => ({ trigger: prev.trigger + 1, ...bannerPick }))
    setBurstTrigger((n) => n + 1)

    if (multiplier >= 8) {
      // 爆機級：鑼 + 長琶音、遮屏金幣瀑布、紅包雨、全服喜報
      soundEngine.play('winEpic')
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
      <LuckyAura active={aura.auraActive} />
      <GoldBurst trigger={burstTrigger} origin={{ x: 38, y: 48 }} />
      <CoinRainPro trigger={coinTrigger} density={coinDensity} />
      <RedEnvelopeRain trigger={envelopeTrigger} density="heavy" />
      <BrushBanner trigger={banner.trigger} text={banner.text} level={banner.level} />
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_280px]">
        <SlotMachine
          grid={slotGrid}
          winningCells={winningCells}
          spinning={loading}
          canSpin={canAfford && !visualLock}
          onSpin={handleSpinRound}
          onSettled={handleSettled}
          onSpinComplete={() => setVisualLock(false)}
        />

        <aside className="grid gap-4 content-start">
          <MetricCard label="可用星幣" value={balance.toLocaleString()} caption="下注後即時更新" tone="light" />
          <GameRuleCard
            title="星幣老虎機規則"
            subtitle="了解如何下注、判定中獎與計算派彩。"
            rules={slotRules}
            payouts={slotPayouts}
          />
          <MetricCard label="本局下注" value={resolvedBet.toLocaleString()} caption="最高單局 5,000" />
          {!canAfford && (
            <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              星幣不足，請先儲值後再開始本局。
            </p>
          )}
          <MetricCard
            label="最近派彩"
            value={lastPayout === null ? '-' : lastPayout.toLocaleString()}
            caption={payoutCaption}
          />
          <MetricCard
            label="本場損益"
            value={
              sessionProfit === null
                ? '-'
                : sessionProfit >= 0
                  ? `+${sessionProfit.toLocaleString()}`
                  : sessionProfit.toLocaleString()
            }
            caption={sessionProfit === null ? '開始第一局後開始記錄' : `本場共 ${sessionRounds} 局`}
            valueClass={sessionProfit === null ? '' : sessionProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}
          />
          <div className="luxury-panel-soft rounded p-4">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Bet</p>
            <h3 className="brand-title mt-1 text-xl font-black">下注面板</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {betOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelectedBet(option)}
                  className={[
                    'min-h-14 rounded border px-3 text-sm font-black transition',
                    selectedBet === option
                      ? 'gold-button'
                      : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60 hover:text-yellow-100',
                  ].join(' ')}
                >
                  {option === 'MAX' ? 'MAX' : option.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="luxury-panel-soft rounded p-4">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Round Status</p>
            <div className="mt-3 grid gap-3">
              <div className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-3">
                <span className="text-sm font-bold text-yellow-100/62">狀態</span>
                <span
                  className={[
                    'slot-signal',
                    loading || visualLock ? 'slot-signal--active' : status === 'result' ? 'slot-signal--ready' : 'slot-signal--idle',
                  ].join(' ')}
                >
                  {roundStatus === 'spinning' ? '轉動中' : roundStatus === 'result' ? '已結算' : '待開始'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-3">
                <span className="text-sm font-bold text-yellow-100/62">中線命中</span>
                <span className={['slot-signal', hasLineWin ? 'slot-signal--win' : 'slot-signal--idle'].join(' ')}>
                  {hasLineWin ? '命中' : '未命中'}
                </span>
              </div>
            </div>
          </div>

          {error && <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}
        </aside>
      </section>
    </AppShell>
  )
}
