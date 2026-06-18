import { useCallback, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import FishingArena from '../components/FishingArena'
import { gameApi } from '../services/gameApi'
import { useFishingSession, CANNON_BET } from '../hooks/useFishingSession'
import { useSound } from '../casino-fx/sound/useSound'
import { useBgm } from '../casino-fx/sound/useBgm'
import GoldBurst from '../casino-fx/fx/GoldBurst'
import { CoinRainPro, RedEnvelopeRain } from '../casino-fx/fx/FallRain'
import BrushBanner, { pickBannerForMultiplier } from '../casino-fx/fx/BrushBanner'
import LuckyAura from '../casino-fx/fx/LuckyAura'
import FortuneMeter from '../casino-fx/fx/FortuneMeter'
import { useFortuneMeter } from '../casino-fx/fx/useFortuneMeter'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

const BUY_IN_OPTIONS = [1000, 3000, 5000]
const CANNON_OPTIONS = [
  { level: 1, label: '銅炮', bet: CANNON_BET[1] },
  { level: 2, label: '銀炮', bet: CANNON_BET[2] },
  { level: 3, label: '金炮', bet: CANNON_BET[3] },
]
const fishingRules = [
  '先選擇 buy-in 金額與炮台等級進場：buy-in 會一次性從星幣扣除，轉為「局內餘額」。',
  '點擊魚開火，每發子彈固定消耗炮台注額（銅10／銀50／金100），命中即依魚種倍率派彩到局內餘額。',
  '魚種倍率越高命中率越低，但每發子彈期望回報相同（RTP 92%），打大魚是高波動玩法。',
  '隨時可「收網結算」，剩餘局內餘額會冪等退回星幣錢包，並揭露 server seed 供公平性驗證。',
  '局內餘額不足時無法繼續開火，請先結算。',
]
const fishingPayouts = [
  { label: '小魚', value: '錦鯉2x／金魚3x／燈籠魚5x／河豚8x' },
  { label: '中魚', value: '神仙魚15x／魔鬼魚25x' },
  { label: '高倍 / Boss', value: '金龍60x／貔貅88x／財神100x／龍王200x' },
  { label: '特殊', value: '搖錢樹 隨機10–50x' },
]

// 結算後逐發公平性驗證面板：列出近期已受理子彈，逐發呼叫 verify-shot 比對重放結果。
function ShotVerifyPanel({ sessionId, shots, fishTable, play }) {
  const [results, setResults] = useState({}) // shotSeq → { loading, data, error }
  const nameByCode = useMemo(() => {
    const map = {}
    for (const fish of fishTable || []) map[fish.code] = fish.name
    return map
  }, [fishTable])

  if (!shots || shots.length === 0) return null

  const verify = async (shot) => {
    setResults((prev) => ({ ...prev, [shot.shotSeq]: { loading: true } }))
    play?.('click')
    try {
      const data = await gameApi.fishingVerifyShot({
        sessionId,
        shotSeq: shot.shotSeq,
        fishType: shot.fishType,
        betPerShot: shot.betPerShot,
      })
      // 重放是否與本地紀錄一致（hit / payout）。
      const consistent = data.hit === shot.hit && Number(data.payout) === Number(shot.payout)
      setResults((prev) => ({ ...prev, [shot.shotSeq]: { data, consistent } }))
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [shot.shotSeq]: { error: err?.response?.data?.message || err.message || '驗證失敗' },
      }))
    }
  }

  return (
    <div className="fishing-verify grid gap-2 text-left">
      <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">逐發公平性驗證</p>
      <p className="text-[11px] font-bold text-yellow-100/56">
        以 server seed 重放任一發子彈，確認結果與本場紀錄一致。
      </p>
      <ul className="grid max-h-56 gap-1 overflow-y-auto pr-1">
        {shots.map((shot) => {
          const state = results[shot.shotSeq] || {}
          return (
            <li
              key={shot.shotSeq}
              className="flex items-center justify-between gap-2 rounded border border-yellow-200/12 bg-red-950/60 px-3 py-2 text-xs font-bold text-yellow-100/76"
            >
              <span className="truncate">
                #{shot.shotSeq}・{nameByCode[shot.fishType] || shot.fishType}・
                {shot.hit ? `命中 +${shot.payout.toLocaleString()}` : '未中'}
              </span>
              {state.data ? (
                <span
                  className={[
                    'shrink-0 font-black',
                    state.data.commitmentValid && state.consistent ? 'text-emerald-300' : 'text-red-300',
                  ].join(' ')}
                  title={state.data.message}
                >
                  {state.data.commitmentValid && state.consistent ? '✓ 已驗證' : '✗ 不一致'}
                </span>
              ) : state.error ? (
                <span className="shrink-0 font-black text-red-300">✗ {state.error}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => verify(shot)}
                  disabled={state.loading}
                  className="shrink-0 rounded border border-yellow-200/30 px-3 py-1 font-black text-yellow-100/80 transition hover:border-yellow-200/70 disabled:opacity-50"
                >
                  {state.loading ? '驗證中…' : '驗證'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Fishing() {
  const balance = useSelector((state) => state.wallet.balance)
  const player = useSelector((state) => state.auth.player)
  const { play } = useSound()
  const fortune = useFortuneMeter('fishing', player?.id)

  const [bossActive, setBossActive] = useState(false)
  const [selectedBuyIn, setSelectedBuyIn] = useState(BUY_IN_OPTIONS[0])
  const [selectedCannon, setSelectedCannon] = useState(1)

  // 慶祝特效觸發器
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })

  const arenaResultsRef = useRef(null)
  const session = useFishingSession({
    onResults: (results, ctx) => arenaResultsRef.current?.(results, ctx),
    fortuneReady: fortune.full,
  })

  // BGM：進場深海主題；Boss 在場切中式大鼓主題。
  useBgm(bossActive ? 'boss' : 'fishing', session.phase === 'playing')

  const handleCatch = useCallback(
    ({ payout, effMult }) => {
      fortune.reportRound(true)
      const bannerPick = pickBannerForMultiplier(effMult)
      setBanner((prev) => ({ trigger: prev.trigger + 1, ...bannerPick }))
      setBurstTrigger((n) => n + 1)

      if (effMult >= 30) {
        play('winEpic')
        setCoinDensity('epic')
        setCoinTrigger((n) => n + 1)
        setEnvelopeTrigger((n) => n + 1)
        announcePlayerWin({ playerName: player?.nickname || player?.username, game: 'fishing', amount: payout })
      } else if (effMult >= 10) {
        play('winBig')
        setCoinDensity('heavy')
        setCoinTrigger((n) => n + 1)
      } else {
        play('winSmall')
        setCoinDensity('light')
        setCoinTrigger((n) => n + 1)
      }
    },
    [fortune, play, player],
  )

  const handleMiss = useCallback(() => {
    fortune.reportRound(false)
  }, [fortune])

  const handleStart = () => {
    play('click')
    fortune.addCharge(selectedBuyIn)
    session.startSession({ buyIn: selectedBuyIn, cannonLevel: selectedCannon })
  }

  const handleEnd = () => {
    play('net')
    session.endSession()
  }

  const { phase, sessionBalance, stats, settleResult, error, betPerShot, cannonLevel } = session
  useGameLeaveGuard(
    phase === 'playing',
    '捕魚場次進行中，確定要離開嗎？離開後局內餘額將在 30 分鐘內自動結算退回。'
  )

  return (
    <AppShell>
      <LuckyAura active={fortune.auraActive} />
      <GoldBurst trigger={burstTrigger} origin={{ x: 50, y: 52 }} />
      <CoinRainPro trigger={coinTrigger} density={coinDensity} />
      <RedEnvelopeRain trigger={envelopeTrigger} density="heavy" />
      <BrushBanner trigger={banner.trigger} text={banner.text} level={banner.level} />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid gap-4 content-start">
          {phase === 'playing' || phase === 'settling' ? (
            <FishingArena
              phase={phase}
              betPerShot={betPerShot}
              fishTable={session.fishTable}
              fire={session.fire}
              play={play}
              registerResults={(fn) => {
                arenaResultsRef.current = fn
              }}
              onCatch={handleCatch}
              onMiss={handleMiss}
              onBossChange={setBossActive}
            />
          ) : (
            <div className="luxury-panel grid min-h-[420px] place-items-center rounded p-6 text-center">
              {phase === 'loading' ? (
                <p className="brand-title text-xl font-black text-yellow-100">準備漁場中…</p>
              ) : phase === 'settled' && settleResult ? (
                <div className="grid gap-4">
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Settled</p>
                  <h3 className="brand-title text-3xl font-black text-yellow-100">本場結算完成</h3>
                  <div className="grid grid-cols-2 gap-3 text-left">
                    <MetricCard label="本場下注" value={settleResult.totalBet.toLocaleString()} />
                    <MetricCard label="本場派彩" value={settleResult.totalPayout.toLocaleString()} tone="light" />
                    <MetricCard label="總射擊數" value={settleResult.totalShots.toLocaleString()} />
                    <MetricCard label="退回星幣" value={settleResult.credited.toLocaleString()} tone="light" />
                  </div>
                  <p className="break-all rounded border border-yellow-200/15 bg-red-950/70 px-3 py-2 text-xs font-bold text-yellow-100/60">
                    server seed：{settleResult.serverSeed}
                  </p>
                  <ShotVerifyPanel
                    sessionId={settleResult.sessionId}
                    shots={settleResult.shots}
                    fishTable={session.fishTable}
                    play={play}
                  />
                  <button type="button" onClick={session.resetToIdle} className="gold-button rounded px-5 py-3 text-sm font-black">
                    再來一場
                  </button>
                </div>
              ) : (
                <div className="grid w-full max-w-md gap-5">
                  <div>
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Buy-in</p>
                    <h3 className="brand-title mt-1 text-3xl font-black text-yellow-100">進入漁場</h3>
                    <p className="mt-2 text-sm font-bold text-yellow-100/64">選擇進場金額與炮台，開始捕魚。</p>
                  </div>

                  <div className="grid gap-2 text-left">
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">進場金額</p>
                    <div className="grid grid-cols-3 gap-2">
                      {BUY_IN_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setSelectedBuyIn(option)}
                          className={[
                            'min-h-12 rounded border px-3 text-sm font-black transition',
                            selectedBuyIn === option
                              ? 'gold-button'
                              : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60',
                          ].join(' ')}
                        >
                          {option.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2 text-left">
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">炮台等級</p>
                    <div className="grid grid-cols-3 gap-2">
                      {CANNON_OPTIONS.map((option) => (
                        <button
                          key={option.level}
                          type="button"
                          onClick={() => setSelectedCannon(option.level)}
                          className={[
                            'min-h-12 rounded border px-2 text-sm font-black transition',
                            selectedCannon === option.level
                              ? 'gold-button'
                              : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60',
                          ].join(' ')}
                        >
                          {option.label}
                          <span className="block text-[11px] font-bold opacity-80">{option.bet}/發</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={balance < selectedBuyIn}
                    className="red-gold-button rounded px-5 py-3 text-base font-black transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {balance < selectedBuyIn ? '星幣不足' : `進場（扣 ${selectedBuyIn.toLocaleString()} 星幣）`}
                  </button>
                  {error && (
                    <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="grid gap-4 content-start">
          <GameRuleCard
            title="捕魚機規則"
            subtitle="了解 buy-in、炮台注額與魚種賠率。"
            rules={fishingRules}
            payouts={fishingPayouts}
          />
          <MetricCard label="可用星幣" value={balance.toLocaleString()} caption="結算後回填" tone="light" />
          {(phase === 'playing' || phase === 'settling') && (
            <>
              <MetricCard label="局內餘額" value={sessionBalance.toLocaleString()} caption={`炮台 ${cannonLevel} 級・${betPerShot}/發`} />
              <MetricCard label="本場派彩" value={stats.totalPayout.toLocaleString()} caption={`已射擊 ${stats.totalShots} 發`} />
              <button
                type="button"
                onClick={handleEnd}
                disabled={phase === 'settling'}
                className="gold-button rounded px-5 py-3 text-sm font-black transition disabled:opacity-50"
              >
                {phase === 'settling' ? '結算中…' : '收網結算'}
              </button>
            </>
          )}
          <FortuneMeter value={fortune.value} />
          {bossActive && (phase === 'playing') && (
            <p className="rounded border border-yellow-200/40 bg-yellow-200/10 px-4 py-3 text-center text-sm font-black text-yellow-100">
              ⚠ Boss 降臨！高倍魚出沒
            </p>
          )}
          {error && (phase === 'playing') && (
            <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>
          )}
        </aside>
      </section>
    </AppShell>
  )
}
