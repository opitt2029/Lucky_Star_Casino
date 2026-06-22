import { useState, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import SlotMachine from '../components/SlotMachine'
import { spinSlot } from '../store/slices/gameSlice'
import { setBalance } from '../store/slices/walletSlice'
import { soundEngine } from '../casino-fx/sound/SoundEngine'
import { useBgm } from '../casino-fx/sound/useBgm'
import GoldBurst from '../casino-fx/fx/GoldBurst'
import { CoinRainPro, RedEnvelopeRain } from '../casino-fx/fx/FallRain'
import BrushBanner, { pickBannerForMultiplier } from '../casino-fx/fx/BrushBanner'
import LuckyAura from '../casino-fx/fx/LuckyAura'
import FortuneMeter from '../casino-fx/fx/FortuneMeter'
import { useFortuneMeter } from '../casino-fx/fx/useFortuneMeter'
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
  // 慶祝特效觸發器（遞增數字觸發一次性特效）
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })
  const balance = useSelector((state) => state.wallet.balance)
  const player = useSelector((state) => state.auth.player)
  const { status, result, loading, error, slotGrid, winningCells } = useSelector((state) => state.game)
  const fortune = useFortuneMeter('slot', player?.id)
  // 記錄本次轉動發出時幸運值是否已滿（在 addCharge 前讀取，防止 addCharge 的非同步 setState 污染判斷）
  const fortuneReadyOnSpinRef = useRef(false)
  useBgm('slot')
  const resolvedBet = selectedBet === 'MAX' ? Math.max(Math.min(balance, 5000), 100) : selectedBet
  const canAfford = balance >= resolvedBet
  const lastPayout = result?.game === 'slot' ? result.payout : null
  const lastMultiplier = result?.game === 'slot' ? result.multiplier : null
  const payoutCaption =
    lastMultiplier === null ? '開始一局後顯示結果' : lastMultiplier > 0 ? `中獎倍率 ${lastMultiplier}x` : '本局未中獎'
  const roundStatus = loading || visualLock ? 'spinning' : status
  const hasLineWin = winningCells.length > 0
  useGameLeaveGuard(loading || visualLock, '轉輪進行中，確定要離開嗎？離開後本局下注不返還。')

  const handleSpinRound = async () => {
    // 餘額不足直接擋下，不發任何請求（後端仍是最後防線）。
    if (balance < resolvedBet) return null
    setVisualLock(true)
    fortuneReadyOnSpinRef.current = fortune.full
    fortune.addCharge(resolvedBet)
    try {
      const spinResult = await dispatch(spinSlot({ bet: resolvedBet, fortuneReady: fortune.full })).unwrap()
      dispatch(setBalance(spinResult.wallet))
      return spinResult
    } finally {
      window.setTimeout(() => setVisualLock(false), 2900)
    }
  }

  // 轉輪演出結束的瞬間引爆慶祝（音效 + 大字報 + 金幣特效，依倍率分級）。
  // LDW 原則：payout > 0 一律播贏錢音效（即使派彩低於下注，也讓大腦記住「有進帳」）。
  const handleSettled = (spinResult) => {
    if (!spinResult || spinResult.game !== 'slot') return
    const multiplier = spinResult.multiplier ?? 0
    const payout = spinResult.payout ?? 0
    const won = payout > 0
    fortune.reportRound(won, fortuneReadyOnSpinRef.current)
    if (!won) return

    const bannerPick = spinResult.guaranteed
      ? { text: '幸運保底觸發！', level: 3 }
      : pickBannerForMultiplier(multiplier)
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
      <LuckyAura active={fortune.auraActive} />
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
          <GameRuleCard
            title="星幣老虎機規則"
            subtitle="了解如何下注、判定中獎與計算派彩。"
            rules={slotRules}
            payouts={slotPayouts}
          />
          <MetricCard label="可用星幣" value={balance.toLocaleString()} caption="下注後即時更新" tone="light" />
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
          <FortuneMeter value={fortune.value} />

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
