import PageStub from '../components/PageStub'

export default function RtpReport() {
  return (
    <PageStub
      title="RTP 監控"
      description="實際 vs 設計 RTP 比對，偏差 >5% 標 ABNORMAL（T-053）。"
      apis={['GET /admin/reports/rtp?game=&from=YYYY-MM-DD&to=YYYY-MM-DD（game 可不帶=查全部）']}
    />
  )
}
