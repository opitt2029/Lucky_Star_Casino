import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { gameApi } from '../services/gameApi'
import { setBalance } from '../store/slices/walletSlice'

// 摮??ａ?嚗?潭釣憿?嚗摰園脣?芷??游摰???啗圾?佗?ADR-004嚗?朣?蝡?MIN_BET/MAX_BET??
// 銝??箏??典予?望嚗?????湔晷敶拙仃??雿敹恍撱箄降?潘??拙振鈭血?芾?頛詨??
export const BET_MIN = 10
export const BET_MAX = 10000
export const BET_TIERS = [10, 50, 100, 500, 1000]
// ?亙??嚗?朣?蝡?MIN_BUYIN/MAX_BUYIN嚗??摰憭抵?選?撖西釭?????憿?????
export const BUYIN_MIN = 100
export const BUYIN_MAX = 1000000
export const BUYIN_TIERS = [1000, 3000, 5000, 10000]
// ??啣?澆蝷摰喉?憿舐內?剁?撠?敺垢 FishingCombat.CANNON_DAMAGE = {1:10, 2:14, 3:18}嚗?
export const CANNON_DAMAGE = [0, 10, 14, 18]

// 撠?瘚?8 ??蝘?+ 15 ??burst嚗?朣?蝡?MAX_SHOTS_PER_SEC / BURST_ALLOWANCE嚗?
// ?砍??token bucket ?嚗?敺◤敺垢?湔??嚗?
const SHOTS_PER_SEC = 8
const BURST_CAPACITY = 15
// flush 蝭憟?皛?10 ?潭?瘥?700ms嚗?嫣???30嚗?朣?蝡?DTO 撽?嚗?
const FLUSH_SIZE = 10
const FLUSH_INTERVAL_MS = 700
const MAX_BATCH = 30
// ?蝝????蝯???撅內餈??詨??潔?撽?嚗??湔活閮擃銝????
const SHOT_LOG_CAP = 50

/**
 * ??璈甈∠??賡望? hook??
 *
 * ?uy-in ? ???寞活撠?嚗??折?憿???綽???蝯??‵?Ｗ????????
 * 撠?瘚hot 蝺抵?/flush 撠?韏瑚?嚗???芾?鞎祉?Ｚ??單???
 *
 * @param {(results, ctx) => void} onResults 瘥 fishingShots ??閫貊嚗esults ?粹?文?嚗?
 *        ctx = { sessionBalance, fishBySeq }嚗???剜?賭葉/???單??晷敶拍??
 */
export function useFishingSession({ onResults, fortuneReady = false } = {}) {
  const dispatch = useDispatch()

  const fortuneReadyRef = useRef(fortuneReady)
  fortuneReadyRef.current = fortuneReady  // 瘥活 render ?郊??啣潘??踹?????

  const [phase, setPhase] = useState('loading') // 'loading' | 'idle' | 'playing' | 'settling' | 'settled'
  const [session, setSession] = useState(null) // { sessionId, cannonLevel, fishTable, serverSeedHash, clientSeed }
  const [sessionBalance, setSessionBalance] = useState(0)
  const [stats, setStats] = useState({ totalShots: 0, totalPayout: 0 })
  const [settleResult, setSettleResult] = useState(null)
  const [error, setError] = useState(null)
  const [topUpLoading, setTopUpLoading] = useState(false)

  // ?單??? ref嚗??????
  const balanceRef = useRef(0)
  const shotSeqRef = useRef(0)
  const bufferRef = useRef([]) // 敺??shot嚗 shotSeq, betPerShot, fishType }
  const fishBySeqRef = useRef(new Map()) // shotSeq ??fishCode嚗???撠?擳車嚗?
  const shotLogRef = useRef([]) // 撌脣??蝝??靘?蝞??砍像?折?霅?嚗???敺?SHOT_LOG_CAP ??
  const bucketRef = useRef({ tokens: BURST_CAPACITY, last: 0 })
  const flushTimerRef = useRef(null)
  const inFlightRef = useRef(false)
  const sessionIdRef = useRef(null)
  const cannonLevelRef = useRef(1)
  const betPerShotRef = useRef(BET_TIERS[0]) // ?拙振?脣?詨???潮憿???啗圾?佗?
  const onResultsRef = useRef(onResults)
  onResultsRef.current = onResults

  const setBalanceBoth = useCallback((next) => {
    balanceRef.current = next
    setSessionBalance(next)
  }, [])

  // ?脣?仿脰?銝剖甈∴??瑞???敺抬???
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
    betPerShotRef.current = view.betPerShot || BET_TIERS[0]
    shotSeqRef.current = view.lastShotSeq || 0
    shotLogRef.current = []
    setBalanceBoth(view.sessionBalance ?? 0)
    setStats({ totalShots: view.totalShots || 0, totalPayout: 0 })
    setSession({
      sessionId: view.sessionId,
      cannonLevel: view.cannonLevel || 1,
      betPerShot: view.betPerShot || BET_TIERS[0],
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
        const view = await gameApi.fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed })
        if (view.wallet) dispatch(setBalance(view.wallet))
        applySessionView(view, view.resumed)
      } catch (err) {
        setError(err?.response?.data?.message || err.message || '?憭望?')
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
   * ?銝?潦???{ ok, reason }嚗k ?歇??寞活銝行?閫????折?憿?
   * reason: 'ratelimited'嚗???敹恬?| 'insufficient'嚗??折?憿?頞喉?| 'inactive'??
   *
   * @param {string} fishInstanceId ?格?擳?instance ?帘摰?id嚗????瑕拿璅∪??其誑頝冽甈∠敞蝛?銝璇??摰喉?
   * @param {string} fishCode       ?格?擳車隞?Ⅳ
   */
  const fire = useCallback((fishInstanceId, fishCode) => {
    if (phase !== 'playing') return { ok: false, reason: 'inactive' }
    const betPerShot = betPerShotRef.current || BET_TIERS[0]
    const cannonLevel = cannonLevelRef.current || 1
    if (balanceRef.current < betPerShot) return { ok: false, reason: 'insufficient' }
    if (!takeToken()) return { ok: false, reason: 'ratelimited' }

    const shotSeq = shotSeqRef.current + 1
    shotSeqRef.current = shotSeq
    fishBySeqRef.current.set(shotSeq, fishCode)
    bufferRef.current.push({ shotSeq, betPerShot, cannonLevel, fishType: fishCode, fishInstanceId: String(fishInstanceId) })
    setBalanceBoth(balanceRef.current - betPerShot) // 璅???釣嚗銝剖??澆????晷敶?

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

  async function drainPendingShots(deadlineMs = 5000) {
    const deadline = Date.now() + deadlineMs
    while ((bufferRef.current.length > 0 || inFlightRef.current) && Date.now() < deadline) {
      if (inFlightRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 60))
      } else {
        await flush()
      }
    }
  }

  async function flush() {
    if (inFlightRef.current || bufferRef.current.length === 0) return
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    inFlightRef.current = true
    const batch = bufferRef.current.splice(0, MAX_BATCH)
    const wasFortuneReady = fortuneReadyRef.current
    try {
      const res = await gameApi.fishingShots({ sessionId, shots: batch, fortuneReady: wasFortuneReady })
      let delta = 0
      let payoutSum = 0
      let acceptedShots = 0
      for (const r of res.results) {
        const shot = batch.find((s) => s.shotSeq === r.shotSeq)
        if (!r.accepted) {
          delta += shot?.betPerShot || 0 // ???閫??釣
        } else {
          acceptedShots += 1
          if (r.payout > 0) {
            delta += r.payout
            payoutSum += r.payout
          }
          // 閮?撌脣??嚗?蝯?敺?砍像?折?霅?verify-shot嚗?
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
      onResultsRef.current?.(res.results, { sessionBalance: res.sessionBalance, fishBySeq, fortuneConsumed: wasFortuneReady })
      res.results.forEach((r) => fishBySeq.delete(r.shotSeq))
    } catch (err) {
      // ?憭望?嚗??寞?閫??釣嚗???折?憿◤?∩???
      const refund = batch.reduce((sum, s) => sum + s.betPerShot, 0)
      if (refund) setBalanceBoth(balanceRef.current + refund)
      setError(err?.response?.data?.message || err.message || '撠??郊憭望?')
    } finally {
      inFlightRef.current = false
    }
  }

  const changeBetPerShot = useCallback((nextBet) => {
    const value = Number(nextBet)
    if (!Number.isInteger(value) || value < BET_MIN || value > BET_MAX) {
      setError(`??????? ${BET_MIN.toLocaleString()} ? ${BET_MAX.toLocaleString()} ??`)
      return false
    }
    betPerShotRef.current = value
    setSession((prev) => (prev ? { ...prev, betPerShot: value } : prev))
    setError(null)
    return true
  }, [])

  const changeCannonLevel = useCallback((nextLevel) => {
    const value = Number(nextLevel)
    if (!Number.isInteger(value) || value < 1 || value >= CANNON_DAMAGE.length) {
      setError('??????????')
      return false
    }
    cannonLevelRef.current = value
    setSession((prev) => (prev ? { ...prev, cannonLevel: value } : prev))
    setError(null)
    return true
  }, [])

  const topUp = useCallback(async ({ amount }) => {
    const sessionId = sessionIdRef.current
    const value = Number(amount)
    if (phase !== 'playing' || !sessionId) return null
    if (!Number.isInteger(value) || value < BUYIN_MIN || value > BUYIN_MAX) {
      setError(`??????? ${BUYIN_MIN.toLocaleString()} ? ${BUYIN_MAX.toLocaleString()} ??`)
      return null
    }
    setTopUpLoading(true)
    setError(null)
    try {
      await drainPendingShots()
      const clientRequestId = `tu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const result = await gameApi.fishingTopUp({ sessionId, amount: value, clientRequestId })
      if (result.wallet) dispatch(setBalance(result.wallet))
      if (typeof result.sessionBalance === 'number') setBalanceBoth(result.sessionBalance)
      setSession((prev) => (prev ? { ...prev, buyIn: result.buyIn ?? prev.buyIn } : prev))
      return result
    } catch (err) {
      setError(err?.response?.data?.message || err.message || '??????????')
      return null
    } finally {
      setTopUpLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dispatch, setBalanceBoth])

  const endSession = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId || phase !== 'playing') return
    setPhase('settling')
    if (flushTimerRef.current) window.clearInterval(flushTimerRef.current)
    // ??畾?摮?????蝞??踹? in-flight ??敹?嚗?
    // 閮剔′?扳甇Ｘ????踹?? flush ?∪ in-flight ???蝞偶?甇鳴?撖批撣嗆?擗?憿?蝯?嚗?
    // 敺垢隞亙??折?憿皞甈橘?隞蝑??剁???
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
      // ??餈??蝝??蝯??撟單折?霅??敺嗾?澆????
      setSettleResult({ ...result, shots: [...shotLogRef.current].reverse() })
      setPhase('settled')
    } catch (err) {
      // 蝯?憭望?嚗??粹????舐嚗??湔活隞敺垢??芷嚗?湔???蝬脩?蝞?閰佗??芰?摰嚗?
      const reason = err?.response?.data?.message || err.message || '蝯?憭望?'
      setError(`${reason}，收網失敗，已保留本局，可稍後再試。`)
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
