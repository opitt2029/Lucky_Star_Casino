import PageStub from '../components/PageStub'

export default function Dashboard() {
  return (
    <PageStub
      title="總覽"
      description="營運概況與異常告警（admin_alerts，T-054）的儀表板首頁。"
      apis={[
        'GET /admin/reports/coin-flow?dimension=day（近 7 日流通概況）',
        'GET /admin/reports/rtp（各遊戲 RTP 與 ABNORMAL 標記）',
        '（告警列表 API 待後端補：admin_alerts 目前僅寫入、尚無查詢端點）',
      ]}
    />
  )
}
