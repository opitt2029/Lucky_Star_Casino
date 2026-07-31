import SocialProviderIcon from '../../components/SocialProviderIcon'

function SocialActions({ providers, socialLoading, onSocialLogin }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => onSocialLogin(provider)}
          disabled={Boolean(socialLoading)}
          className={`flex items-center justify-center gap-2 rounded border px-3 py-3 text-sm font-black transition hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-55 ${provider.accentClass}`}
        >
          <SocialProviderIcon provider={provider.id} className="h-5 w-5" />
          {socialLoading === provider.id ? '連線中...' : provider.label}
        </button>
      ))}
    </div>
  )
}

export function LoginForm({
  form,
  onChange,
  onSubmit,
  loading,
  error,
  notice,
  providers,
  socialLoading,
  onSocialLogin,
}) {
  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        帳號
        <input
          name="username"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          value={form.username}
          onChange={onChange}
          autoComplete="username"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        密碼
        <input
          name="password"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          value={form.password}
          onChange={onChange}
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <SocialActions providers={providers} socialLoading={socialLoading} onSocialLogin={onSocialLogin} />
      <AuthMessages notice={notice} error={error} />
      <button
        type="submit"
        disabled={loading}
        className="gold-button mt-2 rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? '登入中...' : '登入會員'}
      </button>
    </form>
  )
}

export function RegisterForm({
  form,
  onChange,
  onSubmit,
  loading,
  error,
  notice,
  birthDateMax,
  ageError,
  providers,
  socialLoading,
  onSocialLogin,
}) {
  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      <p className="text-sm font-bold text-yellow-100/70">
        使用第三方快速註冊，驗證完成後只需設定遊戲帳號。
      </p>
      <SocialActions providers={providers} socialLoading={socialLoading} onSocialLogin={onSocialLogin} />
      <div className="flex items-center gap-3 text-xs font-bold text-yellow-100/45">
        <span className="h-px flex-1 bg-yellow-200/15" />
        或使用帳號密碼註冊
        <span className="h-px flex-1 bg-yellow-200/15" />
      </div>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        帳號
        <input
          name="username"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          placeholder="lucky-player"
          value={form.username}
          onChange={onChange}
          minLength={3}
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        暱稱
        <input
          name="nickname"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          placeholder="Lucky Player"
          value={form.nickname}
          onChange={onChange}
          minLength={2}
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        姓名
        <input
          name="realName"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          placeholder="王小明"
          value={form.realName}
          onChange={onChange}
          minLength={2}
          maxLength={80}
          autoComplete="name"
          required
        />
        <span className="text-xs text-yellow-100/55">姓名註冊後不可自行更改，請確認與身分資料一致。</span>
      </label>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        Email
        <input
          name="email"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          placeholder="player@example.com"
          value={form.email}
          onChange={onChange}
          type="email"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        密碼
        <input
          name="password"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          value={form.password}
          onChange={onChange}
          type="password"
          minLength={8}
          pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
          title="至少 8 碼，並包含英文與數字"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
        出生日期
        <input
          name="birthDate"
          className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
          value={form.birthDate}
          onChange={onChange}
          type="date"
          max={birthDateMax}
          required
        />
        <span className="text-xs text-yellow-100/55">生日只能在註冊時設定，日後如需修正請聯繫客服。</span>
      </label>
      <label className="flex items-start gap-3 rounded border border-yellow-200/15 bg-red-950/50 px-4 py-3 text-sm font-bold text-yellow-100/78">
        <input
          name="adultConfirmed"
          className="mt-1 h-4 w-4 accent-yellow-200"
          checked={form.adultConfirmed}
          onChange={onChange}
          type="checkbox"
          required
        />
        <span>我確認已年滿 18 歲，並同意建立會員帳號。</span>
      </label>
      <AuthMessages
        notice={notice}
        error={error}
        validationError={ageError ? '出生日期未滿 18 歲，無法完成註冊。' : ''}
      />
      <button
        type="submit"
        disabled={loading || Boolean(ageError)}
        className="gold-button mt-2 rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? '建立中...' : '建立帳號'}
      </button>
    </form>
  )
}

function AuthMessages({ notice, error, validationError = '' }) {
  return (
    <>
      {notice && (
        <p className="rounded border border-yellow-200/25 bg-yellow-200/10 px-4 py-3 text-sm font-bold text-yellow-100">
          {notice}
        </p>
      )}
      {validationError && (
        <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
          {validationError}
        </p>
      )}
      {error && (
        <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
          {error}
        </p>
      )}
    </>
  )
}
