import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import './QuickToolbar.css'

const tools = [
  {
    label: '每日簽到',
    path: '/check-in',
    protected: true,
    icon: (
      <path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 9 2 2 4-5" />
    ),
  },
  {
    label: '遊戲大廳',
    path: '/games',
    protected: true,
    icon: <path d="M6 12h12M12 6v12M7 17l-2 2M17 17l2 2M7 7 5 5M17 7l2-2" />,
  },
  {
    label: '鑽石錢包',
    path: '/diamond',
    protected: true,
    icon: <path d="M12 3 4 9l8 12 8-12-8-6Zm0 0 3 6-3 12-3-12 3-6ZM4 9h16" />,
  },
  {
    label: '會員中心',
    path: '/profile',
    protected: true,
    icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0" />,
  },
  {
    label: '禮品商城',
    path: '/shop',
    protected: false,
    icon: <path d="M6 8h12l-1 11H7L6 8Zm2 0a4 4 0 0 1 8 0M9 13h.01M15 13h.01" />,
  },
]

function ToolbarIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="quick-toolbar__icon">
      {children}
    </svg>
  )
}

export default function QuickToolbar() {
  const navigate = useNavigate()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 2200)
    return () => window.clearTimeout(timer)
  }, [message])

  const goToLogin = (path, withNotice = true) => {
    if (withNotice) {
      setMessage('請先登入')
    }
    navigate('/member?mode=login', { state: { from: { pathname: path } } })
  }

  const handleProtectedNavigate = (path, options = {}) => {
    if (!isAuthenticated) {
      goToLogin(path, options.notice !== false)
      return
    }
    navigate(path)
  }

  const handleToolClick = (tool) => {
    if (tool.protected) {
      handleProtectedNavigate(tool.path, { notice: tool.path !== '/profile' })
      return
    }
    navigate(tool.path)
  }

  const handleAiService = () => {
    setMessage('AI 客服功能即將推出')
  }

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    document.querySelector('.scroll-shell')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <aside className="quick-toolbar" aria-label="快速工具欄">
        <div className="quick-toolbar__panel">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="quick-toolbar__button"
              onClick={() => handleToolClick(tool)}
            >
              <ToolbarIcon>{tool.icon}</ToolbarIcon>
              <span>{tool.label}</span>
            </button>
          ))}

          <button type="button" className="quick-toolbar__button" onClick={handleAiService}>
            <ToolbarIcon>
              <path d="M5 11a7 7 0 0 1 14 0v5a3 3 0 0 1-3 3h-2M5 11v4a2 2 0 0 0 2 2h1v-6H5Zm14 0h-3v6h1a2 2 0 0 0 2-2v-4Z" />
            </ToolbarIcon>
            <span>AI 客服</span>
          </button>

          <button
            type="button"
            className="quick-toolbar__button quick-toolbar__button--top"
            onClick={handleBackToTop}
          >
            <ToolbarIcon>
              <path d="M12 19V5M6 11l6-6 6 6" />
            </ToolbarIcon>
            <span>Top</span>
          </button>
        </div>
      </aside>

      {message && (
        <div className="quick-toolbar__notice-layer" role="status" aria-live="polite">
          <div className="quick-toolbar__notice-box">
            <p>{message}</p>
          </div>
        </div>
      )}
    </>
  )
}
