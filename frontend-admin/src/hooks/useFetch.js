import { useCallback, useEffect, useRef, useState } from 'react'
import { extractError } from '../services/adminApi'

// 後台頁面的資料都是「進頁抓、離頁丟」，沒有跨頁共享需求，
// 所以不進 redux（只有 auth 是全域），用這個小 hook 統一 loading/error/重載樣板。
//
// 用法：fetchFn 用 useCallback 包住、把查詢參數（page、filter…）收進依賴，
// 參數一變 fetchFn 引用就變，這裡會自動重抓。
export function useFetch(fetchFn) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // 競態守門：參數連續變動時只採用「最後一次」請求的結果，
  // 否則慢的舊回應晚到會覆蓋新結果（典型的 race condition）。
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetchFn()
      if (seq === seqRef.current) {
        setData(result)
        setLoading(false)
      }
    } catch (err) {
      if (seq === seqRef.current) {
        setError(extractError(err))
        setLoading(false)
      }
    }
  }, [fetchFn])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, reload: load }
}
