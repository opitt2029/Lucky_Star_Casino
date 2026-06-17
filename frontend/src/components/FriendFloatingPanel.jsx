import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { useLocation } from 'react-router-dom'
import { memberApi, extractError } from '../services/memberApi'
import './FriendFloatingPanel.css'

function formatDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()
}

function avatarChar(friend) {
  const base = friend.name || friend.username || '?'
  return base.trim().slice(0, 1).toUpperCase()
}

export default function FriendFloatingPanel() {
  const location = useLocation()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const [isOpen, setIsOpen] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [isFriendDetailOpen, setIsFriendDetailOpen] = useState(false)
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [removingId, setRemovingId] = useState(null)

  const resetFriendDetail = () => {
    setSelectedFriend(null)
    setIsFriendDetailOpen(false)
  }

  const handleClosePanel = () => {
    setIsOpen(false)
    resetFriendDetail()
  }

  const loadFriends = useCallback(async () => {
    if (!isAuthenticated) {
      setFriends([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const list = await memberApi.listFriends()
      setFriends(Array.isArray(list) ? list : [])
    } catch (apiError) {
      setError(extractError(apiError) || '好友清單讀取失敗')
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  // 切換路由時收合面板（沿用既有行為）
  useEffect(() => {
    handleClosePanel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // 登入狀態變動時刷新好友（登出即清空，避免殘留）
  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  const filteredFriends = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    if (!keyword) return friends
    return friends.filter(
      (friend) =>
        friend.name.toLowerCase().includes(keyword) ||
        (friend.username || '').toLowerCase().includes(keyword),
    )
  }, [friends, searchKeyword])

  const handleToggle = () => {
    setIsOpen((open) => {
      if (open) {
        resetFriendDetail()
      } else {
        loadFriends()
      }
      return !open
    })
  }

  const handleFriendClick = (friend) => {
    setSelectedFriend(friend)
    setIsFriendDetailOpen(true)
  }

  const handleBackToList = () => {
    resetFriendDetail()
  }

  const handleRemoveFriend = async (friend) => {
    if (!friend?.friendshipId) return
    const confirmed = window.confirm(`確定要解除與「${friend.name}」的好友關係嗎？`)
    if (!confirmed) return
    setRemovingId(friend.friendshipId)
    setError('')
    try {
      await memberApi.deleteFriend(friend.friendshipId)
      setFriends((prev) => prev.filter((f) => f.friendshipId !== friend.friendshipId))
      resetFriendDetail()
    } catch (apiError) {
      setError(extractError(apiError) || '解除好友失敗')
    } finally {
      setRemovingId(null)
    }
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
                <span className="friend-float__detail-avatar">{avatarChar(selectedFriend)}</span>
                <h3>{selectedFriend.name}</h3>
                {selectedFriend.username && <p>帳號：{selectedFriend.username}</p>}
              </div>

              <dl className="friend-float__detail-grid">
                <div>
                  <dt>玩家 ID</dt>
                  <dd>{selectedFriend.friendId}</dd>
                </div>
                <div>
                  <dt>成為好友</dt>
                  <dd>{formatDate(selectedFriend.friendSince)}</dd>
                </div>
              </dl>

              {error && (
                <p className="friend-float__form-message friend-float__form-message--error" role="alert">
                  {error}
                </p>
              )}

              <div className="friend-float__detail-actions">
                <button type="button" className="friend-float__secondary-action" onClick={handleBackToList}>
                  返回列表
                </button>
                <button
                  type="button"
                  className="friend-float__primary-action"
                  onClick={() => handleRemoveFriend(selectedFriend)}
                  disabled={removingId === selectedFriend.friendshipId}
                >
                  {removingId === selectedFriend.friendshipId ? '處理中…' : '解除好友'}
                </button>
              </div>
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

              {error && (
                <p className="friend-float__form-message friend-float__form-message--error" role="alert">
                  {error}
                </p>
              )}

              <div className="friend-float__list">
                {loading ? (
                  <p className="friend-float__empty">好友清單載入中…</p>
                ) : filteredFriends.length > 0 ? (
                  filteredFriends.map((friend) => (
                    <button
                      key={friend.friendshipId}
                      type="button"
                      className="friend-float__friend"
                      onClick={() => handleFriendClick(friend)}
                    >
                      <span className="friend-float__avatar">{avatarChar(friend)}</span>
                      <span className="friend-float__friend-main">
                        <span className="friend-float__friend-name-row">
                          <span className="friend-float__friend-name">{friend.name}</span>
                        </span>
                        <span className="friend-float__friend-status">
                          {friend.username ? `@${friend.username}` : `ID ${friend.friendId}`}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="friend-float__empty">
                    {searchKeyword ? '找不到符合的好友' : '目前沒有好友'}
                  </p>
                )}
              </div>

              <div className="friend-float__summary">共 {friends.length} 位好友</div>
            </>
          )
        ) : (
          <div className="friend-float__guest-state">
            <span className="friend-float__guest-dot" aria-hidden="true" />
            <h3>未登入</h3>
            <p>登入後即可查看你的好友清單。</p>
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
          <small>{isAuthenticated ? `${friends.length} 位好友` : '未登入'}</small>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={isOpen ? 'M18 15 12 9l-6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
    </section>
  )
}
