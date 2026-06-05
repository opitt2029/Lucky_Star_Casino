import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-zinc-950 px-4 text-white">
          <div className="max-w-2xl rounded border border-white/10 bg-zinc-900 p-6">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Page Error</p>
            <h1 className="mt-3 text-2xl font-black">畫面暫時無法顯示</h1>
            <p className="mt-4 rounded bg-black p-4 text-sm font-bold leading-6 text-zinc-300">
              請重新整理頁面，或稍後再試。
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
