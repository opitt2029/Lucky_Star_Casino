import MetricCard from './MetricCard'

export default function FishingSettlementPanel({
  settleResult,
  sessionBuyIn,
  children,
  onNewRound,
}) {
  const profit = sessionBuyIn === null ? settleResult.credited - settleResult.buyIn : settleResult.credited - sessionBuyIn
  const caughtCount = settleResult.caughtCount ?? 0

  return (
    <div className="grid gap-4">
      <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">已結算</p>
      <h3 className="brand-title text-3xl font-black text-yellow-100">本局收網完成</h3>
      <div className="grid grid-cols-2 gap-3 text-left">
        <MetricCard label="本局消耗" value={settleResult.totalBet.toLocaleString()} />
        <MetricCard label="捕獲數量" value={`${caughtCount.toLocaleString()} 尾`} />
        <MetricCard label="獲得獎金" value={settleResult.totalPayout.toLocaleString()} tone="light" />
        <MetricCard label="回到錢包" value={settleResult.credited.toLocaleString()} tone="light" />
        <MetricCard label="發射次數" value={settleResult.totalShots.toLocaleString()} />
        <MetricCard
          label="淨損益"
          value={profit >= 0 ? `+${profit.toLocaleString()}` : profit.toLocaleString()}
          valueClass={profit >= 0 ? 'text-emerald-300' : 'text-red-300'}
        />
        {settleResult.residualRecovery > 0 && (
          <div className="col-span-2">
            <MetricCard
              label="殘血回收"
              value={`+${settleResult.residualRecovery.toLocaleString()}`}
              caption="受傷但未擊殺的魚會依造成傷害回收部分成本。"
              tone="light"
              valueClass="text-emerald-300"
            />
          </div>
        )}
      </div>
      <p className="break-all rounded border border-yellow-200/15 bg-red-950/70 px-3 py-2 text-xs font-bold text-yellow-100/60">
        伺服器種子: {settleResult.serverSeed}
      </p>
      {children}
      <button type="button" onClick={onNewRound} className="gold-button rounded px-5 py-3 text-sm font-black">
        開始新一局
      </button>
    </div>
  )
}
