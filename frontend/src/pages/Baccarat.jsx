import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import BaccaratRoadmap from '../components/BaccaratRoadmap'
import BaccaratBettingMat from '../components/baccarat/BaccaratBettingMat'
import BaccaratChipTray from '../components/baccarat/BaccaratChipTray'
import BaccaratHandPanel from '../components/baccarat/BaccaratHandPanel'
import BaccaratSettlementPanel from '../components/baccarat/BaccaratSettlementPanel'
import BaccaratSideBets from '../components/baccarat/BaccaratSideBets'
import BaccaratStatusBar from '../components/baccarat/BaccaratStatusBar'
import BaccaratTableHeader from '../components/baccarat/BaccaratTableHeader'
import { fetchWallet, setBalance } from '../store/slices/walletSlice'
import { betBaccarat } from '../store/slices/gameSlice'
import { BET_LABELS } from '../utils/baccaratGame'
import { soundEngine } from '../casino-fx/sound/SoundEngine'
import { useBgm } from '../casino-fx/sound/useBgm'
import GoldBurst from '../casino-fx/fx/GoldBurst'
import { CoinRainPro, RedEnvelopeRain } from '../casino-fx/fx/FallRain'
import BrushBanner from '../casino-fx/fx/BrushBanner'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'
import '../styles/games/baccarat.css'

const SUIT_BY_SYMBOL = { '♠': 'spade', '♥': 'heart', '♦': 'diamond', '♣': 'club' }
const MIN_BET = 100
const MAX_BET = 5000
const DEAL_STEP_DELAY_MS = 260
const SQUEEZE_STORAGE_KEY = 'lucky-star-baccarat-squeeze-v1'
const initialBets = { Player: 0, Banker: 0, Tie: 0 }

const baccaratRules = [
  '先選擇閒家、莊家或和局，再以籌碼盤或自訂金額下注；目前主注維持單區下注。',
  'A 計 1 點，2 到 9 依牌面計點，10、J、Q、K 計 0 點；總和只取個位數。',
  '發牌與補牌由伺服器依標準百家樂規則結算，必要時閒家或莊家會補第三張牌。',
  '閒家 1:1、莊家 0.95:1、和局 8:1；和局時押莊或押閒退回本金。',
  '每局另有 0.5% 返水，錢包餘額以後端回傳結果為準。',
]

const baccaratPayouts = [
  { label: '閒家 Player', value: '1 : 1' },
  { label: '莊家 Banker', value: '0.95 : 1' },
  { label: '和局 Tie', value: '8 : 1' },
]

function parseCard(card) {
  if (!card) return null
  if (typeof card === 'object') return card
  const str = String(card)
  const suit = SUIT_BY_SYMBOL[str.slice(-1)]
  return suit ? { rank: str.slice(0, -1), suit } : { rank: str, suit: 'spade' }
}

function capitalizeWinner(winner) {
  if (!winner) return ''
  return winner.charAt(0).toUpperCase() + winner.slice(1).toLowerCase()
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString()
}

function getSqueezeMode(playerId) {
  try {
    const all = JSON.parse(localStorage.getItem(SQUEEZE_STORAGE_KEY) || '{}')
    return all[playerId] === true
  } catch {
    return false
  }
}

function saveSqueezeMode(playerId, value) {
  try {
    const all = JSON.parse(localStorage.getItem(SQUEEZE_STORAGE_KEY) || '{}')
    localStorage.setItem(SQUEEZE_STORAGE_KEY, JSON.stringify({ ...all, [playerId]: value }))
  } catch {
    // localStorage 不可用時忽略寫入
  }
}

function buildBets(selectedBet, amount) {
  return { ...initialBets, [selectedBet]: Number(amount) || 0 }
}

function waitForDealStep() {
  return new Promise((resolve) => window.setTimeout(resolve, DEAL_STEP_DELAY_MS))
}

function buildHiddenCards(count) {
  return Array.from({ length: count }, () => null)
}

function buildDealSteps(playerCards, bankerCards) {
  const steps = [
    { side: 'player', count: 1, message: '閒家第一張入桌' },
    { side: 'banker', count: 1, message: '莊家第一張入桌' },
    { side: 'player', count: 2, message: '閒家第二張入桌' },
    { side: 'banker', count: 2, message: '莊家第二張入桌' },
    { side: 'player', count: 3, message: '閒家補牌' },
    { side: 'banker', count: 3, message: '莊家補牌' },
  ]

  return steps.filter((step) => (step.side === 'player' ? playerCards.length : bankerCards.length) >= step.count)
}
export default function Baccarat() {
  const dispatch = useDispatch()
  const balance = useSelector((state) => state.wallet.balance)
  const player = useSelector((state) => state.auth.player)
  const [phase, setPhase] = useState('idle')
  const [selectedBet, setSelectedBet] = useState('')
  const [betAmount, setBetAmount] = useState('100')
  const [bets, setBets] = useState(initialBets)
  const [lastBet, setLastBet] = useState(null)
  const [playerCards, setPlayerCards] = useState([])
  const [bankerCards, setBankerCards] = useState([])
  const [playerScore, setPlayerScore] = useState(null)
  const [bankerScore, setBankerScore] = useState(null)
  const [winner, setWinner] = useState('')
  const [roundId, setRoundId] = useState('')
  const [resultMessage, setResultMessage] = useState('')
  const [roundProfit, setRoundProfit] = useState(null)
  const [roundPayout, setRoundPayout] = useState(null)
  const [roundBet, setRoundBet] = useState(null)
  const [sessionProfit, setSessionProfit] = useState(null)
  const [history, setHistory] = useState([])
  const [squeezeMode, setSqueezeModeState] = useState(() => getSqueezeMode(player?.id))
  const [concealed, setConcealed] = useState(false)
  const [revealedCount, setRevealedCount] = useState(0)
  const [dealingStep, setDealingStep] = useState('')
  const [dealAnimationSeed, setDealAnimationSeed] = useState(1)
  const [chipFlight, setChipFlight] = useState({ betType: '', nonce: 0 })
  const [selectedSideBets, setSelectedSideBets] = useState([])
  const pendingRef = useRef(null)
  const stageRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })

  // 發牌/咪牌時 BGM 升到高潮層（疊入輕柔 ride 推進），結算後回一般層。
  useBgm('baccarat', true, { intensity: phase === 'dealing' || phase === 'squeezing' ? 2 : 1 })
  useGameLeaveGuard(phase === 'dealing' || phase === 'squeezing', '本局尚未完成，確定要離開嗎？')

  useEffect(() => {
    setSqueezeModeState(getSqueezeMode(player?.id))
  }, [player?.id])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('baccarat-fullscreen-active', isFullscreen)
    return () => document.body.classList.remove('baccarat-fullscreen-active')
  }, [isFullscreen])

  const numericBetAmount = useMemo(() => Number(betAmount), [betAmount])
  const amountInRange = Number.isFinite(numericBetAmount) && numericBetAmount >= MIN_BET && numericBetAmount <= MAX_BET
  const notEnoughBalance = amountInRange && balance < numericBetAmount
  const locked = phase === 'dealing' || phase === 'squeezing'
  const canSubmit = Boolean(selectedBet) && amountInRange && !notEnoughBalance && !locked
  const doubleAmount = Number.isFinite(numericBetAmount) ? numericBetAmount * 2 : 0
  const repeatDisabled = !lastBet || lastBet.amount > balance || locked
  const doubleDisabled = !selectedBet || !amountInRange || doubleAmount > MAX_BET || doubleAmount > balance || locked
  const clearDisabled = !selectedBet && Object.values(bets).every((amount) => amount === 0)
  const submitLabel = locked ? '發牌中...' : notEnoughBalance ? '星幣不足' : phase === 'settled' ? '開始下一局' : '開始發牌'
  const activeRoundBet = roundBet || (selectedBet ? { selectedBet, amount: numericBetAmount, rebate: null } : null)
  const trayHint = (() => {
    if (!selectedBet) return '請先點選閒家、和局或莊家下注區；也可以按開始發牌查看提示。'
    if (!amountInRange) return `下注金額需介於 ${MIN_BET.toLocaleString()} ~ ${MAX_BET.toLocaleString()} 星幣。`
    if (notEnoughBalance) return '星幣不足，無法開始發牌。'
    if (doubleAmount > MAX_BET) return '加倍後會超過單局 5,000 星幣上限。'
    if (doubleAmount > balance) return '加倍後會超過可用星幣。'
    if (phase === 'squeezing') return '請先完成咪牌或直接開牌。'
    return '點擊下注區會把目前籌碼套用到該區；目前後端維持單區下注。'
  })()
  const dealerCue = dealingStep || resultMessage || trayHint

  const applyResult = (payload) => {
    const { result, nextWinner, profit, betArea, amount } = payload
    const payout = result.payout ?? 0
    const rebate = result.rebate ?? 0
    const isDirectHit = betArea.toLowerCase() === nextWinner.toLowerCase()
    const isPush = nextWinner === 'Tie' && betArea !== 'Tie'

    setPlayerScore(result.playerPoints ?? null)
    setBankerScore(result.bankerPoints ?? null)
    setWinner(nextWinner)
    setRoundId(result.roundId || '')
    setRoundPayout(payout)
    setRoundProfit(profit)
    setSessionProfit((prev) => (prev ?? 0) + profit)
    setRoundBet({ selectedBet: betArea, amount, rebate, payout })
    setLastBet({ selectedBet: betArea, amount })
    setResultMessage(
      isPush
        ? `和局退回本金 ${formatCoins(payout)} 星幣，另返水 ${formatCoins(rebate)} 星幣。`
        : isDirectHit
          ? `命中 ${BET_LABELS[nextWinner]}，本局淨利 ${formatCoins(profit)} 星幣，另返水 ${formatCoins(rebate)} 星幣。`
          : `${BET_LABELS[nextWinner]} 勝出，本局損失 ${formatCoins(amount)} 星幣，另返水 ${formatCoins(rebate)} 星幣。`,
    )
    setHistory((prev) => [...prev, { winner: nextWinner, roundId: result.roundId }].slice(-50))
    setConcealed(false)
    setPhase('settled')
    setDealingStep('')
    pendingRef.current = null

    if (profit > 0) {
      setBurstTrigger((n) => n + 1)
      if (nextWinner === 'Tie') {
        soundEngine.play('winEpic')
        setBanner((prev) => ({ trigger: prev.trigger + 1, text: '大吉大利', level: 3 }))
        setCoinDensity('epic')
        setCoinTrigger((n) => n + 1)
        setEnvelopeTrigger((n) => n + 1)
      } else if (profit >= 2000) {
        soundEngine.play('winBig')
        setBanner((prev) => ({ trigger: prev.trigger + 1, text: '恭喜發財', level: 2 }))
        setCoinDensity('heavy')
        setCoinTrigger((n) => n + 1)
      } else {
        soundEngine.play('winSmall')
        setCoinDensity('light')
        setCoinTrigger((n) => n + 1)
      }
      if (profit >= 10000) {
        announcePlayerWin({
          playerName: player?.nickname || player?.username,
          game: 'baccarat',
          amount: payout,
        })
      }
    } else if (profit === 0) {
      soundEngine.play('coin')
    } else {
      soundEngine.play('fishEscape', { volume: 0.5 })
    }

    if (result.wallet) {
      dispatch(setBalance(result.wallet))
    } else {
      dispatch(fetchWallet())
    }
  }

  useEffect(() => {
    if (!concealed || !pendingRef.current) return
    const totalCards = playerCards.length + bankerCards.length
    if (totalCards > 0 && revealedCount >= totalCards) {
      applyResult(pendingRef.current)
    }
    // applyResult 會觸發大量結算副作用，只在揭牌數變更時檢查即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedCount, concealed, playerCards.length, bankerCards.length])

  const handlePlaceBet = (betType) => {
    if (locked) return
    setChipFlight((prev) => ({ betType, nonce: prev.nonce + 1 }))
    const nextAmount = Number.isFinite(numericBetAmount) ? numericBetAmount : 0
    setSelectedBet(betType)
    setBets(buildBets(betType, nextAmount))
    setPhase('betting')
    soundEngine.play('chip')
  }

  const handleAmountChange = (value) => {
    if (locked) return
    setBetAmount(value)
    if (selectedBet) setBets(buildBets(selectedBet, Number(value)))
    if (selectedBet) setPhase('betting')
  }

  const handleChipSelect = (amount) => {
    if (locked) return
    if (selectedBet) setChipFlight((prev) => ({ betType: selectedBet, nonce: prev.nonce + 1 }))
    setBetAmount(String(amount))
    if (selectedBet) setBets(buildBets(selectedBet, amount))
    if (selectedBet) setPhase('betting')
    soundEngine.play('chip')
  }

  const handleClearBet = () => {
    if (locked) return
    setSelectedBet('')
    setBets(initialBets)
    setSelectedSideBets([])
    setPhase('idle')
    setResultMessage('已清除本局下注。')
    soundEngine.play('click')
  }

  const handleRepeatBet = () => {
    if (!lastBet || locked) return
    setSelectedBet(lastBet.selectedBet)
    setBetAmount(String(lastBet.amount))
    setBets(buildBets(lastBet.selectedBet, lastBet.amount))
    setPhase('betting')
    soundEngine.play('chip')
  }

  const handleDoubleBet = () => {
    if (doubleDisabled || locked) return
    setBetAmount(String(doubleAmount))
    setBets(buildBets(selectedBet, doubleAmount))
    setPhase('betting')
    soundEngine.play('chip')
  }

  const handleDeal = async () => {
    if (!selectedBet) {
      setResultMessage('請先選擇下注項目。')
      setRoundProfit(null)
      return
    }
    if (!amountInRange) {
      setResultMessage(`下注金額需介於 ${MIN_BET.toLocaleString()} ~ ${MAX_BET.toLocaleString()} 星幣。`)
      setRoundProfit(null)
      return
    }
    if (balance < numericBetAmount) {
      setResultMessage('星幣不足，無法開始發牌。')
      setRoundProfit(null)
      return
    }
    if (locked) return

    setPhase('dealing')
    setResultMessage('停止下注，發牌中...')
    setWinner('')
    setRoundId('')
    setRoundProfit(null)
    setRoundPayout(null)
    setRoundBet({ selectedBet, amount: numericBetAmount, rebate: null, payout: null })
    setPlayerCards([])
    setBankerCards([])
    setPlayerScore(null)
    setBankerScore(null)
    setConcealed(false)
    setRevealedCount(0)
    setDealingStep('荷官洗牌，準備發牌')
    setDealAnimationSeed(Math.floor(Math.random() * 1000000) + 1)
    pendingRef.current = null
    soundEngine.play('chip')

    try {
      const result = await dispatch(
        betBaccarat({ area: selectedBet.toLowerCase(), amount: numericBetAmount }),
      ).unwrap()
      const nextWinner = capitalizeWinner(result.winner)
      const profit = (result.payout ?? 0) - numericBetAmount
      const payload = { result, nextWinner, profit, betArea: selectedBet, amount: numericBetAmount }
      const parsedPlayerCards = (result.playerCards || []).map(parseCard)
      const parsedBankerCards = (result.bankerCards || []).map(parseCard)

      const dealSteps = buildDealSteps(parsedPlayerCards, parsedBankerCards)
      for (const step of dealSteps) {
        setDealingStep(step.message)
        soundEngine.play('cardDeal')
        if (step.side === 'player') {
          setPlayerCards(buildHiddenCards(step.count))
        } else {
          setBankerCards(buildHiddenCards(step.count))
        }
        await waitForDealStep()
      }

      setPlayerCards(parsedPlayerCards)
      setBankerCards(parsedBankerCards)

      if (squeezeMode) {
        pendingRef.current = payload
        setRevealedCount(0)
        setConcealed(true)
        setPhase('squeezing')
        setDealingStep('')
        setResultMessage('長按牌面慢慢搓開，或點「直接開牌」。')
      } else {
        applyResult(payload)
      }
    } catch (error) {
      setResultMessage(typeof error === 'string' ? error : '本局結算失敗，請稍後再試。')
      setRoundProfit(null)
      setRoundPayout(null)
      setDealingStep('')
      setPhase(selectedBet ? 'betting' : 'idle')
    }
  }



  const handleToggleSideBet = (sideBetId) => {
    if (locked) return
    setSelectedSideBets((prev) => (
      prev.includes(sideBetId)
        ? prev.filter((id) => id !== sideBetId)
        : [...prev, sideBetId]
    ))
    soundEngine.play('click')
  }

  const handleClearSideBets = () => {
    if (locked || selectedSideBets.length === 0) return
    setSelectedSideBets([])
    soundEngine.play('click')
  }
  const handleFullscreen = async () => {
    if (!stageRef.current || !document.fullscreenEnabled) return
    try {
      if (document.fullscreenElement === stageRef.current) {
        await document.exitFullscreen()
      } else {
        await stageRef.current.requestFullscreen()
      }
    } catch {
      setResultMessage('目前瀏覽器無法切換全螢幕。')
    }
  }
  const handleRevealAll = () => {
    if (pendingRef.current) {
      soundEngine.play('cardFlip')
      applyResult(pendingRef.current)
    }
  }

  const toggleSqueezeMode = () => {
    setSqueezeModeState((prev) => {
      const next = !prev
      saveSqueezeMode(player?.id, next)
      return next
    })
    soundEngine.play('click')
  }

  return (
    <AppShell>
      <GoldBurst trigger={burstTrigger} origin={{ x: 50, y: 40 }} />
      <CoinRainPro trigger={coinTrigger} density={coinDensity} />
      <RedEnvelopeRain trigger={envelopeTrigger} density="heavy" />
      <BrushBanner trigger={banner.trigger} text={banner.text} level={banner.level} />

      <section className="baccarat-page">
        <GameRuleCard title="百家樂規則" subtitle="查看點數計算、補牌、賠率與返水。" rules={baccaratRules} payouts={baccaratPayouts} />
        <div className="baccarat-main-grid">
          <div
            ref={stageRef}
            className={[
              'baccarat-table',
              `baccarat-table--${phase}`,
              phase === 'settled' ? 'baccarat-table--settled' : '',
              isFullscreen ? 'baccarat-table--fullscreen' : '',
            ].join(' ')}
          >
            <BaccaratTableHeader
              phase={phase}
              balance={balance}
              roundCount={history.length}
              sessionProfit={sessionProfit}
              squeezeMode={squeezeMode}
              onToggleSqueeze={toggleSqueezeMode}
              onFullscreen={handleFullscreen}
              isFullscreen={isFullscreen}
            />
            <BaccaratStatusBar
              phase={phase}
              selectedBet={selectedBet}
              betAmount={betAmount}
              roundProfit={roundProfit}
              historyCount={history.length}
              roundId={roundId}
            />

            <div className="baccarat-table-felt">
              <div className="baccarat-dealer-cue" aria-live="polite">
                <span>{dealerCue}</span>
              </div>
              <div className="baccarat-duel-grid">
                <BaccaratHandPanel
                  title="Banker"
                  localName="莊家"
                  score={bankerScore}
                  cards={bankerCards}
                  isDealing={phase === 'dealing'}
                  winner={winner}
                  winnerKey="Banker"
                  concealed={concealed}
                  dealSeed={dealAnimationSeed}
                  onCardRevealed={() => setRevealedCount((n) => n + 1)}
                />

                <div className="baccarat-duel-center">
                  <div className={['baccarat-vs-medallion', winner ? `is-${winner.toLowerCase()}` : ''].join(' ')} aria-hidden="true">
                    <span>{winner ? BET_LABELS[winner]?.split(' ')[0] : 'VS'}</span>
                    <small>{winner ? '勝出' : '和局賠 8:1'}</small>
                  </div>
                  {concealed && (
                    <button type="button" onClick={handleRevealAll} className="baccarat-squeeze-toggle baccarat-reveal-center-button">
                      直接開牌
                    </button>
                  )}
                </div>

                <BaccaratHandPanel
                  title="Player"
                  localName="閒家"
                  score={playerScore}
                  cards={playerCards}
                  isDealing={phase === 'dealing'}
                  winner={winner}
                  winnerKey="Player"
                  concealed={concealed}
                  dealSeed={dealAnimationSeed}
                  onCardRevealed={() => setRevealedCount((n) => n + 1)}
                />
              </div>

              <BaccaratBettingMat
                bets={bets}
                selectedBet={selectedBet}
                disabled={locked}
                onPlaceBet={handlePlaceBet}
                chipFlight={chipFlight}
              />

              <BaccaratChipTray
                amount={betAmount}
                disabled={locked}
                canSubmit={canSubmit}
                submitLabel={submitLabel}
                clearDisabled={clearDisabled}
                repeatDisabled={repeatDisabled}
                doubleDisabled={doubleDisabled}
                hint={trayHint}
                onAmountChange={handleAmountChange}
                onChipSelect={handleChipSelect}
                onClear={handleClearBet}
                onRepeat={handleRepeatBet}
                onDouble={handleDoubleBet}
                onSubmit={handleDeal}
              />

              <BaccaratSideBets
                selectedSideBets={selectedSideBets}
                disabled={locked}
                phase={phase}
                playerCards={playerCards}
                bankerCards={bankerCards}
                playerScore={playerScore}
                bankerScore={bankerScore}
                winner={winner}
                onToggleSideBet={handleToggleSideBet}
                onClearSideBets={handleClearSideBets}
              />

              <BaccaratSettlementPanel
                phase={phase}
                winner={winner}
                roundBet={activeRoundBet}
                selectedBet={selectedBet}
                betAmount={betAmount}
                payout={roundPayout}
                roundProfit={roundProfit}
                rebate={roundBet?.rebate}
                resultMessage={resultMessage}
                roundId={roundId}
                sideBetCount={selectedSideBets.length}
              />
            </div>

            <aside className="baccarat-side-panel">
              <BaccaratRoadmap history={history} />
            </aside>
          </div>
        </div>
      </section>
    </AppShell>
  )
}
