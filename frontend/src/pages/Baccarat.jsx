import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import GameRuleCard from '../components/GameRuleCard'
import MetricCard from '../components/MetricCard'
import { setBalance } from '../store/slices/walletSlice'
import {
  BET_LABELS,
  BET_ODDS,
  BET_TYPES,
  calculateBaccaratScore,
  calculatePayout,
  createDeck,
  determineWinner,
  drawCard,
} from '../utils/baccaratGame'

const initialCards = []
const suitSymbols = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
}
const redSuits = new Set(['heart', 'diamond'])
const chipDenominations = [100, 200, 500, 1000, 3000, 5000, 7000, 10000]
const baccaratRules = [
  '先選擇閒家 Player、莊家 Banker 或和局 Tie，再輸入下注金額或使用面額快速選擇。',
  'A 計 1 點，2 到 9 依牌面計點，10、J、Q、K 計 0 點；兩張牌總和只取個位數。',
  '目前前端版由閒家與莊家各發兩張牌，點數高者勝出，兩邊同分為和局。',
  '押中會依賠率計算本局獲利，未押中則損失下注金額，結果會即時反映在可用星幣。',
]
const baccaratPayouts = [
  { label: '閒家 Player', value: '1x' },
  { label: '莊家 Banker', value: '0.95x' },
  { label: '和局 Tie', value: '8x' },
]

function formatCoins(value) {
  return Number(value || 0).toLocaleString()
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

function HandPanel({ title, score, cards, isDealing, winner, winnerKey }) {
  const isWinner = winner === winnerKey
  const visibleCards = cards.length ? cards : [null, null]

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
        </div>
        <div className="baccarat-score">
          <span>Score</span>
          <strong>{score === null ? '-' : score}</strong>
        </div>
      </div>
      <div className="baccarat-cards">
        {visibleCards.map((card, index) => (
          <CardView
            key={card ? `${card.suit}-${card.rank}-${index}` : `empty-${index}`}
            card={card}
            index={index}
            isDealing={isDealing}
          />
        ))}
      </div>
    </section>
  )
}

function ResultItem({ label, value }) {
  return (
    <div className="baccarat-result-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default function Baccarat() {
  const dispatch = useDispatch()
  const balance = useSelector((state) => state.wallet.balance)
  const [selectedBet, setSelectedBet] = useState('')
  const [betAmount, setBetAmount] = useState('100')
  const [playerCards, setPlayerCards] = useState(initialCards)
  const [bankerCards, setBankerCards] = useState(initialCards)
  const [playerScore, setPlayerScore] = useState(null)
  const [bankerScore, setBankerScore] = useState(null)
  const [winner, setWinner] = useState('')
  const [resultMessage, setResultMessage] = useState('')
  const [isDealing, setIsDealing] = useState(false)
  const [isAmountMenuOpen, setIsAmountMenuOpen] = useState(false)
  const [roundProfit, setRoundProfit] = useState(null)
  const [roundBet, setRoundBet] = useState(null)

  const numericBetAmount = useMemo(() => Number(betAmount), [betAmount])
  const canDeal =
    selectedBet && Number.isFinite(numericBetAmount) && numericBetAmount > 0 && !isDealing
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

  const handleDeal = () => {
    if (!selectedBet) {
      setResultMessage('請先選擇下注項目。')
      setRoundProfit(null)
      return
    }

    if (!Number.isFinite(numericBetAmount) || numericBetAmount <= 0) {
      setResultMessage('下注金額必須大於 0。')
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

    window.setTimeout(() => {
      const deck = createDeck()
      const nextPlayerCards = [drawCard(deck), drawCard(deck)]
      const nextBankerCards = [drawCard(deck), drawCard(deck)]
      const nextPlayerScore = calculateBaccaratScore(nextPlayerCards)
      const nextBankerScore = calculateBaccaratScore(nextBankerCards)
      const nextWinner = determineWinner(nextPlayerScore, nextBankerScore)
      const profit = calculatePayout(selectedBet, nextWinner, numericBetAmount)
      const hit = profit >= 0

      // TODO: 未來改為呼叫 POST /api/game/baccarat/play，request body: { userId, betType, betAmount }。
      // TODO: 後端 response 預計回傳 playerCards、bankerCards、playerScore、bankerScore、winner、payout、balance，再用 wallet-service 完成實際扣款與派彩。
      setPlayerCards(nextPlayerCards)
      setBankerCards(nextBankerCards)
      setPlayerScore(nextPlayerScore)
      setBankerScore(nextBankerScore)
      setWinner(nextWinner)
      setRoundProfit(profit)
      setRoundBet({ selectedBet, amount: numericBetAmount })
      setResultMessage(
        hit
          ? `命中 ${BET_LABELS[nextWinner]}，本局獲利 ${formatCoins(profit)} 星幣。`
          : `${BET_LABELS[nextWinner]} 勝出，未命中下注，損失 ${formatCoins(numericBetAmount)} 星幣。`
      )
      dispatch(
        setBalance({
          balance: Math.max(balance + profit, 0),
        })
      )
      setIsDealing(false)
    }, 720)
  }

  const handleSelectAmount = (amount) => {
    setBetAmount(String(amount))
    setIsAmountMenuOpen(false)
  }

  return (
    <AppShell>
      <section className="baccarat-page">
        <div className="baccarat-main-grid">
          <div className="baccarat-table">
            <header className="baccarat-hero">
              <p className="baccarat-hero__eyebrow">VIP Table Game</p>
              <h2 className="baccarat-hero__title">Baccarat</h2>
              <p className="baccarat-hero__subtitle">選擇 Player、Banker 或 Tie，下注後開始發牌</p>
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
                />
              </div>

              <div className="baccarat-control-grid">
                <section className="baccarat-bet-panel">
                  <div className="baccarat-panel-heading">
                    <p>Bet Control</p>
                    <h3>下注區</h3>
                  </div>

                  <div className="baccarat-bet-options">
                    {BET_TYPES.map((betType) => (
                      <button
                        key={betType}
                        type="button"
                        onClick={() => setSelectedBet(betType)}
                        disabled={isDealing}
                        className={[
                          'baccarat-bet-option',
                          selectedBet === betType ? 'baccarat-bet-option--selected' : '',
                        ].join(' ')}
                      >
                        <span>Odds {BET_ODDS[betType]}x</span>
                        <strong>{BET_LABELS[betType]}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="baccarat-wager-row">
                    <label className="baccarat-field">
                      <span>下注金額</span>
                      <div className="baccarat-amount-picker">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={betAmount}
                          onChange={(event) => setBetAmount(event.target.value)}
                          disabled={isDealing}
                          className="baccarat-bet-input"
                          placeholder="自訂金額"
                        />
                        <button
                          type="button"
                          onClick={() => setIsAmountMenuOpen((open) => !open)}
                          disabled={isDealing}
                          className="baccarat-amount-toggle"
                          aria-expanded={isAmountMenuOpen}
                        >
                          面額
                        </button>
                        {isAmountMenuOpen && (
                          <div className="baccarat-amount-menu">
                            {chipDenominations.map((amount) => (
                              <button
                                key={amount}
                                type="button"
                                onClick={() => handleSelectAmount(amount)}
                                className={[
                                  'baccarat-amount-option',
                                  Number(betAmount) === amount
                                    ? 'baccarat-amount-option--selected'
                                    : '',
                                ].join(' ')}
                              >
                                {formatCoins(amount)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={handleDeal}
                      disabled={!canDeal}
                      className="baccarat-action-button"
                    >
                      {isDealing ? '發牌中...' : '開始發牌'}
                    </button>
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
                  </div>
                </section>
              </div>
            </div>
          </div>

          <aside className="baccarat-side-panel">
            <GameRuleCard
              title="百家樂規則"
              subtitle="查看點數計算、勝負判定與下注賠率。"
              rules={baccaratRules}
              payouts={baccaratPayouts}
            />
            <MetricCard
              label="可用星幣"
              value={formatCoins(balance)}
              caption="目前以前端模擬結果更新"
              tone="light"
            />
            <MetricCard
              label="本局選項"
              value={selectedBet || '-'}
              caption={selectedBet ? BET_LABELS[selectedBet] : '尚未下注'}
            />
            <MetricCard
              label="本局獲利"
              value={sidebarProfitValue}
              caption={sidebarProfitCaption}
            />

            <div className="baccarat-api-panel">
              <p>API Placeholder</p>
              <h3>後端串接預留</h3>
              <div>
                <span>POST /api/game/baccarat/play</span>
                <span>Request: userId、betType、betAmount</span>
                <span>Response: cards、score、winner、payout、balance</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </AppShell>
  )
}
