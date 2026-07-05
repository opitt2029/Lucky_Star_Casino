import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { fishingApi } from '../services/fishingApi'
import { setBalance } from '../store/slices/walletSlice'

// 子彈面額（單發注額）：玩家進場自選、整場固定，與砲台解耦（ADR-004）。對齊後端 MIN_BET/MAX_BET。
// 上限為安全天花板；下限避免取整派彩失真。檔位為快選建議值，玩家亦可自訂輸入。
export const BET_MIN = 10
export const BET_MAX = 10000
export const BET_TIERS = [10, 50, 100, 500, 1000]
// 入場金額：對齊後端 MIN_BUYIN/MAX_BUYIN（上限為安全天花板，實質僅再受錢包餘額約束）。
export const BUYIN_MIN = 100
export const BUYIN_MAX = 1000000
export const BUYIN_TIERS = [1000, 3000, 5000, 10000]
// 各砲台單發基礎傷害（顯示用；對齊後端 FishingCombat.CANNON_DAMAGE = {1:14, 2:22, 3:32}）。
export const CANNON_DAMAGE = [0, 14, 22, 32]

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
export function useFishingSession({ onResults } = {}) {
  const dispatch = useDispatch()

  const [phase, setPhase] = useState('loading') // 'loading' | 'idle' | 'playing' | 'settling' | 'settled'
  const [session, setSession] = useState(null) // { sessionId, cannonLevel, fishTable, serverSeedHash, clientSeed }
  const [sessionBalance, setSessionBalance] = useState(0)
  const [stats, setStats] = useState({ totalShots: 0, totalPayout: 0, caughtCount: 0 })
  const [settleResult, setSettleResult] = useState(null)
  const [error, setError] = useState(null)
  const [topUpLoading, setTopUpLoading] = useState(false)

  // 即時狀態用 ref，避免閉包過期。
  const balanceRef = useRef(0)
  const shotSeqRef = useRef(0)
  const bufferRef = useRef([]) // 待送出的 shot：{ shotSeq, betPerShot, cannonLevel, fishType }
  const fishBySeqRef = useRef(new Map()) // shotSeq → fishCode（回應時對映魚種）
  const shotLogRef = useRef([]) // 已受理逐發紀錄（供結算後公平性驗證），保留最後 SHOT_LOG_CAP 發
  const caughtCountRef = useRef(0) // Full-round catch count; shotLog keeps only recent shots.
  const bucketRef = useRef({ tokens: BURST_CAPACITY, last: 0 })
  const flushTimerRef = useRef(null)
  const inFlightRef = useRef(false)
  // 加值進行中鎖：擋住 fire()，避免 shots 批次與 top-up 併發「讀→改→整包 save」互相覆寫後端 session。
  const topUpLockRef = useRef(false)
  const sessionIdRef = useRef(null)
  const cannonLevelRef = useRef(1)
  const betPerShotRef = useRef(BET_TIERS[0]) // 玩家進場選定的單發面額（與砲台解耦）
  const onResultsRef = useRef(onResults)
  onResultsRef.current = onResults

  const setBalanceBoth = useCallback((next) => {
    balanceRef.current = next
    setSessionBalance(next)
  }, [])

  // 進場查進行中場次（斷線重連恢復）。
  useEffect(() => {
    setPhase('idle')
    return () => {
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current)
    }
  }, [])

  function applySessionView(view, resumed) {
    sessionIdRef.current = view.sessionId
    cannonLevelRef.current = view.cannonLevel || 1
    betPerShotRef.current = view.betPerShot || BET_TIERS[0]
    shotSeqRef.current = view.lastShotSeq || 0
    shotLogRef.current = []
    caughtCountRef.current = 0
    setBalanceBoth(view.sessionBalance ?? 0)
    setStats({ totalShots: view.totalShots || 0, totalPayout: 0, caughtCount: 0 })
    setSession({
      sessionId: view.sessionId,
      cannonLevel: view.cannonLevel || 1,
      betPerShot: view.betPerShot || BET_TIERS[0],
      buyIn: view.buyIn,
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
    async ({ buyIn, cannonLevel, betPerShot }) => {
      setError(null)
      setPhase('loading')
      try {
        const clientSeed = `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const view = await fishingApi.start({ buyIn, cannonLevel, betPerShot, clientSeed })
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
   *
   * @param {string} fishInstanceId 目標魚 instance 的穩定 id（血量/傷害模型用以跨批次累積同一條魚的傷害）
   * @param {string} fishCode       目標魚種代碼
   */
  const fire = useCallback((fishInstanceId, fishCode) => {
    if (phase !== 'playing') return { ok: false, reason: 'inactive' }
    if (topUpLockRef.current) return { ok: false, reason: 'topup' } // 加值請求 in-flight 期間暫停射擊
    const betPerShot = betPerShotRef.current || BET_TIERS[0]
    const cannonLevel = cannonLevelRef.current || 1
    if (balanceRef.current < betPerShot) return { ok: false, reason: 'insufficient' }
    if (!takeToken()) return { ok: false, reason: 'ratelimited' }

    const shotSeq = shotSeqRef.current + 1
    shotSeqRef.current = shotSeq
    fishBySeqRef.current.set(shotSeq, fishCode)
    // 後端 Shot DTO 只認 shotSeq/betPerShot/fishType/fishInstanceId；砲台等級為 session 級（進場固定），不隨發送出。
    bufferRef.current.push({ shotSeq, betPerShot, cannonLevel, fishType: fishCode, fishInstanceId: String(fishInstanceId) })
    setBalanceBoth(balanceRef.current - betPerShot) // 樂觀扣注，命中後於回應補回派彩

    if (bufferRef.current.length >= FLUSH_SIZE) flush()
    return { ok: true, shotSeq, betPerShot, cannonLevel }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startFlushLoop() {
    if (flushTimerRef.current) window.clearInterval(flushTimerRef.current)
    flushTimerRef.current = window.setInterval(() => {
      if (bufferRef.current.length > 0) flush()
    }, FLUSH_INTERVAL_MS)
  }

  /** 等待緩衝與 in-flight 批次全部送畢；逾時未清空回 false（呼叫端應中止，不可帶著未結批次繼續）。 */
  async function drainPendingShots(deadlineMs = 5000) {
    const deadline = Date.now() + deadlineMs
    while ((bufferRef.current.length > 0 || inFlightRef.current) && Date.now() < deadline) {
      if (inFlightRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 60))
      } else {
        await flush()
      }
    }
    return bufferRef.current.length === 0 && !inFlightRef.current
  }

  async function flush() {
    if (inFlightRef.current || bufferRef.current.length === 0) return
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    inFlightRef.current = true
    const batch = bufferRef.current.splice(0, MAX_BATCH)
    try {
      const res = await fishingApi.shots({ sessionId, shots: batch })
      let delta = 0
      let payoutSum = 0
      let acceptedShots = 0
      let capturedCount = 0
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
          if (r.captured) capturedCount += 1
          // 記錄已受理逐發，供結算後逐發公平性驗證（verify-shot）。
          shotLogRef.current.push({
            shotSeq: r.shotSeq,
            fishType: shot?.fishType,
            betPerShot: shot?.betPerShot,
            cannonLevel: shot?.cannonLevel,
            hit: r.hit,
            payout: r.payout,
          })
          if (shotLogRef.current.length > SHOT_LOG_CAP) {
            shotLogRef.current.splice(0, shotLogRef.current.length - SHOT_LOG_CAP)
          }
        }
      }
      if (delta !== 0) setBalanceBoth(balanceRef.current + delta)
      if (capturedCount > 0) caughtCountRef.current += capturedCount
      if (acceptedShots > 0 || payoutSum > 0 || capturedCount > 0) {
        setStats((prev) => ({
          totalShots: prev.totalShots + acceptedShots,
          totalPayout: prev.totalPayout + payoutSum,
          caughtCount: prev.caughtCount + capturedCount,
        }))
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

  // 面額/砲台皆為 session 級參數（進場固定，ADR-004）：後端 validateBatch 強制每發 betPerShot
  // 等於進場面額、傷害只認 session.cannonLevel，場中改動會導致整批射擊被拒或前後端傷害分歧，
  // 故僅允許在開場前（phase !== 'playing'）變更。
  const changeBetPerShot = useCallback((nextBet) => {
    if (phase === 'settling') {
      setError('結算中暫時不能切換彈藥')
      return false
    }
    const value = Number(nextBet)
    if (!Number.isInteger(value) || value < BET_MIN || value > BET_MAX) {
      setError(`單發彈藥金額需介於 ${BET_MIN.toLocaleString()} ~ ${BET_MAX.toLocaleString()} 星幣`)
      return false
    }
    betPerShotRef.current = value
    setSession((prev) => (prev ? { ...prev, betPerShot: value } : prev))
    setError(null)
    return true
  }, [phase])

  const changeCannonLevel = useCallback((nextLevel) => {
    if (phase === 'settling') {
      setError('結算中暫時不能切換砲台')
      return false
    }
    const value = Number(nextLevel)
    if (!Number.isInteger(value) || value < 1 || value >= CANNON_DAMAGE.length) {
      setError('未知的砲台等級')
      return false
    }
    cannonLevelRef.current = value
    setSession((prev) => (prev ? { ...prev, cannonLevel: value } : prev))
    setError(null)
    return true
  }, [phase])

  const topUp = useCallback(async ({ amount }) => {
    const sessionId = sessionIdRef.current
    const value = Number(amount)
    if (phase !== 'playing' || !sessionId) return null
    if (!Number.isInteger(value) || value < BUYIN_MIN || value > BUYIN_MAX) {
      setError(`加值金額需介於 ${BUYIN_MIN.toLocaleString()} ~ ${BUYIN_MAX.toLocaleString()} 星幣`)
      return null
    }
    setTopUpLoading(true)
    topUpLockRef.current = true // 先上鎖再排空：確保 drain 完不會再有新批次與 top-up 併發
    setError(null)
    try {
      const drained = await drainPendingShots()
      if (!drained) {
        setError('射擊同步壅塞，請稍後再加值')
        return null
      }
      const clientRequestId = `tu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const result = await fishingApi.topUp({ sessionId, amount: value, clientRequestId })
      if (result.wallet) dispatch(setBalance(result.wallet))
      if (typeof result.sessionBalance === 'number') setBalanceBoth(result.sessionBalance)
      setSession((prev) => (prev ? { ...prev, buyIn: result.buyIn ?? prev.buyIn } : prev))
      return result
    } catch (err) {
      setError(err?.response?.data?.message || err.message || '加值失敗')
      return null
    } finally {
      topUpLockRef.current = false
      setTopUpLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dispatch, setBalanceBoth])

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
      const result = await fishingApi.end({ sessionId })
      if (result.wallet) dispatch(setBalance(result.wallet))
      sessionIdRef.current = null
      // 附上近期逐發紀錄供結算頁公平性驗證（最後幾發優先）。
      setSettleResult({ ...result, caughtCount: caughtCountRef.current, shots: [...shotLogRef.current].reverse() })
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
    setStats({ totalShots: 0, totalPayout: 0, caughtCount: 0 })
    setBalanceBoth(0)
    shotLogRef.current = []
    caughtCountRef.current = 0
    setPhase('idle')
  }, [setBalanceBoth])

  return {
    phase,
    session,
    sessionBalance,
    stats,
    settleResult,
    error,
    topUpLoading,
    cannonLevel: session?.cannonLevel ?? cannonLevelRef.current,
    betPerShot: session?.betPerShot ?? betPerShotRef.current,
    fishTable: session?.fishTable ?? [],
    startSession,
    fire,
    changeBetPerShot,
    changeCannonLevel,
    topUp,
    endSession,
    resetToIdle,
  }
}
