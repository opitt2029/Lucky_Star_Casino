import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { useLocation } from 'react-router-dom'
import './FriendFloatingPanel.css'

const CURRENT_PLAYER_GAME_ID = 'LSC000000'

const mockFriends = [
  {
    id: 1,
    gameId: 'LSC100238',
    name: '星夜玩家',
    status: 'online',
    level: 18,
    avatar: '🌙',
    registeredAt: '2025-11-18',
    currentGame: null,
  },
  {
    id: 2,
    gameId: 'LSC100512',
    name: '紅金騎士',
    status: 'playing',
    level: 24,
    avatar: '🃏',
    registeredAt: '2025-09-03',
    currentGame: '百家樂',
  },
  {
    id: 3,
    gameId: 'LSC100876',
    name: '幸運小虎',
    status: 'online',
    level: 12,
    avatar: '🐯',
    registeredAt: '2026-01-12',
    currentGame: null,
  },
  {
    id: 4,
    gameId: 'LSC101004',
    name: '鑽石女王',
    status: 'playing',
    level: 31,
    avatar: '💎',
    registeredAt: '2025-07-25',
    currentGame: '老虎機',
  },
  {
    id: 5,
    gameId: 'LSC101322',
    name: '夜貓玩家',
    status: 'offline',
    level: 9,
    avatar: '🐈‍⬛',
    registeredAt: '2026-02-08',
    currentGame: null,
  },
  {
    id: 6,
    gameId: 'LSC101688',
    name: '星幣獵人',
    status: 'online',
    level: 27,
    avatar: '🪙',
    registeredAt: '2025-10-30',
    currentGame: null,
  },
  {
    id: 7,
    gameId: 'LSC102019',
    name: '王牌莊家',
    status: 'playing',
    level: 35,
    avatar: '🎲',
    registeredAt: '2025-06-15',
    currentGame: '骰寶',
  },
  {
    id: 8,
    gameId: 'LSC102441',
    name: '星河旅人',
    status: 'offline',
    level: 16,
    avatar: '🚀',
    registeredAt: '2025-12-02',
    currentGame: null,
  },
]

const filters = [
  { value: 'all', label: '全部' },
  { value: 'online', label: '線上' },
  { value: 'offline', label: '離線' },
  { value: 'playing', label: '遊戲中' },
]

function getStatusText(status) {
  switch (status) {
    case 'online':
      return '線上'
    case 'offline':
      return '離線'
    case 'playing':
      return '遊戲中'
    default:
      return '未知'
  }
}

export default function FriendFloatingPanel() {
  const location = useLocation()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const [isOpen, setIsOpen] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [isFriendDetailOpen, setIsFriendDetailOpen] = useState(false)
  const [isGiftFormOpen, setIsGiftFormOpen] = useState(false)
  const [giftAmount, setGiftAmount] = useState('')
  const [giftMessage, setGiftMessage] = useState('')
  const [giftError, setGiftError] = useState('')
  const [giftNotice, setGiftNotice] = useState('')
  const [starCoinBalance, setStarCoinBalance] = useState(5000)

  const resetGiftForm = () => {
    setIsGiftFormOpen(false)
    setGiftAmount('')
    setGiftMessage('')
    setGiftError('')
  }

  const resetFriendDetail = () => {
    setSelectedFriend(null)
    setIsFriendDetailOpen(false)
    setGiftNotice('')
    resetGiftForm()
  }

  const handleClosePanel = () => {
    setIsOpen(false)
    resetFriendDetail()
  }

  useEffect(() => {
    handleClosePanel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const filteredFriends = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    return mockFriends
      .filter((friend) => activeFilter === 'all' || friend.status === activeFilter)
      .filter((friend) => !keyword || friend.name.toLowerCase().includes(keyword))
  }, [activeFilter, searchKeyword])

  const onlineCount = mockFriends.filter((friend) => friend.status === 'online').length
  const playingCount = mockFriends.filter((friend) => friend.status === 'playing').length

  const handleToggle = () => {
    setIsOpen((open) => {
      if (open) {
        resetFriendDetail()
      }
      return !open
    })
  }

  const handleFriendClick = (friend) => {
    setSelectedFriend(friend)
    setIsFriendDetailOpen(true)
    setGiftNotice('')
    resetGiftForm()
  }

  const handleBackToList = () => {
    resetFriendDetail()
  }

  const handleOpenGiftForm = () => {
    setGiftNotice('')
    setGiftError('')
    setIsGiftFormOpen(true)
  }

  const handleCancelGift = () => {
    resetGiftForm()
  }

  const handleGiftSubmit = (event) => {
    event.preventDefault()
    if (!selectedFriend) return

    const amount = Number(giftAmount)
    if (!Number.isInteger(amount) || amount < 1) {
      setGiftNotice('')
      setGiftError('請輸入有效的星幣數量')
      return
    }

    if (selectedFriend.gameId === CURRENT_PLAYER_GAME_ID) {
      setGiftNotice('')
      setGiftError('無法贈送星幣給自己')
      return
    }

    if (amount > starCoinBalance) {
      setGiftNotice('')
      setGiftError('星幣餘額不足')
      return
    }

    const confirmed = window.confirm(`確定要贈送 ${amount} 星幣給 ${selectedFriend.name} 嗎？`)
    if (!confirmed) return

    setStarCoinBalance((balance) => balance - amount)
    setGiftNotice(`已成功贈送 ${amount.toLocaleString()} 星幣給 ${selectedFriend.name}`)
    setGiftAmount('')
    setGiftMessage('')
    setGiftError('')
    setIsGiftFormOpen(false)
  }

  return (
    <section className="friend-float" aria-label="好友列表浮動面板">
      <div
        id="friend-floating-panel"
        className={[
          'friend-float__panel',
          isOpen ? 'friend-float__panel--open' : '',
          !isAuthenticated ? 'friend-float__panel--guest' : '',
        ].join(' ')}
      >
        <div className="friend-float__panel-header">
          <div>
            <p>Friends</p>
            <h2>{isFriendDetailOpen ? '好友資訊' : '好友列表'}</h2>
          </div>
          <button type="button" onClick={handleClosePanel} aria-label="關閉好友列表">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {isAuthenticated ? (
          isFriendDetailOpen && selectedFriend ? (
            <div className="friend-float__detail">
              <div className="friend-float__detail-profile">
                <span className="friend-float__detail-avatar">{selectedFriend.avatar}</span>
                <h3>{selectedFriend.name}</h3>
                <p>ID：{selectedFriend.gameId}</p>
              </div>

              <dl className="friend-float__detail-grid">
                <div>
                  <dt>狀態</dt>
                  <dd>
                    <span
                      className={`friend-float__status-dot friend-float__status-dot--${selectedFriend.status}`}
                      aria-hidden="true"
                    />
                    {getStatusText(selectedFriend.status)}
                  </dd>
                </div>
                <div>
                  <dt>等級</dt>
                  <dd>Lv.{selectedFriend.level}</dd>
                </div>
                <div>
                  <dt>註冊日期</dt>
                  <dd>{selectedFriend.registeredAt}</dd>
                </div>
                {selectedFriend.status === 'playing' && (
                  <div>
                    <dt>目前遊戲</dt>
                    <dd>{selectedFriend.currentGame}</dd>
                  </div>
                )}
                <div>
                  <dt>可用星幣</dt>
                  <dd>{starCoinBalance.toLocaleString()}</dd>
                </div>
              </dl>

              {giftNotice && (
                <p className="friend-float__form-message friend-float__form-message--success" role="status">
                  {giftNotice}
                </p>
              )}

              {isGiftFormOpen ? (
                <form className="friend-float__gift-form" onSubmit={handleGiftSubmit}>
                  <p>贈送星幣給：{selectedFriend.name}</p>
                  <label>
                    數量
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={giftAmount}
                      onChange={(event) => setGiftAmount(event.target.value)}
                      placeholder="輸入星幣數量"
                    />
                  </label>
                  <label>
                    留言
                    <textarea
                      value={giftMessage}
                      onChange={(event) => setGiftMessage(event.target.value)}
                      placeholder="祝你今天手氣旺！"
                      rows="2"
                    />
                  </label>
                  {giftError && (
                    <p className="friend-float__form-message friend-float__form-message--error" role="alert">
                      {giftError}
                    </p>
                  )}
                  <div className="friend-float__detail-actions">
                    <button type="button" className="friend-float__secondary-action" onClick={handleCancelGift}>
                      取消
                    </button>
                    <button type="submit" className="friend-float__primary-action">
                      確認贈送
                    </button>
                  </div>
                </form>
              ) : (
                <div className="friend-float__detail-actions">
                  <button type="button" className="friend-float__secondary-action" onClick={handleBackToList}>
                    返回列表
                  </button>
                  <button type="button" className="friend-float__primary-action" onClick={handleOpenGiftForm}>
                    贈送星幣
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <label className="friend-float__search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />
                </svg>
                <input
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  placeholder="搜尋好友..."
                />
              </label>

              <div className="friend-float__filters" role="tablist" aria-label="好友狀態分類">
                {filters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    role="tab"
                    aria-selected={activeFilter === filter.value}
                    className={activeFilter === filter.value ? 'friend-float__filter--active' : ''}
                    onClick={() => setActiveFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="friend-float__list">
                {filteredFriends.length > 0 ? (
                  filteredFriends.map((friend) => (
                    <button
                      key={friend.id}
                      type="button"
                      className="friend-float__friend"
                      onClick={() => handleFriendClick(friend)}
                    >
                      <span className="friend-float__avatar">{friend.avatar}</span>
                      <span className="friend-float__friend-main">
                        <span className="friend-float__friend-name-row">
                          <span className="friend-float__friend-name">{friend.name}</span>
                          <span className="friend-float__friend-level">Lv.{friend.level}</span>
                        </span>
                        <span className="friend-float__friend-status">
                          <span
                            className={`friend-float__status-dot friend-float__status-dot--${friend.status}`}
                            aria-hidden="true"
                          />
                          {friend.status === 'playing'
                            ? `遊戲中：${friend.currentGame}`
                            : getStatusText(friend.status)}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="friend-float__empty">找不到符合的好友</p>
                )}
              </div>

              <div className="friend-float__summary">線上 {onlineCount} 人・遊戲中 {playingCount} 人</div>
            </>
          )
        ) : (
          <div className="friend-float__guest-state">
            <span className="friend-float__guest-dot" aria-hidden="true" />
            <h3>未登入</h3>
            <p>登入後即可查看好友在線狀態與遊戲動態。</p>
            <a href="/member?mode=login">前往登入</a>
          </div>
        )}
      </div>

      <button
        type="button"
        className={[
          'friend-float__trigger',
          isOpen ? 'friend-float__trigger--open' : '',
          !isAuthenticated ? 'friend-float__trigger--guest' : '',
        ].join(' ')}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls="friend-floating-panel"
      >
        <span
          className={`friend-float__online-dot ${!isAuthenticated ? 'friend-float__online-dot--guest' : ''}`}
          aria-hidden="true"
        />
        <span className="friend-float__trigger-copy">
          <strong>好友列表</strong>
          <small>{isAuthenticated ? `${onlineCount} 位線上` : '未登入'}</small>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={isOpen ? 'M18 15 12 9l-6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
    </section>
  )
}
