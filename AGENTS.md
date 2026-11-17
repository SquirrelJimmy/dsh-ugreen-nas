# AGENTS.md

适用范围：当前项目目录 `dsh-ugreen-nas/`。

修改行为前先阅读 `README.md`、`docs/DESIGN.md` 和
`docs/IMPLEMENTATION_PLAN.md`。项目必须保持自包含，不要在共享工作区根目录
初始化 Git 或 npm。

## 项目契约

- `dsh-ugreen-nas` 是 Host+Client DSH bundle，不是 MCP 服务。
- `index.js` 导出 `inject = ['tools', 'skills']` 和 `apply(ctx, config)`。
- 三个原生工具是 `ugreen_nas`、`ugreen_nas_auth`、`ugreen_nas_setup`；
  内置 Skill 名称是 `ugreen-nas`。
- `package.json` 必须保留 `dsh.manifestVersion`、`dsh.bundle.patch`、
  `dsh.client.inject`、`dsh.client.platform` 和 `./client` 导出。
- `lib/web-server.js` 通过 `ctx.connection.fetch` 注册
  `/api/ugreen-nas/auth`；`lib/client.js` 必须使用相同的
  `/api/ugreen-nas/auth` 路径。`ctx.webServer` 回退路由保持
  `/dsh-ugreen-nas/api/auth`，供非 Desktop 宿主使用。
- DSH `defineTool` 的 `output.schema` 使用 ValueSchemaSpec DSL，不能在
  `output.schema` 顶层写 `required: [...]`；应逐属性声明并使用
  `additionalProperties`。

## Skill 规则

- `lib/skill.js` 注册内置 Skill 时必须包含 `source: 'bundled'` 和
  `whenToUse`，并把 `ugreen-nas` 标为 DSH 主入口。缺少 `source` 会触发
  `loaded skill "ugreen-nas" source must be a string`。
- 不要暴露第二个模型可见的 NAS Skill。官方原始 CLI Skill
  `ugreen-nas-cli` 位于 `<用户主目录>/.agents/skills/unc/SKILL.md`；
  在该文件 frontmatter 中保留 `disable-model-invocation: true`，这样只有
  `ugreen-nas` 会被模型自动选择，用户仍可手动调用 `/ugreen-nas-cli`。
- UGreen 安装器或 `unc skill setup` 可能覆盖该文件；如果重复入口再次出现，
  需要重新补回 frontmatter 指令。

## 认证与密钥

- 登录必须在插件内部完成：Host 调用 `unc auth login`，支持 DDNS/HTTPS 地址和
  UGREENlink ID 两种模式。不要新增浏览器登录流程，也不要启动
  `127.0.0.1` 登录页。
- DDNS 模式使用 `--host`；UGREENlink ID 模式使用 `--uglink-id`，不能把
  UGREENlink ID 当作普通 host 传给 `--host`。
- token 不得进入 argv、配置文件、日志或工具输出；只能通过
  `UNC_NAS_TOKEN` 传递（如果明确变更设计，可使用 DSH 的凭证/密钥机制）。
- `.env` 仅用于开发期。不要打印、提交或打包其中的值；它不在
  `package.json` 的 `files` 中。
- 私有局域网主机（`localhost`、`127.0.0.0/8`、`10/8`、`192.168/16`、
  `172.16/12`、`.local`）可能需要 `--insecure` 来兼容 NAS 自签名证书；
  公网主机不得使用 `--insecure`。
- 不要把 `<WorkBuddy 安装目录>` 或 `<用户主目录>/.workbuddy` 作为
  本项目的一部分进行修改。

## 命令与验证

使用 Node.js 24 以上版本和 npm。

```bash
npm test
node --check index.js
node --check lib/*.js
node --check test/*.js
npm pack --dry-run
```

- 行为变更必须补有针对性的测试；当前测试套件为 33 个测试。
- 不要在普通 Node 单元测试中直接导入 `lib/tools/index.js`，除非已经准备好
  DSH 的 peer runtime；`@deepseek-ai/dsh-tools` 由 Host 提供。
- 本地安装使用 DSH 的“插件”页面，或在项目根目录执行：

  ```bash
  dsh plugin --profile <profile> add "$PWD"
  ```

  profile 写入需要相应权限；不要手工编辑
  `<用户主目录>/.dsh/profiles/<profile>/package.json` 或
  `cordis.patch.yml`。
- 修改 Host 或客户端源码后，必须在插件页面关闭再开启插件，或重启 DSH，
  才能声称 UI 已验证。

## 安全

- `lib/policy.js` 禁止 `plugin`、`skill`、`upgrade`、`uninstall`、
  `completion`。除非用户明确要求，否则不要放宽这些边界。
- 破坏性操作必须要求当前调用显式传入 `confirm: true`；不要自动追加
  `--yes`，也不要自动确认。
- 所有 `unc` 调用必须通过 `lib/unc-runner.js`，使用
  `spawn(..., { shell: false })` 和 argv 数组；不要用用户输入拼 shell 命令。
- 不要发布 npm 包，也不要在任务范围外修改网络或凭证配置。

行为变更时同步更新 `README.md`；如果工作流发生变化，还要更新本文件以及
`docs/DESIGN.md` 或 `docs/IMPLEMENTATION_PLAN.md` 的相关章节。
