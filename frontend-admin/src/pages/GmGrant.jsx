import PageStub from '../components/PageStub'

// 路由層已由 SuperAdminRoute 守門（OPERATOR 看不到入口也進不來），
// 後端另有 @PreAuthorize("hasRole('SUPER_ADMIN')") 作最終防線。
export default function GmGrant() {
  return (
    <PageStub
      title="GM 發幣"
      description="向指定玩家手動發放星幣，走 wallet.credit.request 指令由 wallet-service 入帳，並寫 admin_action_logs 稽核（T-055，僅 SUPER_ADMIN）。"
      apis={['POST /admin/gm/grant（subType=GM_REWARD，冪等鍵防重複發放）']}
    />
  )
}
