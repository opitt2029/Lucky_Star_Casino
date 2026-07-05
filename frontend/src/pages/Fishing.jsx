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
import { fishingApi } from '../services/fishingApi'
import { fetchWallet } from '../store/slices/walletSlice'
import {
  useFishingSession,
  BUYIN_TIERS,
  BUYIN_MIN,
  BUYIN_MAX,
} from '../hooks/useFishingSession'
import { useSound } from '../casino-fx/sound/useSound'
import { useBgm } from '../casino-fx/sound/useBgm'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'
import '../components/Fishing.css'
import {
  FISHING_DISPLAY_SPECIES,
  FISHING_JACKPOT,
  FISHING_SKILLS,
} from '../data/fishingGameData'
import { FISHING_AMMO_OPTIONS, getFishingAmmoByLevel } from '../data/fishingConfig'

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

function ShotVerifyPanel({ sessionId, shots, fishTable, play }) {
  const [results, setResults] = useState({})
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
      const data = await fishingApi.verifyShot({
        sessionId,
        shotSeq: shot.shotSeq,
        fishType: shot.fishType,
        betPerShot: shot.betPerShot,
      })
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
      <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">公平性驗證</p>
      <p className="text-[11px] font-bold text-yellow-100/56">
        結算後可用每一發紀錄重新驗證命中與派彩，確認本局結果與伺服器承諾一致。
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
                第 {shot.shotSeq} 發, {nameByCode[shot.fishType] || shot.fishType},
                {shot.hit ? ` 捕獲 +${shot.payout.toLocaleString()}` : ' 未捕獲'}
              </span>
              {state.data ? (
                <span
                  className={[
                    'shrink-0 font-black',
                    state.data.commitmentValid && state.consistent ? 'text-emerald-300' : 'text-red-300',
                  ].join(' ')}
                  title={state.data.message}
                >
                  {state.data.commitmentValid && state.consistent ? '驗證通過' : '需要檢查'}
                </span>
              ) : state.error ? (
                <span className="shrink-0 font-black text-red-300">{state.error}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => verify(shot)}
                  disabled={state.loading}
                  className="shrink-0 rounded border border-yellow-200/30 px-3 py-1 font-black text-yellow-100/80 transition hover:border-yellow-200/70 disabled:opacity-50"
                >
                  {state.loading ? '驗證中' : '驗證'}
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
  const buyInValid = Number.isInteger(selectedBuyIn) && selectedBuyIn >= BUYIN_MIN && selectedBuyIn <= BUYIN_MAX
  const topUpValid = Number.isInteger(selectedTopUp) && selectedTopUp >= BUYIN_MIN && selectedTopUp <= BUYIN_MAX
  const canStart = buyInValid && balance >= selectedBuyIn
  const jackpotAmount = FISHING_JACKPOT.amount.toLocaleString()

  const arenaResultsRef = useRef(null)
  const session = useFishingSession({
    onResults: (results, ctx) => {
      arenaResultsRef.current?.(results, ctx)
    },
  })

  useBgm(bossActive ? 'boss' : 'fishing', session.phase === 'playing')

  const handleCatch = useCallback(
    ({ payout, effMult }) => {
      if (effMult >= 30) {
        play('winEpic')
        announcePlayerWin({ playerName: player?.nickname || player?.username, game: 'fishing', amount: payout })
      } else if (effMult >= 10) {
        play('winBig')
      } else {
        play('winSmall')
      }
    },
    [play, player],
  )

  // 僅供進場前選擇：面額/砲台為 session 級參數（ADR-004 整場固定），hook 在 playing 階段會拒絕變更。
  const handleAmmoSelect = (option) => {
    play('click')
    const betChanged = session.changeBetPerShot(option.costPerShot)
    const cannonChanged = session.changeCannonLevel(option.level)
    if (betChanged || cannonChanged) setSelectedAmmoLevel(option.level)
  }

  const handleStart = () => {
    if (!canStart) return
    play('click')
    setSessionBuyIn(selectedBuyIn)
    session.startSession({ buyIn: selectedBuyIn, cannonLevel: selectedAmmoLevel, betPerShot: selectedBet })
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
    [play, session],
  )

  const { phase, sessionBalance, stats, settleResult, error, betPerShot, cannonLevel } = session
  const activeAmmo = FISHING_AMMO_OPTIONS.find((option) => option.costPerShot === betPerShot) || getFishingAmmoByLevel(cannonLevel)
  const canSettle = phase === 'playing' && (sessionBalance > 0 || stats.totalShots > 0 || stats.totalPayout > 0)
  const canSubmitTopUp =
    phase === 'playing' && sessionBalance < betPerShot && topUpValid && balance >= selectedTopUp && !session.topUpLoading
  useGameLeaveGuard(
    phase === 'playing',
    '本局尚未收網結算，離開頁面可能會中斷目前捕魚流程。請先按「收網結算」將餘額回到錢包。',
  )

  useEffect(() => {
    if (phase === 'playing' && session.session?.buyIn && sessionBuyIn === null) {
      setSessionBuyIn(session.session.buyIn)
    }
    if (phase === 'playing' && sessionBalance >= betPerShot && isTopUpModalOpen) {
      setIsTopUpModalOpen(false)
    }
  }, [betPerShot, isTopUpModalOpen, phase, session.session?.buyIn, sessionBalance, sessionBuyIn])

  const roundProfit = sessionBuyIn === null ? null : sessionBalance - sessionBuyIn

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
          <div className="fishing-main grid gap-4 content-start">
            {phase === 'playing' || phase === 'settling' ? (
              <>
                <div className="fishing-hud">
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">本局餘額</span>
                    <span className="fishing-hud__value tabular-nums">{sessionBalance.toLocaleString()}</span>
                  </div>
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">累積派彩</span>
                    <span className="fishing-hud__value tabular-nums">{stats.totalPayout.toLocaleString()}</span>
                  </div>
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">已發射</span>
                    <span className="fishing-hud__value tabular-nums">{stats.totalShots.toLocaleString()} 發</span>
                  </div>
                  <div className="fishing-hud__metric">
                    <span className="fishing-hud__label">捕獲數</span>
                    <span className="fishing-hud__value tabular-nums">{stats.caughtCount.toLocaleString()} 尾</span>
                  </div>
                  {roundProfit !== null && (
                    <div className="fishing-hud__metric">
                      <span className="fishing-hud__label">本局盈虧</span>
                      <span
                        className={`fishing-hud__value tabular-nums ${roundProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                      >
                        {roundProfit >= 0 ? `+${roundProfit.toLocaleString()}` : roundProfit.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="fishing-hud__metric fishing-hud__metric--wide">
                    <span className="fishing-hud__label">炮台資訊</span>
                    <span className="fishing-hud__value">Lv {cannonLevel} / 每發 {betPerShot}</span>
                  </div>
                </div>

                <div ref={fullscreenTargetRef} className={`fishing-fullscreen-surface ${isFullscreen ? 'fishing-game--fullscreen' : ''}`}>
                  <div className="fishing-stage-card">
                  <div className="fishing-stage-marquee" aria-label="捕魚桌狀態">
                    <span>深海戰場</span>
                    <strong>{bossActive ? '首領追獵中' : 'Lucky Fishing'}</strong>
                    <span className={error && phase === 'playing' ? 'is-alert' : bossActive && phase === 'playing' ? 'is-boss' : ''}>
                      {error && phase === 'playing'
                        ? error
                        : bossActive && phase === 'playing'
                          ? '彩金鯨王出沒'
                          : phase === 'settling'
                            ? '結算中'
                            : '手動瞄準'}
                    </span>
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
                  <div className="fishing-stage-frame">
                    <FishingFullscreenButton
                      isFullscreen={isFullscreen}
                      disabled={!fullscreenSupported}
                      message={fullscreenMessage}
                      onToggle={handleToggleFullscreen}
                    />
                    <Suspense
                      fallback={
                        <div className="fishing-arena grid place-items-center">
                          <p className="brand-title text-xl font-black text-yellow-100">載入捕魚桌中...</p>
                        </div>
                      }
                    >
                      <FishingCanvas
                        phase={phase}
                        betPerShot={betPerShot}
                        cannonLevel={cannonLevel}
                      ammoTone={activeAmmo.tone}
                        fishTable={session.fishTable}
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
                    <FishingControlDock
                      activeAmmo={activeAmmo}
                      ammoOptions={FISHING_AMMO_OPTIONS}
                      cannonLevel={cannonLevel}
                      ammoTone={activeAmmo.tone}
                      canSettle={canSettle}
                      disabledReason={canSettle ? '' : '目前沒有可結算的本局餘額或射擊紀錄'}
                      isSettling={phase === 'settling'}
                      onAmmoSelect={handleAmmoSelect}
                      onSettle={handleEnd}
                    />
                  </div>
                  {error && phase === 'playing' && (
                    <div className="fishing-api-alert" role="status">
                      {error.includes('餘額') ? '餘額不足，請先加值或降低彈藥額度。' : error}
                    </div>
                  )}
                  {fullscreenMessage && (
                    <div className="fishing-api-alert fishing-api-alert--info" role="status">
                      {fullscreenMessage}
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

                {isTopUpModalOpen && phase === 'playing' && (
                  <div className="fishing-topup-modal" role="dialog" aria-modal="true" aria-labelledby="fishing-topup-title">
                    <div className="fishing-topup-modal__backdrop" onClick={() => setIsTopUpModalOpen(false)} />
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
                          onChange={(e) => setTopUpText(e.target.value.replace(/\D/g, '').slice(0, 7))}
                          aria-label="臨時加值金額"
                        />
                      </label>
                      <div className="fishing-topup-modal__wallet">錢包餘額：{balance.toLocaleString()}</div>
                      {balance < selectedTopUp && <div className="fishing-topup-modal__error">錢包餘額不足</div>}
                      <div className="fishing-topup-modal__actions">
                        <button type="button" className="fishing-topup-modal__cancel" onClick={() => setIsTopUpModalOpen(false)}>
                          取消
                        </button>
                        <button type="button" className="fishing-topup-modal__submit" onClick={handleTopUp} disabled={!canSubmitTopUp}>
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
                  <p className="brand-title text-xl font-black text-yellow-100">讀取捕魚資料中...</p>
                ) : phase === 'settled' && settleResult ? (
                  <FishingSettlementPanel
                    settleResult={settleResult}
                    sessionBuyIn={sessionBuyIn}
                    onNewRound={session.resetToIdle}
                  >
                    <ShotVerifyPanel
                      sessionId={settleResult.sessionId}
                      shots={settleResult.shots}
                      fishTable={session.fishTable}
                      play={play}
                    />
                  </FishingSettlementPanel>
                ) : (
                  <div className="grid w-full max-w-md gap-5">
                    <div>
                      <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">進場設定</p>
                      <h3 className="brand-title mt-1 text-3xl font-black text-yellow-100">進入漁場</h3>
                      <p className="mt-2 text-sm font-bold text-yellow-100/64">
                        輸入本局要帶入漁場的星幣並選擇彈藥；子彈面額與砲台進場後固定，收網結算後可重新選擇。
                      </p>
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
                        placeholder={`可輸入 ${BUYIN_MIN.toLocaleString()} 到 ${BUYIN_MAX.toLocaleString()}`}
                        aria-label="自訂進場金額"
                        className={[
                          'min-h-11 rounded border bg-red-950/70 px-3 text-sm font-black text-yellow-100 outline-none transition',
                          buyInValid ? 'border-yellow-200/20 focus:border-yellow-200/70' : 'border-red-400/50',
                        ].join(' ')}
                      />
                      {!buyInValid && (
                        <p className="text-[11px] font-bold text-red-300">
                          進場金額需介於 {BUYIN_MIN.toLocaleString()} 到 {BUYIN_MAX.toLocaleString()} 星幣。
                        </p>
                      )}
                    </div>

                    <div className="grid gap-2 text-left">
                      <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">選擇彈藥（遊戲中可切換）</p>
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
                            <span className="block text-[11px] font-bold opacity-80">{option.costPerShot.toLocaleString()} / 發</span>
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
                      <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>
                    )}
                  </div>
                )}

              </div>
            )}
          </div>

          <aside className="fishing-side-panel grid gap-4 content-start">
            <MetricCard label="可用星幣" value={walletLoading ? '同步中' : balance.toLocaleString()} caption="進場前請確認錢包餘額。" tone="light" />
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
                    <span className="fishing-species-swatch" style={{ background: fish.swatch }} aria-hidden="true" />
                    <div>
                      <strong>{fish.name}</strong>
                      <small>{fish.rarity} / {fish.multiplier}</small>
                      <p>{fish.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="fishing-skill-card luxury-panel-soft p-4">
              <p className="gold-muted text-xs font-black uppercase tracking-[0.24em]">技能</p>
              <h3 className="brand-title mt-1 text-xl font-black text-yellow-100">技能面板</h3>
              <div className="fishing-skill-grid mt-3">
                {FISHING_SKILLS.map((skill) => (
                  <button key={skill.id} type="button" className={`fishing-skill-button is-${skill.tone}`} disabled>
                    <strong>{skill.label}</strong>
                    <span>{skill.status}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <section className="fishing-bottom-info" aria-label="捕魚機補充資訊">
          <FishingFishInfoPanel betPerShot={selectedBet} />
        </section>
      </main>
    </AppShell>
  )
}
