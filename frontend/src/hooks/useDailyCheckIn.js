import { useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchProfile } from '../store/slices/authSlice'
import {
  claimMonthlyReward,
  dailyCheckIn,
  fetchCheckInStatus,
} from '../store/slices/walletSlice'
import {
  calculateDailyCheckInReward,
  getMonthDays,
  getTaipeiDateKey,
} from '../utils/checkInDates'

/**
 * 簽到（每日 + 月度累計獎勵）的單一 hook。
 *
 * 後端權威：mount 時抓 GET /api/v1/wallet/checkin/status，月曆已簽日期、本月累計天數、
 * 連續天數、月度里程碑領取旗標皆讀自此（不再用 localStorage，根治 CheckIn.jsx 漏存的累計 bug）。
 * 三個頁面（CheckIn / AppShell 彈窗 / Profile 側欄）共用此 hook，消除過去的複製貼上 helper。
 */
export function useDailyCheckIn() {
  const dispatch = useDispatch()
  const player = useSelector((state) => state.auth.player)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const wallet = useSelector((state) => state.wallet)
  const status = wallet.checkInStatus

  // mount / 換玩家時抓後端權威狀態
  useEffect(() => {
    if (isAuthenticated && player?.id) {
      dispatch(fetchCheckInStatus())
    }
  }, [dispatch, isAuthenticated, player?.id])

  const derived = useMemo(() => {
    const todayKey = getTaipeiDateKey()
    const currentMonthKey = status.month || todayKey.slice(0, 7)
    const monthDays = getMonthDays(currentMonthKey)
    const signedDates = status.signedDates || []
    const signedDayNumbers = new Set(signedDates.map((date) => Number(date.slice(8, 10))))

    const hasCheckedInToday = status.checkedInToday || player?.lastCheckInDate === todayKey
    const consecutiveDays =
      status.consecutiveDays ?? wallet.checkIn.consecutiveDays ?? player?.consecutiveCheckInDays ?? 0
    const upcomingConsecutiveDays = hasCheckedInToday ? consecutiveDays : consecutiveDays + 1
    const projectedReward = calculateDailyCheckInReward(Math.max(upcomingConsecutiveDays, 1))

    return {
      todayKey,
      currentMonthKey,
      monthDays,
      monthLabel: `${Number(currentMonthKey.slice(5, 7))} 月`,
      signedDates,
      signedDayNumbers,
      monthCheckinDays: status.monthCheckinDays ?? signedDates.length,
      hasCheckedInToday,
      consecutiveDays,
      upcomingConsecutiveDays,
      projectedReward,
      milestones: status.milestones || [],
    }
  }, [status, player?.lastCheckInDate, player?.consecutiveCheckInDays, wallet.checkIn.consecutiveDays])

  // 簽到：成功後刷新 profile（status/wallet 由 thunk 內部 re-dispatch）
  const checkInToday = async () => {
    if (!player?.id) return null
    try {
      const result = await dispatch(dailyCheckIn()).unwrap()
      dispatch(fetchProfile())
      return result
    } catch {
      return null
    }
  }

  // 領取月度累計獎勵：成功後 status 由 thunk 內部 re-dispatch 刷新
  const claimReward = async (milestoneDays) => {
    try {
      return await dispatch(claimMonthlyReward(milestoneDays)).unwrap()
    } catch {
      return null
    }
  }

  return {
    ...derived,
    statusLoading: status.loading,
    // 後端簽到狀態是否已成功抓回至少一次（月份非空才算載入完成）。
    // 用於避免在狀態載入前就依「空狀態」誤判（例：自動彈出簽到視窗）。
    statusLoaded: Boolean(status.month),
    statusError: status.error,
    checkInLoading: wallet.checkIn.loading,
    checkInMessage: wallet.checkIn.message,
    claiming: wallet.monthlyReward.claiming,
    claimMessage: wallet.monthlyReward.message,
    claimError: wallet.monthlyReward.error,
    walletError: wallet.error,
    balance: wallet.balance,
    checkInToday,
    claimReward,
    refreshStatus: () => dispatch(fetchCheckInStatus()),
  }
}
