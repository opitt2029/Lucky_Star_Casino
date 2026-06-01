import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import SlotMachine from '../components/SlotMachine'
import { spinSlot } from '../store/slices/gameSlice'
import { setBalance } from '../store/slices/walletSlice'

const betOptions = [100, 500, 1000, 'MAX']
const slotRules = [
  '先在下注面板選擇 100、500、1,000 或 MAX；MAX 會以可用星幣與單局上限 5,000 計算。',
  '按下 SPIN 後會先扣除本局下注，轉輪由左至右停止並顯示結果。',
  '中央橫線三格出現相同符號即為中線命中，派彩會回填到可用星幣。',
  '未命中中線時本局下注不返還；星幣不足時無法開始下一局。',
]
const slotPayouts = [
  { label: '中線命中', value: '2x / 3x / 5x / 8x' },
  { label: '單局下注上限', value: '5,000 星幣' },
]

export default function SlotGame() {
  const dispatch = useDispatch()
  const [selectedBet, setSelectedBet] = useState(100)
  const [visualLock, setVisualLock] = useState(false)
  const balance = useSelector((state) => state.wallet.balance)
  const { status, result, loading, error, slotGrid, winningCells } = useSelector((state) => state.game)
  const resolvedBet = selectedBet === 'MAX' ? Math.max(Math.min(balance, 5000), 100) : selectedBet
  const lastPayout = result?.game === 'slot' ? result.payout : null
  const lastMultiplier = result?.game === 'slot' ? result.multiplier : null
  const payoutCaption =
    lastMultiplier === null ? '等待本局結果' : lastMultiplier > 0 ? `中獎倍率 ${lastMultiplier}x` : '本局未中獎'
  const roundStatus = loading || visualLock ? 'spinning' : status
  const hasLineWin = winningCells.length > 0

  const handleSpinRound = async () => {
    setVisualLock(true)
    try {
      const spinResult = await dispatch(spinSlot({ bet: resolvedBet })).unwrap()
      dispatch(setBalance(spinResult.wallet))
      return spinResult
    } finally {
      window.setTimeout(() => setVisualLock(false), 2900)
    }
  }

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_280px]">
        <SlotMachine grid={slotGrid} winningCells={winningCells} spinning={loading} onSpin={handleSpinRound} />

        <aside className="grid gap-4 content-start">
          <GameRuleCard
            title="星幣老虎機規則"
            subtitle="查看下注、命中線與倍率派彩。"
            rules={slotRules}
            payouts={slotPayouts}
          />
          <MetricCard label="可用星幣" value={balance.toLocaleString()} caption="下注後即時更新" tone="light" />
          <MetricCard label="本局下注" value={resolvedBet.toLocaleString()} caption="最高單局 5,000" />
          <MetricCard
            label="最近派彩"
            value={lastPayout === null ? '-' : lastPayout.toLocaleString()}
            caption={payoutCaption}
          />

          <div className="luxury-panel-soft rounded p-4">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Bet Control</p>
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
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Round</p>
            <div className="mt-3 grid gap-3">
              <div className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-3">
                <span className="text-sm font-bold text-yellow-100/62">狀態</span>
                <span
                  className={[
                    'slot-signal',
                    loading || visualLock ? 'slot-signal--active' : status === 'result' ? 'slot-signal--ready' : 'slot-signal--idle',
                  ].join(' ')}
                >
                  {roundStatus}
                </span>
              </div>
              <div className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-3">
                <span className="text-sm font-bold text-yellow-100/62">中線命中</span>
                <span className={['slot-signal', hasLineWin ? 'slot-signal--win' : 'slot-signal--idle'].join(' ')}>
                  {hasLineWin ? 'YES' : 'NO'}
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
