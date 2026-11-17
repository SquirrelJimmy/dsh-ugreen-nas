window.__ModuleLoader__.load({
  id: 'dsh-ugreen-nas',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const ROUTE = '/api/ugreen-nas/auth'

    const colors = {
      text: 'var(--dsh-text-primary, #1f2328)',
      muted: 'var(--dsh-text-secondary, #656d76)',
      border: 'var(--dsh-border-default, #d0d7de)',
      surface: 'var(--dsh-surface-subtle, #f6f8fa)',
      accent: 'var(--dsh-accent-emphasis, #0969da)',
      danger: 'var(--dsh-danger-fg, #cf222e)',
      success: 'var(--dsh-success-fg, #1a7f37)',
    }

    async function api(action, payload) {
      const response = await fetch(ROUTE, {
        method: action === 'status' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: action === 'status' ? undefined : JSON.stringify({ action, ...payload }),
      })
      let body
      try {
        body = await response.json()
      } catch {
        body = { ok: false, message: `HTTP ${response.status}` }
      }
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`)
      return body
    }

    function statusText(data) {
      const status = data?.status || data || {}
      if (status.authenticated) return '已连接'
      if (status.state === 'pending') return '登录中'
      if (status.state === 'failed') return '登录失败'
      if (status.state === 'expired') return '登录已过期'
      return '未连接'
    }

    function LoginSection() {
      const [mode, setMode] = React.useState('ddns')
      const [host, setHost] = React.useState('')
      const [linkId, setLinkId] = React.useState('')
      const [token, setToken] = React.useState('')
      const [hasEnvToken, setHasEnvToken] = React.useState(false)
      const [status, setStatus] = React.useState({ state: 'idle', authenticated: false })
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)
      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 9px',
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        background: 'white',
        color: colors.text,
      }

      const refresh = React.useCallback(async () => {
        if (busyRef.current) return
        try {
          const data = await api('status')
          setStatus(data.status || { state: 'idle', authenticated: false })
          setMode((current) => current || data.defaults?.mode || 'ddns')
          setHost((current) => current || data.defaults?.host || '')
          setLinkId((current) => current || data.defaults?.linkId || '')
          setHasEnvToken(Boolean(data.defaults?.hasToken))
        } catch (error) {
          setMessage(error.message)
        }
      }, [])

      React.useEffect(() => {
        void refresh()
        const timer = setInterval(() => { void refresh() }, 5000)
        return () => clearInterval(timer)
      }, [refresh])

      async function submit(event) {
        event.preventDefault()
        busyRef.current = true
        setBusy(true)
        setMessage('')
        try {
          const data = await api('login', {
            mode,
            host: mode === 'ddns' ? host : '',
            linkId: mode === 'linkid' ? linkId : '',
            token,
          })
          if (!data.ok) throw new Error(data.message || '登录失败')
          setToken('')
          setStatus({ state: 'authenticated', authenticated: true })
          setMessage('已连接绿联云')
          await refresh()
        } catch (error) {
          setStatus({ state: 'failed', authenticated: false })
          setMessage(error.message)
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      }

      async function logout() {
        busyRef.current = true
        setBusy(true)
        setMessage('')
        try {
          await api('logout')
          setStatus({ state: 'idle', authenticated: false })
          setMessage('已退出登录')
        } catch (error) {
          setMessage(error.message)
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      }

      const connected = Boolean(status.authenticated)
      const label = statusText({ status })
      const modeButton = (value, text) =>
        h(
          'button',
          {
            type: 'button',
            onClick: () => setMode(value),
            style: {
              padding: '5px 9px',
              border: `1px solid ${mode === value ? colors.accent : colors.border}`,
              borderRadius: 6,
              background: mode === value ? colors.accent : 'white',
              color: mode === value ? 'white' : colors.text,
              cursor: 'pointer',
              fontSize: 12,
            },
          },
          text,
        )
      return h(
        'section',
        { style: { marginTop: 20, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16, background: colors.surface } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 } },
          h('div', null,
            h('div', { style: { fontSize: 15, fontWeight: 600, color: colors.text } }, '绿联云连接'),
            h('div', { style: { fontSize: 12, color: colors.muted, marginTop: 2 } }, '通过 unc 登录 NAS；令牌只交给本机 Host，不会写入配置。'),
          ),
          h('span', { style: { color: connected ? colors.success : colors.muted, fontSize: 12, whiteSpace: 'nowrap' } }, label),
        ),
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 4 } }, modeButton('ddns', 'DDNS / 局域网'), modeButton('linkid', 'UGREENlink ID')),
        h('div', { style: { fontSize: 12, color: colors.muted, marginBottom: 4 } },
          mode === 'linkid'
            ? '使用 UGREENlink ID 的官方中继，不依赖内网。'
            : '填写 DDNS 域名或局域网 HTTPS 地址。'),
        h('form', { onSubmit: submit, style: { display: 'grid', gap: 8 } },
          mode === 'linkid'
            ? [
                h('label', { key: 'link-label', style: { fontSize: 12, color: colors.muted } }, 'UGREENlink ID'),
                h('input', {
                  key: 'link-input',
                  value: linkId,
                  onChange: (event) => setLinkId(event.target.value),
                  placeholder: 'your-link-id 或 https://ug.link/your-link-id',
                  autoComplete: 'off',
                  style: inputStyle,
                }),
              ]
            : [
                h('label', { key: 'host-label', style: { fontSize: 12, color: colors.muted } }, 'NAS 地址'),
                h('input', {
                  key: 'host-input',
                  value: host,
                  onChange: (event) => setHost(event.target.value),
                  placeholder: 'https://nas.example.com:9443',
                  autoComplete: 'url',
                  style: inputStyle,
                }),
              ],
          h('label', { style: { fontSize: 12, color: colors.muted, marginTop: 2 } }, '访问令牌'),
          h('input', {
            value: token,
            onChange: (event) => setToken(event.target.value),
            type: 'password',
            placeholder: '粘贴 ugpoa_ 开头的访问令牌',
            autoComplete: 'current-password',
            style: inputStyle,
          }),
          hasEnvToken ? h('div', { style: { fontSize: 12, color: colors.success } }, '已从项目 .env 检测到访问令牌；令牌留空时使用它。') : null,
          h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
            h('button', { type: 'submit', disabled: busy, style: { padding: '6px 12px', border: 0, borderRadius: 6, background: colors.accent, color: 'white', cursor: busy ? 'default' : 'pointer' } }, busy ? '处理中…' : connected ? '重新连接' : '连接'),
            connected ? h('button', { type: 'button', onClick: logout, disabled: busy, style: { padding: '6px 12px', border: `1px solid ${colors.border}`, borderRadius: 6, background: 'white', color: colors.text, cursor: busy ? 'default' : 'pointer' } }, '退出登录') : null,
          ),
        ),
        message ? h('div', { style: { marginTop: 8, fontSize: 12, color: status.state === 'failed' ? colors.danger : colors.muted } }, message) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('plugins.detail.section', () => ctx.slots.register(
        { name: 'plugins.detail.section', id: 'ugreen-nas-login', order: 100, label: '绿联云连接' },
        LoginSection,
      ))
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
