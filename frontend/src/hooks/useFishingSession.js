import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { gameApi } from '../services/gameApi'
import { setBalance } from '../store/slices/walletSlice'

// 炮台等級固定注額（索引 0 不用，對齊後端 CANNON_BET = {1:10, 2:50, 3:100}）。
export const CANNON_BET = [0, 10, 50, 100]

// 射速節流：8 發/秒 + 15 發 burst（對齊後端 MAX_SHOTS_PER_SEC / BURST_ALLOWANCE，
// 本地用 token bucket 限制，避免送出後被後端整批拒絕）。
const SHOTS_PER_SEC = 8
const BURST_CAPACITY = 15
// flush 節奏：滿 10 發或每 700ms（單批上限 30，對齊後端 DTO 驗證）。
const FLUSH_SIZE = 10
const FLUSH_INTERVAL_MS = 700
const MAX_BATCH = 30
// 逐發紀錄上限：結算頁只需展示近期數十發供驗證，避免長場次記憶體無上限成長。
const SHOT_LOG_CAP = 50

/**
 * 捕魚機場次生命週期 hook。
 *
 * 把「buy-in 開場 → 批次射擊（局內餘額即時演出）→ 結算回填錢包」的狀態機與
 * 射速節流、shot 緩衝/flush 封裝起來，讓頁面只負責畫面與音效。
 *
 * @param {(results, ctx) => void} onResults 每批 fishingShots 回應觸發；results 為逐發判定，
 *        ctx = { sessionBalance, fishBySeq }，供頁面播放命中/逃跑音效與派彩特效。
 */
export function useFishingSession({ onResults, fortuneReady = false } = {}) {
  const dispatch = useDispatch()

  const fortuneReadyRef = useRef(fortuneReady)
  fortuneReadyRef.current = fortuneReady  // 每次 render 同步最新值，避免閉包過期

  const [phase, setPhase] = useState('loading') // 'loading' | 'idle' | 'playing' | 'settling' | 'settled'
  const [session, setSession] = useState(null) // { sessionId, cannonLevel, fishTable, serverSeedHash, clientSeed }
  const [sessionBalance, setSessionBalance] = useState(0)
  const [stats, setStats] = useState({ totalShots: 0, totalPayout: 0 })
  const [settleResult, setSettleResult] = useState(null)
  const [error, setError] = useState(null)

  // 即時狀態用 ref，避免閉包過期。
  const balanceRef = useRef(0)
  const shotSeqRef = useRef(0)
  const bufferRef = useRef([]) // 待送出的 shot：{ shotSeq, betPerShot, fishType }
  const fishBySeqRef = useRef(new Map()) // shotSeq → fishCode（回應時對映魚種）
  const shotLogRef = useRef([]) // 已受理逐發紀錄（供結算後公平性驗證），保留最後 SHOT_LOG_CAP 發
  const bucketRef = useRef({ tokens: BURST_CAPACITY, last: 0 })
  const flushTimerRef = useRef(null)
  const inFlightRef = useRef(false)
  const sessionIdRef = useRef(null)
  const cannonLevelRef = useRef(1)
  const onResultsRef = useRef(onResults)
  onResultsRef.current = onResults

  const setBalanceBoth = useCallback((next) => {
    balanceRef.current = next
    setSessionBalance(next)
  }, [])

  // 進場查進行中場次（斷線重連恢復）。
  useEffect(() => {
    let alive = true
    gameApi
      .fishingActive()
      .then((active) => {
        if (!alive) return
        if (active) {
          applySessionView(active, true)
        } else {
          setPhase('idle')
        }
      })
      .catch(() => alive && setPhase('idle'))
    return () => {
      alive = false
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applySessionView(view, resumed) {
    sessionIdRef.current = view.sessionId
    cannonLevelRef.current = view.cannonLevel || 1
    shotSeqRef.current = view.lastShotSeq || 0
    shotLogRef.current = []
    setBalanceBoth(view.sessionBalance ?? 0)
    setStats({ totalShots: view.totalShots || 0, totalPayout: 0 })
    setSession({
      sessionId: view.sessionId,
      cannonLevel: view.cannonLevel || 1,
      fishTable: view.fishTable || [],
      serverSeedHash: view.serverSeedHash,
      clientSeed: view.clientSeed,
      resumed,
    })
    setSettleResult(null)
    setError(null)
    setPhase('playing')
    startFlushLoop()
  }

  const startSession = useCallback(
    async ({ buyIn, cannonLevel }) => {
      setError(null)
      setPhase('loading')
      try {
        const clientSeed = `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const view = await gameApi.fishingStart({ buyIn, cannonLevel, clientSeed })
        if (view.wallet) dispatch(setBalance(view.wallet))
        applySessionView(view, view.resumed)
      } catch (err) {
        setError(err?.response?.data?.message || err.message || '開場失敗')
        setPhase('idle')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch],
  )

  function takeToken() {
    const now = Date.now()
    const bucket = bucketRef.current
    if (!bucket.last) bucket.last = now
    bucket.tokens = Math.min(BURST_CAPACITY, bucket.tokens + ((now - bucket.last) / 1000) * SHOTS_PER_SEC)
    bucket.last = now
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }
    return false
  }

  /**
   * 開火一發。回傳 { ok, reason }：ok 時已排入批次並樂觀扣局內餘額。
   * reason: 'ratelimited'（射速過快）| 'insufficient'（局內餘額不足）| 'inactive'。
   */
  const fire = useCallback((fishCode) => {
    if (phase !== 'playing') return { ok: false, reason: 'inactive' }
    const betPerShot = CANNON_BET[cannonLevelRef.current] || CANNON_BET[1]
    if (balanceRef.current < betPerShot) return { ok: false, reason: 'insufficient' }
    if (!takeToken()) return { ok: false, reason: 'ratelimited' }

    const shotSeq = shotSeqRef.current + 1
    shotSeqRef.current = shotSeq
    fishBySeqRef.current.set(shotSeq, fishCode)
    bufferRef.current.push({ shotSeq, betPerShot, fishType: fishCode })
    setBalanceBoth(balanceRef.current - betPerShot) // 樂觀扣注，命中後於回應補回派彩

    if (bufferRef.current.length >= FLUSH_SIZE) flush()
    return { ok: true, shotSeq, betPerShot }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startFlushLoop() {
    if (flushTimerRef.current) window.clearInterval(flushTimerRef.current)
    flushTimerRef.current = window.setInterval(() => {
      if (bufferRef.current.length > 0) flush()
    }, FLUSH_INTERVAL_MS)
  }

  async function flush() {
    if (inFlightRef.current || bufferRef.current.length === 0) return
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    inFlightRef.current = true
    const batch = bufferRef.current.splice(0, MAX_BATCH)
    try {
      const res = await gameApi.fishingShots({ sessionId, shots: batch, fortuneReady: fortuneReadyRef.current })
      let delta = 0
      let payoutSum = 0
      let acceptedShots = 0
      for (const r of res.results) {
        const shot = batch.find((s) => s.shotSeq === r.shotSeq)
        if (!r.accepted) {
          delta += shot?.betPerShot || 0 // 退回樂觀扣注
        } else {
          acceptedShots += 1
          if (r.payout > 0) {
            delta += r.payout
            payoutSum += r.payout
          }
          // 記錄已受理逐發，供結算後逐發公平性驗證（verify-shot）。
          shotLogRef.current.push({
            shotSeq: r.shotSeq,
            fishType: shot?.fishType,
            betPerShot: shot?.betPerShot,
            hit: r.hit,
            payout: r.payout,
          })
          if (shotLogRef.current.length > SHOT_LOG_CAP) {
            shotLogRef.current.splice(0, shotLogRef.current.length - SHOT_LOG_CAP)
          }
        }
      }
      if (delta !== 0) setBalanceBoth(balanceRef.current + delta)
      if (acceptedShots > 0 || payoutSum > 0) {
        setStats((prev) => ({ totalShots: prev.totalShots + acceptedShots, totalPayout: prev.totalPayout + payoutSum }))
      }
      const fishBySeq = fishBySeqRef.current
      onResultsRef.current?.(res.results, { sessionBalance: res.sessionBalance, fishBySeq })
      res.results.forEach((r) => fishBySeq.delete(r.shotSeq))
    } catch (err) {
      // 送出失敗：退回整批樂觀扣注，避免局內餘額被卡住。
      const refund = batch.reduce((sum, s) => sum + s.betPerShot, 0)
      if (refund) setBalanceBoth(balanceRef.current + refund)
      setError(err?.response?.data?.message || err.message || '射擊同步失敗')
    } finally {
      inFlightRef.current = false
    }
  }

  const endSession = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId || phase !== 'playing') return
    setPhase('settling')
    if (flushTimerRef.current) window.clearInterval(flushTimerRef.current)
    // 先把殘餘子彈送完再結算（避免 in-flight 期間忙等）。
    // 設硬性截止時間，避免某批 flush 卡在 in-flight 時整個結算永遠卡死（寧可帶殘餘餘額逕行結算，
    // 後端以局內餘額為準退款，仍冪等安全）。
    const drainDeadline = Date.now() + 5000
    while ((bufferRef.current.length > 0 || inFlightRef.current) && Date.now() < drainDeadline) {
      if (inFlightRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 60))
      } else {
        await flush()
      }
    }
    try {
      const result = await gameApi.fishingEnd({ sessionId })
      if (result.wallet) dispatch(setBalance(result.wallet))
      sessionIdRef.current = null
      // 附上近期逐發紀錄供結算頁公平性驗證（最後幾發優先）。
      setSettleResult({ ...result, shots: [...shotLogRef.current].reverse() })
      setPhase('settled')
    } catch (err) {
      // 結算失敗（多為錢包暫時不可用）：場次仍在後端、未刪除，可直接再按「收網結算」重試（冪等安全）。
      const reason = err?.response?.data?.message || err.message || '結算失敗'
      setError(`${reason}；場次未結束，請再按一次「收網結算」重試`)
      setPhase('playing')
      startFlushLoop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dispatch])

  const resetToIdle = useCallback(() => {
    setSettleResult(null)
    setSession(null)
    setStats({ totalShots: 0, totalPayout: 0 })
    setBalanceBoth(0)
    shotLogRef.current = []
    setPhase('idle')
  }, [setBalanceBoth])

  return {
    phase,
    session,
    sessionBalance,
    stats,
    settleResult,
    error,
    cannonLevel: session?.cannonLevel ?? cannonLevelRef.current,
    betPerShot: CANNON_BET[session?.cannonLevel ?? cannonLevelRef.current] || CANNON_BET[1],
    fishTable: session?.fishTable ?? [],
    startSession,
    fire,
    endSession,
    resetToIdle,
  }
}
