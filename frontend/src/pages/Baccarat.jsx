import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import BaccaratRoadmap from '../components/BaccaratRoadmap'
import { fetchWallet, setBalance } from '../store/slices/walletSlice'
import { betBaccarat } from '../store/slices/gameSlice'
import { BET_LABELS, BET_ODDS, BET_TYPES } from '../utils/baccaratGame'
import { soundEngine } from '../casino-fx/sound/SoundEngine'
import { useBgm } from '../casino-fx/sound/useBgm'
import GoldBurst from '../casino-fx/fx/GoldBurst'
import { CoinRainPro, RedEnvelopeRain } from '../casino-fx/fx/FallRain'
import BrushBanner from '../casino-fx/fx/BrushBanner'
import { announcePlayerWin } from '../casino-fx/announce/announceBus'
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

const initialCards = []
const suitSymbols = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
}
const redSuits = new Set(['heart', 'diamond'])

// 後端回傳卡牌為顯示字串（如 "A♠"、"10♦"），前端 CardView 需要 { rank, suit } 物件。
// 此函式同時相容：後端帶花色字串、mock 的裸 rank 字串、以及既有 { rank, suit } 物件。
const SUIT_BY_SYMBOL = { '♠': 'spade', '♥': 'heart', '♦': 'diamond', '♣': 'club' }
function parseCard(card) {
  if (!card) return null
  if (typeof card === 'object') return card
  const str = String(card)
  const suit = SUIT_BY_SYMBOL[str.slice(-1)]
  return suit ? { rank: str.slice(0, -1), suit } : { rank: str, suit: 'spade' }
}

// 後端 winner 為 player/banker/tie（gameApi 已轉小寫），頁面用 Player/Banker/Tie。
function capitalizeWinner(winner) {
  if (!winner) return ''
  return winner.charAt(0).toUpperCase() + winner.slice(1).toLowerCase()
}
// 後端百家樂單區 @Max(5000)、總額限 100~5000；面額與下注上下限需對齊，避免送出即被 400 退回。
const MIN_BET = 100
const MAX_BET = 5000
const chipDenominations = [100, 200, 500, 1000, 2000, 3000, 5000]
const BET_COLOR_CLASS = {
  Player: 'baccarat-bet-option--player',
  Banker: 'baccarat-bet-option--banker',
  Tie: 'baccarat-bet-option--tie',
}
const baccaratRules = [
  '先選擇閒家、莊家或和局，再輸入下注金額（每區 100 ~ 5,000 星幣）或用面額快速選擇。',
  'A 計 1 點，2 到 9 依牌面計點，10、J、Q、K 計 0 點；兩張牌總和只取個位數。',
  '由伺服器為閒家與莊家各發兩張牌，必要時依標準規則補第三張，點數高者勝出，兩邊同分為和局。',
  '押中依賠率計算獲利（莊家扣 5% 傭金），未押中則損失下注金額；和局時押莊／閒退回本金，結果即時反映在可用星幣。',
  '每局無論輸贏皆享有 0.5% 反水（最低 1 星幣），反水自動入帳，結算後即可查看。',
]
const baccaratPayouts = [
  { label: '閒家 Player', value: '1x' },
  { label: '莊家 Banker', value: '0.95x' },
  { label: '和局 Tie', value: '8x' },
]

function formatCoins(value) {
  return Number(value || 0).toLocaleString()
}

// 咪牌（擠牌）：華人百家樂的儀式感核心。長按牌面緩慢「搓」開（由下往上掀），
// 配沙沙搓牌音；搓滿即翻牌。也可由外層「直接開牌」一次掀開。
const SQUEEZE_HOLD_MS = 1200

function SqueezeCard({ card, index, onRevealed }) {
  const [progress, setProgress] = useState(0)
  const timerRef = useRef(null)
  const progressRef = useRef(0)
  const revealedRef = useRef(false)

  useEffect(() => () => window.clearInterval(timerRef.current), [])

  const finishReveal = () => {
    if (revealedRef.current) return
    revealedRef.current = true
    window.clearInterval(timerRef.current)
    setProgress(1)
    soundEngine.play('cardFlip')
    onRevealed?.()
  }

  const startSqueeze = () => {
    if (revealedRef.current) return
    soundEngine.play('cardRub')
    timerRef.current = window.setInterval(() => {
      progressRef.current = Math.min(progressRef.current + 50 / SQUEEZE_HOLD_MS, 1)
      setProgress(progressRef.current)
      if (Math.random() < 0.3) soundEngine.play('cardRub', { volume: 0.6 })
      if (progressRef.current >= 1) finishReveal()
    }, 50)
  }

  const stopSqueeze = () => {
    window.clearInterval(timerRef.current)
  }

  return (
    <button
      type="button"
      className="baccarat-squeeze"
      onPointerDown={startSqueeze}
      onPointerUp={stopSqueeze}
      onPointerLeave={stopSqueeze}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="長按咪牌"
    >
      <div className="baccarat-squeeze__back">
        <CardView card={null} index={index} isDealing={false} />
      </div>
      <div className="baccarat-squeeze__face" style={{ clipPath: `inset(${(1 - progress) * 100}% 0 0 0)` }}>
        <CardView card={card} index={index} isDealing={false} />
      </div>
      {progress < 1 && <span className="baccarat-squeeze__hint">長按咪牌</span>}
    </button>
  )
}

function CardView({ card, index, isDealing }) {
  const isRed = card && redSuits.has(card.suit)

  return (
    <div
      className={[
        'baccarat-card',
        card ? 'baccarat-card--face' : 'baccarat-card--back',
        isRed ? 'baccarat-card--red' : 'baccarat-card--black',
        isDealing || card ? 'baccarat-card--dealt' : '',
      ].join(' ')}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {card ? (
        <>
          <span className="baccarat-card__corner baccarat-card__corner--top">{card.rank}</span>
          <span className="baccarat-card__suit">{suitSymbols[card.suit]}</span>
          <span className="baccarat-card__corner baccarat-card__corner--bottom">{card.rank}</span>
        </>
      ) : (
        <span className="baccarat-card__back-mark">LS</span>
      )}
    </div>
  )
}

function HandPanel({ title, score, cards, isDealing, winner, winnerKey, concealed = false, onCardRevealed }) {
  const isWinner = winner === winnerKey
  const visibleCards = cards.length ? cards : [null, null]
  const isNatural = !concealed && score !== null && (score === 8 || score === 9)

  return (
    <section
      className={[
        'baccarat-hand',
        isWinner ? 'baccarat-hand--winner' : winner ? 'baccarat-hand--dimmed' : '',
      ].join(' ')}
    >
      <div className="baccarat-hand__header">
        <div>
          <p className="baccarat-hand__eyebrow">{title}</p>
          <h3 className="baccarat-hand__title">{title === 'Player' ? '閒家' : '莊家'}</h3>
          {isNatural && <span className="baccarat-natural-badge">天牌 Natural</span>}
        </div>
        <div className="baccarat-score">
          <span>Score</span>
          <strong>{concealed ? '?' : score === null ? '-' : score}</strong>
        </div>
      </div>
      <div className="baccarat-cards">
        {visibleCards.map((card, index) =>
          concealed && card ? (
            <SqueezeCard
              key={`squeeze-${card.suit}-${card.rank}-${index}`}
              card={card}
              index={index}
              onRevealed={onCardRevealed}
            />
          ) : (
            <CardView
              key={card ? `${card.suit}-${card.rank}-${index}` : `empty-${index}`}
              card={card}
              index={index}
              isDealing={isDealing}
            />
          )
        )}
      </div>
    </section>
  )
}

function ResultItem({ label, value, wide = false }) {
  return (
    <div className={['baccarat-result-item', wide ? 'baccarat-result-item--wide' : ''].join(' ')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const ROAD_STORAGE_KEY = 'lucky-star-baccarat-road-v1'
const SESSION_PROFIT_KEY = 'lucky-star-baccarat-session-profit-v1'
const SQUEEZE_STORAGE_KEY = 'lucky-star-baccarat-squeeze-v1'

function getSqueezeMode(playerId) {
  try {
    const all = JSON.parse(localStorage.getItem(SQUEEZE_STORAGE_KEY) || '{}')
    return all[playerId] === true
  } catch { return false }
}

function saveSqueezeMode(playerId, value) {
  try {
    const all = JSON.parse(localStorage.getItem(SQUEEZE_STORAGE_KEY) || '{}')
    localStorage.setItem(SQUEEZE_STORAGE_KEY, JSON.stringify({ ...all, [playerId]: value }))
  } catch { /* localStorage 不可用時忽略寫入 */ }
}

export default function Baccarat() {
  const dispatch = useDispatch()
  const balance = useSelector((state) => state.wallet.balance)
  const player = useSelector((state) => state.auth.player)
  const [selectedBet, setSelectedBet] = useState('')
  const [betAmount, setBetAmount] = useState('100')
  const [playerCards, setPlayerCards] = useState(initialCards)
  const [bankerCards, setBankerCards] = useState(initialCards)
  const [playerScore, setPlayerScore] = useState(null)
  const [bankerScore, setBankerScore] = useState(null)
  const [winner, setWinner] = useState('')
  const [resultMessage, setResultMessage] = useState('')
  const [isDealing, setIsDealing] = useState(false)
  const [roundProfit, setRoundProfit] = useState(null)
  const [roundBet, setRoundBet] = useState(null)
  // 本場損益 / 路單局史：遊戲「重開」（重新進場或重整）即歸零，只在本次進場內累積。
  const [sessionProfit, setSessionProfit] = useState(null)
  const [history, setHistory] = useState([])
  // 咪牌模式（記住玩家偏好，以 playerId 為 JSON 子 key 隔離多帳號）
  const [squeezeMode, setSqueezeModeState] = useState(() => getSqueezeMode(player?.id))
  const [concealed, setConcealed] = useState(false)
  const [revealedCount, setRevealedCount] = useState(0)
  const pendingRef = useRef(null)
  // 慶祝特效觸發器
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [coinDensity, setCoinDensity] = useState('light')
  const [envelopeTrigger, setEnvelopeTrigger] = useState(0)
  const [banner, setBanner] = useState({ trigger: 0, text: '', level: 1 })
  useBgm('baccarat')
  useGameLeaveGuard(isDealing, '下注進行中，確定要離開嗎？')

  // 「重開即歸零」：進場時清掉舊版可能殘留的本場損益/路單快取。
  // 本場損益與路單僅存在於本次進場的元件狀態，離開或重整即重新計算。
  useEffect(() => {
    try {
      sessionStorage.removeItem(SESSION_PROFIT_KEY)
      sessionStorage.removeItem(ROAD_STORAGE_KEY)
    } catch {
      // 忽略 sessionStorage 不可用
    }
  }, [])

  const numericBetAmount = useMemo(() => Number(betAmount), [betAmount])
  const amountInRange =
    Number.isFinite(numericBetAmount) && numericBetAmount >= MIN_BET && numericBetAmount <= MAX_BET
  // 餘額不足守門：金額在合法範圍但超過可用星幣時，禁止下注並提示（後端仍是最後防線）。
  const notEnoughBalance = amountInRange && balance < numericBetAmount
  const canDeal = selectedBet && amountInRange && !notEnoughBalance && !isDealing && !concealed
  const winnerLabel = winner ? BET_LABELS[winner] : '-'
  const selectedBetLabel = selectedBet ? BET_LABELS[selectedBet] : '尚未選擇'
  const sidebarProfitValue =
    roundProfit === null
      ? '-'
      : `${roundProfit >= 0 ? '+' : '-'}${formatCoins(Math.abs(roundProfit))}`
  const sidebarProfitCaption =
    roundProfit === null
      ? '等待本局結算'
      : roundProfit >= 0
        ? '命中下注後的本局獲利'
        : '未命中，扣除支付面額'
  const resultState =
    roundProfit === null
      ? 'baccarat-result-panel--empty'
      : roundProfit >= 0
        ? winner === 'Tie'
          ? 'baccarat-result-panel--tie'
          : 'baccarat-result-panel--win'
        : 'baccarat-result-panel--loss'

  // 套用結算結果：揭曉勝方、更新路單、引爆慶祝特效。
  // 咪牌模式下會延後到所有牌「搓」開後才呼叫（懸念留到最後一刻）。
  const applyResult = (payload) => {
    const { result, nextWinner, profit, betArea, amount } = payload
    const rebate = result.rebate ?? 0
    const hit = profit >= 0

    setPlayerScore(result.playerPoints ?? null)
    setBankerScore(result.bankerPoints ?? null)
    setWinner(nextWinner)
    setRoundProfit(profit)
    setSessionProfit((prev) => (prev ?? 0) + profit)
    setRoundBet({ selectedBet: betArea, amount, rebate })
    setResultMessage(
      hit
        ? `命中 ${BET_LABELS[nextWinner]}，本局獲利 ${formatCoins(profit)} 星幣，另返水 ${formatCoins(rebate)} 星幣。`
        : `${BET_LABELS[nextWinner]} 勝出，損失 ${formatCoins(amount)} 星幣，本局返水 ${formatCoins(rebate)} 星幣。`
    )
    setHistory((prev) => [...prev, { winner: nextWinner }])
    setConcealed(false)
    pendingRef.current = null

    if (profit > 0) {
      setBurstTrigger((n) => n + 1)
      if (nextWinner === 'Tie') {
        // 押中和局 8 倍：最高規格慶祝
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
          amount: result.payout,
        })
      }
    } else if (profit === 0) {
      // 和局退本金：仍播金幣落袋（LDW：讓「沒輸」聽起來像贏）
      soundEngine.play('coin')
    } else {
      soundEngine.play('fishEscape', { volume: 0.5 })
    }

    // 每局必有 wallet（反水保證每局都有 credit），直接更新餘額。
    if (result.wallet) {
      dispatch(setBalance(result.wallet))
    } else {
      dispatch(fetchWallet())
    }
  }

  // 咪牌模式：全部牌搓開後自動結算。
  useEffect(() => {
    if (!concealed || !pendingRef.current) return
    const totalCards = playerCards.length + bankerCards.length
    if (totalCards > 0 && revealedCount >= totalCards) {
      applyResult(pendingRef.current)
    }
    // applyResult 依賴大量 state setter，僅在揭牌數變動時檢查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedCount, concealed])

  const handleDeal = async () => {
    if (!selectedBet) {
      setResultMessage('請先選擇下注項目。')
      setRoundProfit(null)
      return
    }

    if (!Number.isFinite(numericBetAmount) || numericBetAmount < MIN_BET || numericBetAmount > MAX_BET) {
      setResultMessage(`下注金額需介於 ${MIN_BET.toLocaleString()} ~ ${MAX_BET.toLocaleString()} 星幣。`)
      setRoundProfit(null)
      return
    }

    if (balance < numericBetAmount) {
      setResultMessage('星幣不足，請先儲值後再下注。')
      setRoundProfit(null)
      return
    }

    setIsDealing(true)
    setResultMessage('發牌中...')
    setWinner('')
    setRoundProfit(null)
    setPlayerCards([])
    setBankerCards([])
    setPlayerScore(null)
    setBankerScore(null)
    soundEngine.play('chip')

    try {
      // 呼叫 game-service（T-034/035）：閒/莊/和擇一押注 → 後端扣款、發牌、派彩。
      const result = await dispatch(
        betBaccarat({ area: selectedBet.toLowerCase(), amount: numericBetAmount })
      ).unwrap()

      const nextWinner = capitalizeWinner(result.winner)
      // 後端 payout 含本金；本局淨損益 = 派彩 − 下注額（輸時 payout=0 → −下注額；和局退本金 → 0）。
      const profit = (result.payout ?? 0) - numericBetAmount
      const payload = { result, nextWinner, profit, betArea: selectedBet, amount: numericBetAmount }

      const parsedPlayerCards = (result.playerCards || []).map(parseCard)
      const parsedBankerCards = (result.bankerCards || []).map(parseCard)
      // 發牌音：逐張交錯
      parsedPlayerCards.concat(parsedBankerCards).forEach((_, index) => {
        soundEngine.play('cardDeal', { delay: index * 0.13 })
      })
      setPlayerCards(parsedPlayerCards)
      setBankerCards(parsedBankerCards)

      if (squeezeMode) {
        // 咪牌：蓋牌上桌，結果懸而未揭
        pendingRef.current = payload
        setRevealedCount(0)
        setConcealed(true)
        setResultMessage('長按牌面慢慢搓開，或點「直接開牌」。')
      } else {
        applyResult(payload)
      }
    } catch (error) {
      setResultMessage(typeof error === 'string' ? error : '本局結算失敗，請稍後再試。')
      setRoundProfit(null)
    } finally {
      setIsDealing(false)
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
        <div className="baccarat-main-grid">
          <div className="baccarat-table">
            <header className="baccarat-hero">
              <p className="baccarat-hero__eyebrow">VIP Table Game</p>
              <h2 className="baccarat-hero__title">Baccarat</h2>
              <p className="baccarat-hero__subtitle">選擇閒家、莊家或和局，下注後開始發牌</p>
              <div className="baccarat-hero__actions">
                <button
                  type="button"
                  onClick={toggleSqueezeMode}
                  className={['baccarat-squeeze-toggle', squeezeMode ? 'baccarat-squeeze-toggle--on' : ''].join(' ')}
                  aria-pressed={squeezeMode}
                >
                  {squeezeMode ? '咪牌模式：開' : '咪牌模式：關'}
                </button>
                {concealed && (
                  <button type="button" onClick={handleRevealAll} className="baccarat-squeeze-toggle">
                    直接開牌
                  </button>
                )}
              </div>
            </header>

            <div className="baccarat-table-felt">
              <div className="baccarat-duel-grid">
                <HandPanel
                  title="Player"
                  score={playerScore}
                  cards={playerCards}
                  isDealing={isDealing}
                  winner={winner}
                  winnerKey="Player"
                  concealed={concealed}
                  onCardRevealed={() => setRevealedCount((n) => n + 1)}
                />

                <div className="baccarat-vs-medallion" aria-hidden="true">
                  <span>VS</span>
                  <small>Tie pays 8:1</small>
                </div>

                <HandPanel
                  title="Banker"
                  score={bankerScore}
                  cards={bankerCards}
                  isDealing={isDealing}
                  winner={winner}
                  winnerKey="Banker"
                  concealed={concealed}
                  onCardRevealed={() => setRevealedCount((n) => n + 1)}
                />
              </div>

              <div className="baccarat-control-grid">
                <section className="baccarat-bet-panel">
                  <div className="baccarat-panel-heading">
                    <p>Bet</p>
                    <h3>下注區</h3>
                  </div>

                  <div className="baccarat-bet-options">
                    {BET_TYPES.map((betType) => (
                      <button
                        key={betType}
                        type="button"
                        onClick={() => {
                          setSelectedBet(betType)
                          soundEngine.play('chip')
                        }}
                        disabled={isDealing}
                        className={[
                          'baccarat-bet-option',
                          BET_COLOR_CLASS[betType] || '',
                          selectedBet === betType ? 'baccarat-bet-option--selected' : '',
                        ].join(' ')}
                      >
                        <span>賠率 {BET_ODDS[betType]}x</span>
                        <strong>{BET_LABELS[betType]}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="baccarat-wager-row">
                    <label className="baccarat-field">
                      <span>下注金額（{MIN_BET.toLocaleString()} ~ {MAX_BET.toLocaleString()}）</span>
                      <input
                        type="number"
                        min={MIN_BET}
                        max={MAX_BET}
                        step="1"
                        value={betAmount}
                        onChange={(event) => setBetAmount(event.target.value)}
                        disabled={isDealing}
                        className="baccarat-bet-input"
                        placeholder="自訂金額"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleDeal}
                      disabled={!canDeal}
                      className="baccarat-action-button"
                    >
                      {isDealing ? '發牌中...' : notEnoughBalance ? '星幣不足' : '開始發牌'}
                    </button>
                    <div className="baccarat-chip-row">
                      {chipDenominations.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => {
                            setBetAmount(String(amount))
                            soundEngine.play('chip')
                          }}
                          disabled={isDealing}
                          className={[
                            'baccarat-chip',
                            Number(betAmount) === amount ? 'baccarat-chip--selected' : '',
                          ].join(' ')}
                        >
                          {formatCoins(amount)}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <section className={['baccarat-result-panel', resultState].join(' ')}>
                  <div className="baccarat-panel-heading">
                    <p>Settlement</p>
                    <h3>本局結算</h3>
                  </div>
                  <p className="baccarat-result-message">{resultMessage || '等待下注與發牌。'}</p>
                  <div className="baccarat-result-grid">
                    <ResultItem label="勝方" value={winnerLabel} />
                    <ResultItem
                      label="下注項目"
                      value={roundBet ? BET_LABELS[roundBet.selectedBet] : selectedBetLabel}
                    />
                    <ResultItem
                      label="下注金額"
                      value={
                        roundBet ? formatCoins(roundBet.amount) : formatCoins(numericBetAmount)
                      }
                    />
                    <ResultItem
                      label="獲利或損失"
                      value={
                        roundProfit === null
                          ? '-'
                          : `${roundProfit >= 0 ? '+' : '-'}${formatCoins(Math.abs(roundProfit))}`
                      }
                    />
                    <ResultItem
                      label="Player 點數"
                      value={playerScore === null ? '-' : playerScore}
                    />
                    <ResultItem
                      label="Banker 點數"
                      value={bankerScore === null ? '-' : bankerScore}
                    />
                    <ResultItem
                      label="本局反水（0.5%）"
                      value={roundBet?.rebate != null ? `+${formatCoins(roundBet.rebate)}` : '-'}
                      wide
                    />
                  </div>
                </section>
              </div>
            </div>
          </div>

          <aside className="baccarat-side-panel">
            <MetricCard
              label="可用星幣"
              value={balance.toLocaleString()}
              caption="依本局結果更新"
              tone="light"
            />
            <BaccaratRoadmap history={history} />
            <GameRuleCard
              title="百家樂規則"
              subtitle="查看點數計算、勝負判定與下注賠率。"
              rules={baccaratRules}
              payouts={baccaratPayouts}
            />
            <MetricCard
              label="本局選項"
              value={selectedBet ? BET_LABELS[selectedBet] : '-'}
              caption={selectedBet ? BET_LABELS[selectedBet] : '尚未下注'}
            />
            <MetricCard
              label="本局獲利"
              value={sidebarProfitValue}
              caption={sidebarProfitCaption}
            />
            <MetricCard
              label="本場損益"
              value={
                sessionProfit === null
                  ? '-'
                  : sessionProfit >= 0
                    ? `+${formatCoins(sessionProfit)}`
                    : `-${formatCoins(Math.abs(sessionProfit))}`
              }
              caption={sessionProfit === null ? '本局結算後開始記錄' : `本場共 ${history.length} 局`}
              valueClass={sessionProfit === null ? '' : sessionProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}
            />

            <div className="baccarat-api-panel">
              <p>Round Note</p>
              <h3>由 game-service 伺服器結算</h3>
              <div>
                <span>發牌與派彩由後端 Provably Fair 引擎運算（T-034/035）。</span>
                <span>星幣餘額為 wallet-service 實際扣款/派彩後的結果。</span>
                <span>每局可用 roundId 透過驗證 API 核對結果是否遭竄改。</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </AppShell>
  )
}
