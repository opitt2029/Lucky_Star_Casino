import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import FishingControlDock from '../components/FishingControlDock'
import FishingSettlementPanel from '../components/FishingSettlementPanel'
import FishingFullscreenButton from '../components/FishingFullscreenButton'
import FishingFishInfoPanel from '../components/FishingFishInfoPanel'
import { fetchWallet } from '../store/slices/walletSlice'
import { useFishingSession, BUYIN_TIERS, BUYIN_MIN, BUYIN_MAX } from '../hooks/useFishingSession'
import { useSound } from '../casino-fx/sound/useSound'
import { useBgm } from '../casino-fx/sound/useBgm'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'
import '../components/Fishing.css'
import {
  FISHING_DISPLAY_SPECIES,
  FISHING_JACKPOT,
} from '../data/fishingGameData'
import { FISHING_AMMO_OPTIONS, getFishingAmmoByLevel } from '../data/fishingConfig'
import { decorateFishingFishTable } from '../data/fishingFishConfig'

const FishingCanvas = lazy(() => import('../components/FishingCanvas'))

const fishingRules = [
  '進場前先選定本局進場金額、子彈面額與炮台等級；進場後火力固定，結算前餘額會留在本局。',
  '每次開火會消耗一發子彈面額。子彈面額越高，捕獲後派彩也越高，但本局餘額消耗更快。',
  '魚有血量，命中會累積傷害。血量歸零後才會進行捕獲判定，炮台等級越高，單發造成的傷害越高。',
  '高倍率魚與首領魚血量更厚，適合用高等炮台集火。牠們風險較高，但捕獲後回饋更大。',
  '若魚離開畫面前沒有被擊殺，已造成的部分傷害會在收網結算時依規則回收部分成本。',
  '可隨時按「收網結算」結束本局，剩餘本局餘額、捕獲獎勵與殘血回收會一起結算回錢包。',
]

const fishingPayouts = [
  { label: '常見魚', value: '小丑魚 2x - 5x' },
  { label: '中階魚', value: '藍寶石魚 8x - 18x' },
  { label: '高價魚', value: '黃金魚 25x - 60x' },
  { label: '稀有與 Boss', value: '水晶魟魚 80x - 120x, 彩金鯨王 200x+' },
]


const SPECIAL_EFFECT_TIMER_CONFIG = {
  CAISHEN: {
    label: '財神',
    title: '高倍率獎勵',
    durationMs: 15000,
    tone: 'caishen',
  },
  MONEY_TREE: {
    label: '搖錢樹',
    title: '浮動倍率',
    durationMs: 15000,
    tone: 'money-tree',
  },
}

function FishingSpecialEffectTimers({ timers }) {
  if (!timers.length) return null

  return (
    <div className="fishing-special-effect-timers" aria-live="polite" aria-label="特殊魚效果時間">
      <span className="fishing-special-effect-timers__eyebrow">效果時間</span>
      {timers.map((timer) => (
        <div
          key={timer.code}
          className={`fishing-special-effect-timer fishing-special-effect-timer--${timer.tone}`}
        >
          <div className="fishing-special-effect-timer__text">
            <strong>{timer.label}</strong>
            <span>{timer.title}</span>
          </div>
          <div className="fishing-special-effect-timer__time tabular-nums">
            {timer.remainingSeconds}s
          </div>
          <div className="fishing-special-effect-timer__bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${timer.progress})` }} />
          </div>
        </div>
      ))}
    </div>
  )
}


function FishingCatchStatsDrawer({ items, total }) {
  return (
    <details className="fishing-catch-stats-drawer">
      <summary className="fishing-catch-stats-drawer__summary">
        <span>\u672c\u5c40\u6355\u7372\u7d71\u8a08</span>
        <strong>{total.toLocaleString()} \u96bb</strong>
      </summary>
      <div className="fishing-catch-stats-drawer__panel">
        {items.length > 0 ? (
          <ul>
            {items.map((item) => (
              <li key={item.key}>
                <span>{item.name}</span>
                <strong>{item.count.toLocaleString()} \u96bb</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>\u5c1a\u672a\u6355\u7372\u9b5a\u7a2e</p>
        )}
      </div>
    </details>
  )
}

export default function Fishing() {
  const dispatch = useDispatch()
  const balance = useSelector((state) => state.wallet.balance)
  const walletLoading = useSelector((state) => state.wallet.loading)
  const player = useSelector((state) => state.auth.player)
  const { play } = useSound()

  const [bossActive, setBossActive] = useState(false)
  const [perfMode, setPerfMode] = useState(false)
  const [buyInText, setBuyInText] = useState(String(BUYIN_TIERS[0]))
  const [topUpText, setTopUpText] = useState(String(BUYIN_TIERS[0]))
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false)
  const [selectedAmmoLevel, setSelectedAmmoLevel] = useState(1)
  const [sessionBuyIn, setSessionBuyIn] = useState(null)
  const [caughtFishStats, setCaughtFishStats] = useState({})
  const [specialEffectTimers, setSpecialEffectTimers] = useState({})
  const [specialEffectNow, setSpecialEffectNow] = useState(() => Date.now())
  const fullscreenTargetRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenMessage, setFullscreenMessage] = useState('')
  const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)

  useEffect(() => {
    dispatch(fetchWallet())
  }, [dispatch])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === fullscreenTargetRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const handleToggleFullscreen = useCallback(async () => {
    const target = fullscreenTargetRef.current
    if (!fullscreenSupported || !target) {
      setFullscreenMessage('此瀏覽器不支援全屏模式')
      return
    }

    try {
      setFullscreenMessage('')
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await target.requestFullscreen()
      }
    } catch {
      setFullscreenMessage('全屏模式啟動失敗，請再試一次。')
    }
  }, [fullscreenSupported])

  const selectedBuyIn = Number.parseInt(buyInText, 10)
  const selectedTopUp = Number.parseInt(topUpText, 10)
  const selectedEntryAmmo = getFishingAmmoByLevel(selectedAmmoLevel)
  const selectedBet = selectedEntryAmmo.costPerShot
  const buyInValid =
    Number.isInteger(selectedBuyIn) && selectedBuyIn >= BUYIN_MIN && selectedBuyIn <= BUYIN_MAX
  const topUpValid =
    Number.isInteger(selectedTopUp) && selectedTopUp >= BUYIN_MIN && selectedTopUp <= BUYIN_MAX
  const canStart = buyInValid && balance >= selectedBuyIn
  const jackpotAmount = FISHING_JACKPOT.amount.toLocaleString()

  const arenaResultsRef = useRef(null)
  const session = useFishingSession({
    onResults: (results, ctx) => {
      arenaResultsRef.current?.(results, ctx)
    },
  })

  const decoratedFishTable = useMemo(() => decorateFishingFishTable(session.fishTable), [session.fishTable])

  const fishNameByCode = useMemo(() => {
    const names = {}
    for (const fish of decoratedFishTable || []) {
      if (fish?.code && !names[fish.code]) names[fish.code] = fish.name || fish.code
    }
    return names
  }, [decoratedFishTable])

  const caughtFishStatsItems = useMemo(
    () =>
      Object.values(caughtFishStats).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [caughtFishStats]
  )
  const caughtFishTotal = caughtFishStatsItems.reduce((sum, item) => sum + item.count, 0)

  const isFishingBgmActive = session.phase === 'idle' || session.phase === 'playing'
  const fishingBgmTheme = session.phase === 'playing' && bossActive ? 'boss' : 'fishing'
  const fishingBgmIntensity = session.phase === 'idle' ? 0 : 1
  useBgm(fishingBgmTheme, isFishingBgmActive, { intensity: fishingBgmIntensity })


  const activeSpecialEffectTimers = useMemo(
    () =>
      Object.values(specialEffectTimers)
        .map((timer) => {
          const remainingMs = Math.max(0, timer.expiresAt - specialEffectNow)
          return {
            ...timer,
            remainingMs,
            remainingSeconds: Math.ceil(remainingMs / 1000),
            progress: Math.max(0, Math.min(1, remainingMs / timer.durationMs)),
          }
        })
        .filter((timer) => timer.remainingMs > 0),
    [specialEffectNow, specialEffectTimers]
  )
  const specialEffectTimerCount = Object.keys(specialEffectTimers).length

  useEffect(() => {
    if (session.phase !== 'playing') {
      setSpecialEffectTimers({})
      return undefined
    }
    if (specialEffectTimerCount === 0) return undefined

    const timerId = window.setInterval(() => {
      const now = Date.now()
      setSpecialEffectNow(now)
      setSpecialEffectTimers((prev) => {
        let changed = false
        const next = {}
        for (const [code, timer] of Object.entries(prev)) {
          if (timer.expiresAt > now) {
            next[code] = timer
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 250)

    return () => window.clearInterval(timerId)
  }, [session.phase, specialEffectTimerCount])

  const triggerSpecialEffectTimer = useCallback(({ code, payout, effMult }) => {
    const config = SPECIAL_EFFECT_TIMER_CONFIG[code]
    if (!config) return

    const now = Date.now()
    setSpecialEffectNow(now)
    setSpecialEffectTimers((prev) => ({
      ...prev,
      [code]: {
        ...config,
        code,
        payout,
        effMult,
        expiresAt: now + config.durationMs,
      },
    }))
  }, [])

  const handleCatch = useCallback(
    ({ payout, effMult, code, name }) => {
      triggerSpecialEffectTimer({ code, payout, effMult })
      const statCode = code || 'UNKNOWN'
      const statName = name || fishNameByCode[statCode] || statCode
      const statKey = `${statCode}:${statName}`
      setCaughtFishStats((prev) => ({
        ...prev,
        [statKey]: {
          key: statKey,
          code: statCode,
          name: statName,
          count: (prev[statKey]?.count || 0) + 1,
        },
      }))
      if (effMult >= 30) {
        play('winEpic')
        announcePlayerWin({
          playerName: player?.nickname || player?.username,
          game: 'fishing',
          amount: payout,
        })
      } else if (effMult >= 10) {
        play('winBig')
      } else {
        play('winSmall')
      }
    },
    [fishNameByCode, play, player, triggerSpecialEffectTimer]
  )

  // 僅供進場前選擇：面額/砲台為 session 級參數（ADR-004 整場固定），hook 在 playing 階段會拒絕變更。
  const handleAmmoSelect = (option) => {
    if (session.phase !== 'idle') return
    play('click')
    const betChanged = session.changeBetPerShot(option.costPerShot)
    const cannonChanged = session.changeCannonLevel(option.level)
    if (betChanged || cannonChanged) setSelectedAmmoLevel(option.level)
  }

  const handleStart = () => {
    if (!canStart) return
    play('click')
    setCaughtFishStats({})
    setSessionBuyIn(selectedBuyIn)
    session.startSession({
      buyIn: selectedBuyIn,
      cannonLevel: selectedAmmoLevel,
      betPerShot: selectedBet,
    })
  }

  const handleTopUp = async () => {
    if (!canSubmitTopUp) return
    play('coin')
    const result = await session.topUp({ amount: selectedTopUp })
    if (result?.amount) {
      setSessionBuyIn((prev) => (prev === null ? result.amount : prev + result.amount))
      setIsTopUpModalOpen(false)
    }
  }

  const handleEnd = () => {
    play('net')
    session.endSession()
  }

  const handleFire = useCallback(
    (fishInstanceId, fishCode) => {
      const result = session.fire(fishInstanceId, fishCode)
      if (result?.reason === 'insufficient') {
        play('click')
        setIsTopUpModalOpen(true)
      }
      return result
    },
    [play, session]
  )

  const { phase, sessionBalance, stats, settleResult, error, betPerShot, cannonLevel } = session
  const activeAmmo =
    FISHING_AMMO_OPTIONS.find((option) => option.costPerShot === betPerShot) ||
    getFishingAmmoByLevel(cannonLevel)
  const canSettle =
    phase === 'playing' && (sessionBalance > 0 || stats.totalShots > 0 || stats.totalPayout > 0)
  const canSubmitTopUp =
    phase === 'playing' &&
    sessionBalance < betPerShot &&
    topUpValid &&
    balance >= selectedTopUp &&
    !session.topUpLoading
  useGameLeaveGuard(
    phase === 'playing',
    '本局尚未收網結算，離開頁面可能會中斷目前捕魚流程。請先按「收網結算」將餘額回到錢包。'
  )

  useEffect(() => {
    if (phase === 'playing' && session.session?.buyIn && sessionBuyIn === null) {
      setSessionBuyIn(session.session.buyIn)
    }
    if (phase === 'playing' && sessionBalance >= betPerShot && isTopUpModalOpen) {
      setIsTopUpModalOpen(false)
    }
  }, [betPerShot, isTopUpModalOpen, phase, session.session?.buyIn, sessionBalance, sessionBuyIn])

  const roundProfit =
    (phase === 'playing' || phase === 'settling') && sessionBuyIn !== null
      ? sessionBalance - sessionBuyIn
      : null

  return (
    <AppShell>
      <main className="fishing-redgold-shell" data-style="red-gold-deep-sea">
        <div className="fishing-hero-shell">
          <div className="fishing-hero-copy">
            <p className="fishing-hero-kicker">Lucky Fishing</p>
            <h2 className="brand-title fishing-hero-title">深海彩金捕魚</h2>
            <p className="fishing-hero-subtitle">
              鎖定魚群、累積傷害並捕獲高倍率目標。遇到首領鯨王時，集中火力挑戰深海彩金池。
            </p>
            <div className="fishing-hero-badge-row" aria-label="捕魚機特色">
              <span>紅金娛樂城</span>
              <span>深海戰場</span>
              <span>彩金追獵</span>
            </div>
          </div>
          <div className="fishing-hero-actions">
            <Link to="/games" className="gold-button fishing-back-button">
              返回遊戲大廳
            </Link>
            <div className="fishing-jackpot-chip" aria-label={FISHING_JACKPOT.label}>
              <span>{FISHING_JACKPOT.label}</span>
              <strong>{jackpotAmount}</strong>
              <small>{FISHING_JACKPOT.bonusText}</small>
            </div>
          </div>
        </div>

        <section className="fishing-page grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_280px]">
          <div
            ref={fullscreenTargetRef}
            data-phase={phase}
            className={`fishing-main fishing-fullscreen-surface grid gap-4 ${isFullscreen ? 'fishing-game--fullscreen' : 'content-start'}`}
          >
            <div className="fishing-flowbar">
              <div>
                <p className="fishing-flowbar__eyebrow">Lucky Fishing</p>
                <strong>{phase === 'playing' || phase === 'settling' ? '漁場作戰中' : '進場準備'}</strong>
              </div>
              <div className="fishing-flowbar__actions">
                <FishingFullscreenButton
                  isFullscreen={isFullscreen}
                  disabled={!fullscreenSupported}
                  message={fullscreenMessage}
                  onToggle={handleToggleFullscreen}
                />
              </div>

            </div>
            {fullscreenMessage && (
              <div className="fishing-api-alert fishing-api-alert--info" role="status">
                {fullscreenMessage}
              </div>
            )}
            {phase === 'playing' || phase === 'settling' ? (
              <>
                <div className="fishing-hud">
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">本局餘額</span>
                    <span className="fishing-hud__value tabular-nums">
                      {sessionBalance.toLocaleString()}
                    </span>
                  </div>
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">累積派彩</span>
                    <span className="fishing-hud__value tabular-nums">
                      {stats.totalPayout.toLocaleString()}
                    </span>
                  </div>
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">已發射</span>
                    <span className="fishing-hud__value tabular-nums">
                      {stats.totalShots.toLocaleString()} 發
                    </span>
                  </div>
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">捕獲數</span>
                    <span className="fishing-hud__value tabular-nums">
                      {stats.caughtCount.toLocaleString()} 尾
                    </span>
                  </div>
                  {roundProfit !== null && (
                    <div className="fishing-hud__metric">
                      <span className="fishing-hud__label">本局盈虧</span>
                      <span
                        className={`fishing-hud__value tabular-nums ${roundProfit > 0 ? 'text-emerald-300' : roundProfit < 0 ? 'text-red-300' : ''}`}
                      >
                        {roundProfit > 0 ? `+${roundProfit.toLocaleString()}` : roundProfit.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="fishing-hud__metric fishing-hud__metric--wide">
                    <span className="fishing-hud__label">炮台資訊</span>
                    <span className="fishing-hud__value">
                      Lv {cannonLevel} / 每發 {betPerShot}
                    </span>
                  </div>
                </div>

                <div className="fishing-play-surface">
                  <div className="fishing-stage-card">
                    <div className="fishing-stage-marquee" aria-label="捕魚桌狀態">
                      <span>深海戰場</span>
                      <strong>{bossActive ? '首領追獵中' : 'Lucky Fishing'}</strong>
                      <span
                        className={
                          error && phase === 'playing'
                            ? 'is-alert'
                            : bossActive && phase === 'playing'
                              ? 'is-boss'
                              : ''
                        }
                      >
                        {error && phase === 'playing'
                          ? error
                          : bossActive && phase === 'playing'
                            ? '彩金鯨王出沒'
                            : phase === 'settling'
                              ? '結算中'
                              : '手動瞄準'}
                      </span>

                      <div className="fishing-stage-marquee__actions">
                        <button
                          type="button"
                          onClick={() => setPerfMode((v) => !v)}
                          aria-pressed={perfMode}
                          className="fishing-hud__perf fishing-stage-marquee__perf"
                          title="切換效能模式"
                        >
                          效能 {perfMode ? '開' : '關'}
                        </button>
                      </div>
                    </div>
                    <div className="fishing-stage-frame">
                      <Suspense
                        fallback={
                          <div className="fishing-arena grid place-items-center">
                            <p className="brand-title text-xl font-black text-yellow-100">
                              載入捕魚桌中...
                            </p>
                          </div>
                        }
                      >
                        <FishingCanvas
                          phase={phase}
                          betPerShot={betPerShot}
                          cannonLevel={cannonLevel}
                          ammoTone={activeAmmo.tone}
                          fishTable={decoratedFishTable}
                          fire={handleFire}
                          play={play}
                          perfMode={perfMode}
                          registerResults={(fn) => {
                            arenaResultsRef.current = fn
                          }}
                          onCatch={handleCatch}
                          onBossChange={setBossActive}
                        />
                      </Suspense>
                      <FishingSpecialEffectTimers timers={activeSpecialEffectTimers} />
                    </div>
                    <div className="fishing-stage-controls">
                      <FishingControlDock
                        activeAmmo={activeAmmo}
                        ammoOptions={FISHING_AMMO_OPTIONS}
                        cannonLevel={cannonLevel}
                        ammoTone={activeAmmo.tone}
                        canSettle={canSettle}
                        disabledReason={canSettle ? '' : '目前沒有可結算的本局餘額或射擊紀錄'}
                        isSettling={phase === 'settling'}
                        isAmmoLocked={phase === 'playing' || phase === 'settling'}
                        onSettle={handleEnd}
                      />
                    </div>
                    {error && phase === 'playing' && (
                      <div className="fishing-api-alert" role="status">
                        {error.includes('餘額') ? '餘額不足，請先加值或收網結算。' : error}
                      </div>
                    )}
                    <div className="fishing-stage-footlights" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>

                  <FishingCatchStatsDrawer items={caughtFishStatsItems} total={caughtFishTotal} />

                  {isTopUpModalOpen && phase === 'playing' && (
                    <div
                      className="fishing-topup-modal"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="fishing-topup-title"
                    >
                      <div
                        className="fishing-topup-modal__backdrop"
                        onClick={() => setIsTopUpModalOpen(false)}
                      />
                      <div className="fishing-topup-modal__panel">
                        <button
                          type="button"
                          className="fishing-topup-modal__close"
                          onClick={() => setIsTopUpModalOpen(false)}
                          aria-label="關閉臨時加值"
                        >
                          ×
                        </button>
                        <span className="fishing-topup-modal__eyebrow">Lucky Fishing</span>
                        <h3 id="fishing-topup-title">臨時加值</h3>
                        <p>本局可用額度已不足以發射目前彈藥，請從錢包加入本局後繼續遊玩。</p>
                        <label className="fishing-topup-modal__field">
                          <span>加值金額</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={topUpText}
                            onChange={(e) =>
                              setTopUpText(e.target.value.replace(/\D/g, '').slice(0, 7))
                            }
                            aria-label="臨時加值金額"
                          />
                        </label>
                        <div className="fishing-topup-modal__wallet">
                          錢包餘額：{balance.toLocaleString()}
                        </div>
                        {balance < selectedTopUp && (
                          <div className="fishing-topup-modal__error">錢包餘額不足</div>
                        )}
                        <div className="fishing-topup-modal__actions">
                          <button
                            type="button"
                            className="fishing-topup-modal__cancel"
                            onClick={() => setIsTopUpModalOpen(false)}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="fishing-topup-modal__submit"
                            onClick={handleTopUp}
                            disabled={!canSubmitTopUp}
                          >
                            {session.topUpLoading ? '加值中' : '加入本局'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="fishing-lobby luxury-panel grid min-h-[420px] place-items-center gap-5 rounded p-6 text-center">
                {phase === 'loading' ? (
                  <p className="brand-title text-xl font-black text-yellow-100">
                    讀取捕魚資料中...
                  </p>
                ) : phase === 'settled' && settleResult ? (
                  <FishingSettlementPanel
                    settleResult={settleResult}
                    sessionBuyIn={sessionBuyIn}
                    onNewRound={session.resetToIdle}
                  />
                ) : (
                  <div className="fishing-buyin-panel grid w-full max-w-md gap-5">
                    <div>
                      <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">
                        進場設定
                      </p>
                      <h3 className="brand-title mt-1 text-3xl font-black text-yellow-100">
                        進入漁場
                      </h3>
                      <p className="mt-2 text-sm font-bold text-yellow-100/64">
                        彈藥與砲台進場後整局固定，收網結算後可重新選擇。
                      </p>
                    </div>

                    <div className="grid gap-2 text-left">
                      <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                        進場金額
                      </p>
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
                        onChange={(e) =>
                          setBuyInText(e.target.value.replace(/\D/g, '').slice(0, 7))
                        }
                        placeholder={`可輸入 ${BUYIN_MIN.toLocaleString()} 到 ${BUYIN_MAX.toLocaleString()}`}
                        aria-label="自訂進場金額"
                        className={[
                          'min-h-11 rounded border bg-red-950/70 px-3 text-sm font-black text-yellow-100 outline-none transition',
                          buyInValid
                            ? 'border-yellow-200/20 focus:border-yellow-200/70'
                            : 'border-red-400/50',
                        ].join(' ')}
                      />
                      {!buyInValid && (
                        <p className="text-[11px] font-bold text-red-300">
                          進場金額需介於 {BUYIN_MIN.toLocaleString()} 到{' '}
                          {BUYIN_MAX.toLocaleString()} 星幣。
                        </p>
                      )}
                    </div>

                    <div className="grid gap-2 text-left">
                      <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                        選擇彈藥（進場後整局固定）
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {FISHING_AMMO_OPTIONS.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => handleAmmoSelect(option)}
                            aria-pressed={selectedAmmoLevel === option.level}
                            className={[
                              'min-h-12 rounded border px-2 text-sm font-black transition',
                              selectedAmmoLevel === option.level
                                ? 'gold-button'
                                : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/68 hover:border-yellow-200/60',
                            ].join(' ')}
                            title={`${option.description}，每發 ${option.costPerShot.toLocaleString()} 星幣`}
                          >
                            {option.badge}・{option.label}
                            <span className="block text-[11px] font-bold opacity-80">
                              {option.costPerShot.toLocaleString()} / 發
                            </span>
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
                        ? '\u8acb\u8f38\u5165\u6709\u6548\u9032\u5834\u91d1\u984d'
                        : balance < selectedBuyIn
                          ? '\u661f\u5e63\u4e0d\u8db3'
                          : `\u9032\u5165\u6f01\u5834\uff0c\u5e36\u5165 ${selectedBuyIn.toLocaleString()} \u661f\u5e63`}
                    </button>
                    {error && (
                      <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                        {error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="fishing-side-panel grid gap-4 content-start">
            <MetricCard
              label="可用星幣"
              value={walletLoading ? '同步中' : balance.toLocaleString()}
              caption="進場前請確認錢包餘額。"
              tone="light"
            />
            <GameRuleCard
              title="捕魚機規則"
              subtitle="了解進場金額、子彈面額、炮台傷害與收網結算。"
              rules={fishingRules}
              payouts={fishingPayouts}
            />
            <div className="fishing-side-jackpot luxury-panel-soft p-4">
              <span>彩金桌</span>
              <strong>{FISHING_JACKPOT.amount.toLocaleString()}</strong>
              <p>首領鯨王出現時，舞台會提高警示與音樂張力。高倍率目標需要集中火力。</p>
            </div>
            <div className="fishing-species-card luxury-panel-soft p-4">
              <p className="gold-muted text-xs font-black uppercase tracking-[0.24em]">魚種表</p>
              <h3 className="brand-title mt-1 text-xl font-black text-yellow-100">魚種倍率表</h3>
              <div className="mt-3 grid gap-2">
                {FISHING_DISPLAY_SPECIES.map((fish) => (
                  <div key={fish.id} className="fishing-species-row">
                    <span
                      className="fishing-species-swatch"
                      style={{ background: fish.swatch }}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{fish.name}</strong>
                      <small>
                        {fish.rarity} / {fish.multiplier}
                      </small>
                      <p>{fish.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <section className="fishing-bottom-info" aria-label="捕魚機補充資訊">
          <FishingFishInfoPanel
            betPerShot={betPerShot || selectedBet}
            fishTable={decoratedFishTable}
          />
        </section>
      </main>
    </AppShell>
  )
}
