import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import { gameApi } from '../services/gameApi'
import {
  useFishingSession,
  BET_TIERS,
  BET_MIN,
  BET_MAX,
  BUYIN_TIERS,
  BUYIN_MIN,
  BUYIN_MAX,
  CANNON_DAMAGE,
} from '../hooks/useFishingSession'
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

// Pixi 漁場 code-split：pixi.js 只在進場時動態載入，不膨脹主 bundle。
const FishingCanvas = lazy(() => import('../components/FishingCanvas'))

const CANNON_OPTIONS = [
  { level: 1, label: '銅炮', desc: `傷害 ${CANNON_DAMAGE[1]}・穩紮穩打` },
  { level: 2, label: '銀炮', desc: `傷害 ${CANNON_DAMAGE[2]}・攻守均衡` },
  { level: 3, label: '金炮', desc: `傷害 ${CANNON_DAMAGE[3]}・速殺高波動` },
]
const fishingRules = [
  '先選擇進場金額、子彈面額與炮台進場：進場金額會一次性從星幣扣除，轉為「局內餘額」。',
  '子彈面額（每發注額）由你自選、整場固定，與砲台無關——面額越大派彩越高、消耗越快。',
  '對魚開火造成傷害；魚有血量，傷害累積到血量歸零才結算擊殺。砲台越高傷害越大（銅10／銀14／金18）、暴擊扣雙倍血。',
  '魚種倍率越高血量越厚（需更多發才打死），但每發子彈期望回報相同（RTP 96%）——打大魚是高風險高報酬。',
  '魚游走前沒打死也別擔心：結算時會按已造成傷害「殘血回收」退還部分子彈成本（保底回收）。',
  '隨時可「收網結算」，剩餘局內餘額＋殘血回收冪等退回星幣錢包，並揭露 server seed 供逐發公平性驗證。',
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
  const [perfMode, setPerfMode] = useState(false)
  const [autoFire, setAutoFire] = useState(false)
  // 進場金額／子彈面額皆「檔位 + 自訂輸入」：以字串保存輸入（允許清空編輯），再夾限解析為整數。
  const [buyInText, setBuyInText] = useState(String(BUYIN_TIERS[0]))
  const [betText, setBetText] = useState(String(BET_TIERS[0]))
  const [selectedCannon, setSelectedCannon] = useState(1)
  const [sessionBuyIn, setSessionBuyIn] = useState(null)

  const selectedBuyIn = Number.parseInt(buyInText, 10)
  const selectedBet = Number.parseInt(betText, 10)
  const buyInValid = Number.isInteger(selectedBuyIn) && selectedBuyIn >= BUYIN_MIN && selectedBuyIn <= BUYIN_MAX
  const betValid = Number.isInteger(selectedBet) && selectedBet >= BET_MIN && selectedBet <= BET_MAX
  const canStart = buyInValid && betValid && balance >= selectedBuyIn

  // 慶祝特效觸發器
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })

  const arenaResultsRef = useRef(null)
  const session = useFishingSession({
    onResults: (results, ctx) => {
      // 風控攔截保底批次時，整批無命中但幸運值已消耗，需重置防止鎖死在 100
      if (ctx?.fortuneConsumed && !results.some((r) => r.accepted && r.payout > 0)) {
        fortune.reportRound(false, true)
      }
      arenaResultsRef.current?.(results, ctx)
    },
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
    if (!canStart) return // 餘額/範圍守門（雙保險，按鈕已 disabled）
    play('click')
    fortune.addCharge(selectedBuyIn)
    setSessionBuyIn(selectedBuyIn)
    session.startSession({ buyIn: selectedBuyIn, cannonLevel: selectedCannon, betPerShot: selectedBet })
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
            <>
              {/* §6 固定高度 HUD 條：即時讀數貼合漁場，不隨 phase 增減 reflow（數字 tabular-nums 等寬） */}
              <div className="fishing-hud">
                <div className="fishing-hud__metric">
                  <span className="fishing-hud__label">局內餘額</span>
                  <span className="fishing-hud__value tabular-nums">{sessionBalance.toLocaleString()}</span>
                </div>
                <div className="fishing-hud__metric">
                  <span className="fishing-hud__label">本場派彩</span>
                  <span className="fishing-hud__value tabular-nums">{stats.totalPayout.toLocaleString()}</span>
                </div>
                <div className="fishing-hud__metric">
                  <span className="fishing-hud__label">已射擊</span>
                  <span className="fishing-hud__value tabular-nums">{stats.totalShots.toLocaleString()} 發</span>
                </div>
                {sessionBuyIn !== null && (() => {
                  const profit = sessionBalance - sessionBuyIn
                  return (
                    <div className="fishing-hud__metric">
                      <span className="fishing-hud__label">本場損益</span>
                      <span
                        className={`fishing-hud__value tabular-nums ${profit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                      >
                        {profit >= 0 ? `+${profit.toLocaleString()}` : profit.toLocaleString()}
                      </span>
                    </div>
                  )
                })()}
                <div className="fishing-hud__metric fishing-hud__metric--wide">
                  <span className="fishing-hud__label">砲台</span>
                  <span className="fishing-hud__value">{cannonLevel} 級・{betPerShot}/發</span>
                </div>
                <div className="fishing-hud__actions">
                  <button
                    type="button"
                    onClick={() => {
                      play('click')
                      setAutoFire((v) => !v)
                    }}
                    aria-pressed={autoFire}
                    className="fishing-hud__perf"
                    title="自動射擊：自動鎖定畫面內最高倍率的魚連續開火"
                  >
                    自動 {autoFire ? '開' : '關'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPerfMode((v) => !v)}
                    aria-pressed={perfMode}
                    className="fishing-hud__perf"
                    title="效能模式：降低粒子與特效，保住手機幀率"
                  >
                    效能模式 {perfMode ? '開' : '關'}
                  </button>
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      onClick={handleEnd}
                      disabled={phase === 'settling'}
                      className="gold-button fishing-hud__settle"
                    >
                      {phase === 'settling' ? '結算中…' : '收網結算'}
                    </button>
                    <span className="text-[11px] text-yellow-200/50 leading-none">
                      剩餘餘額全額退回
                    </span>
                  </div>
                </div>
              </div>

              <Suspense
                fallback={
                  <div className="fishing-arena grid place-items-center">
                    <p className="brand-title text-xl font-black text-yellow-100">載入漁場引擎…</p>
                  </div>
                }
              >
                <FishingCanvas
                  phase={phase}
                  betPerShot={betPerShot}
                  cannonLevel={cannonLevel}
                  fishTable={session.fishTable}
                  fire={session.fire}
                  play={play}
                  perfMode={perfMode}
                  autoFire={autoFire}
                  registerResults={(fn) => {
                    arenaResultsRef.current = fn
                  }}
                  onCatch={handleCatch}
                  onMiss={handleMiss}
                  onBossChange={setBossActive}
                />
              </Suspense>

              {/* §6 固定槽位 Boss/error 橫幅：opacity 淡入淡出，不插入/抽走節點造成 reflow */}
              <div className="fishing-banner-slot">
                <p className={`fishing-banner fishing-banner--boss${bossActive && phase === 'playing' ? ' is-on' : ''}`}>
                  ⚠ Boss 降臨！高倍魚出沒
                </p>
                {error && phase === 'playing' && (
                  <p className="fishing-banner fishing-banner--error is-on">{error}</p>
                )}
              </div>
            </>
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
                    {settleResult.residualRecovery > 0 && (
                      <div className="col-span-2">
                        <MetricCard
                          label="殘血回收"
                          value={`+${settleResult.residualRecovery.toLocaleString()}`}
                          caption="未打死的魚按已造成傷害退還部分子彈成本（已含於退回星幣）"
                          tone="light"
                          valueClass="text-emerald-300"
                        />
                      </div>
                    )}
                    {sessionBuyIn !== null && (() => {
                      const profit = settleResult.credited - sessionBuyIn
                      return (
                        <div className="col-span-2">
                          <MetricCard
                            label="本場淨損益"
                            value={profit >= 0 ? `+${profit.toLocaleString()}` : profit.toLocaleString()}
                            caption="退回星幣 − 進場金額"
                            valueClass={profit >= 0 ? 'text-emerald-300' : 'text-red-300'}
                          />
                        </div>
                      )
                    })()}
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
                    <p className="mt-2 text-sm font-bold text-yellow-100/64">選擇進場金額、子彈面額與炮台，開始捕魚。</p>
                  </div>

                  <div className="grid gap-2 text-left">
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">進場金額</p>
                    <div className="grid grid-cols-4 gap-2">
                      {BUYIN_TIERS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setBuyInText(String(option))}
                          className={[
                            'min-h-12 rounded border px-2 text-sm font-black transition',
                            selectedBuyIn === option
                              ? 'gold-button'
                              : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60',
                          ].join(' ')}
                        >
                          {option.toLocaleString()}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={buyInText}
                      onChange={(e) => setBuyInText(e.target.value.replace(/\D/g, '').slice(0, 7))}
                      placeholder={`自訂（${BUYIN_MIN.toLocaleString()}–${BUYIN_MAX.toLocaleString()}）`}
                      aria-label="自訂進場金額"
                      className={[
                        'min-h-11 rounded border bg-red-950/70 px-3 text-sm font-black text-yellow-100 outline-none transition',
                        buyInValid ? 'border-yellow-200/20 focus:border-yellow-200/70' : 'border-red-400/50',
                      ].join(' ')}
                    />
                    {!buyInValid && (
                      <p className="text-[11px] font-bold text-red-300">
                        進場金額需介於 {BUYIN_MIN.toLocaleString()}–{BUYIN_MAX.toLocaleString()} 星幣
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2 text-left">
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">子彈面額（每發注額）</p>
                    <div className="grid grid-cols-5 gap-2">
                      {BET_TIERS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setBetText(String(option))}
                          className={[
                            'min-h-12 rounded border px-1 text-sm font-black transition',
                            selectedBet === option
                              ? 'gold-button'
                              : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60',
                          ].join(' ')}
                        >
                          {option.toLocaleString()}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={betText}
                      onChange={(e) => setBetText(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder={`自訂（${BET_MIN}–${BET_MAX.toLocaleString()}）`}
                      aria-label="自訂子彈面額"
                      className={[
                        'min-h-11 rounded border bg-red-950/70 px-3 text-sm font-black text-yellow-100 outline-none transition',
                        betValid ? 'border-yellow-200/20 focus:border-yellow-200/70' : 'border-red-400/50',
                      ].join(' ')}
                    />
                    {!betValid && (
                      <p className="text-[11px] font-bold text-red-300">
                        子彈面額需介於 {BET_MIN}–{BET_MAX.toLocaleString()} 星幣
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2 text-left">
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">炮台（火力）</p>
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
                          <span className="block text-[11px] font-bold opacity-80">{option.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={!canStart}
                    className="red-gold-button rounded px-5 py-3 text-base font-black transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {!buyInValid
                      ? '請輸入有效進場金額'
                      : !betValid
                        ? '請輸入有效子彈面額'
                        : balance < selectedBuyIn
                          ? '星幣不足'
                          : `進場（扣 ${selectedBuyIn.toLocaleString()} 星幣・每發 ${selectedBet.toLocaleString()}）`}
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
          <MetricCard label="可用星幣" value={balance.toLocaleString()} caption="結算後回填" tone="light" />
          <GameRuleCard
            title="捕魚機規則"
            subtitle="了解 buy-in、炮台注額與魚種賠率。"
            rules={fishingRules}
            payouts={fishingPayouts}
          />
          <FortuneMeter value={fortune.value} />
        </aside>
      </section>
    </AppShell>
  )
}
