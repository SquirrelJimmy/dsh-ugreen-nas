# dsh-ugreen-nas

把绿联云 NAS 接入 DeepSeek Harness（DSH）的 Host+Client 插件。插件封装官方 `unc` CLI，提供原生 DSH 工具、插件详情页登录卡片和内置 Skill。

## 功能

- 自动识别 macOS、Linux、Windows 的 amd64/arm64 平台。
- 支持两种登录方式：
  - DDNS / 局域网地址：`https://<域名或 IP>:9443`
  - UGREENlink ID：官方中继穿透，不依赖内网。
- 下载官方 `unc` 发布包，进行 SHA-256 校验后原子切换。
- 使用 `spawn` + argv 调用 `unc`，不拼接 shell 命令。
- 提供三个 DSH 原生工具：
  - `ugreen_nas`：执行允许的 `unc` 命令。
  - `ugreen_nas_auth`：`status`、`login`、`start`、`cancel`、`logout`。
  - `ugreen_nas_setup`：`status`、`install`、`update`。
- 注册内置 `ugreen-nas` Skill，作为日常使用的主入口。

## 环境

- 支持 Host+Client bundle 的 DSH 版本。
- Node.js 24 或更高版本。
- 能访问 `unc` 发布源的网络环境。

## 安装

在 DSH 的“插件”页面点击“添加插件”，选择本项目目录；也可以在项目根目录执行：

```bash
dsh plugin --profile <profile> add "$PWD"
```

修改源码后，在插件页面关闭再开启插件，或重启 DSH，使 Host 和客户端 bundle 重新加载。

## 登录

打开 `dsh-ugreen-nas` 插件详情页，在“绿联云连接”卡片中选择连接方式。

### DDNS / 局域网地址

适用于已配置 DDNS 或可直接访问的 NAS：

```text
连接方式：DDNS / 局域网
NAS 地址：https://nas.example.com:9443
访问令牌：ugpoa_ 开头的开放平台令牌
```

也可以填写局域网地址，例如 `https://192.168.1.50:9443`。

### UGREENlink ID

适用于没有公网地址、需要官方中继穿透的场景：

```text
连接方式：UGREENlink ID
UGREENlink ID：your-link-id
访问令牌：ugpoa_ 开头的开放平台令牌
```

也支持直接填写 `https://ug.link/your-link-id`。该方式由官方中继服务转发，不要求 NAS 暴露在公网。

### 登录流程

1. Host 内部调用 `unc auth login`：DDNS 模式使用 `--host`，UGREENlink ID 模式使用 `--uglink-id`。
2. 令牌只通过 `UNC_NAS_TOKEN` 环境变量传递，不出现在命令行参数、插件配置或 UI 返回值中。
3. 登录成功后，`unc` 将凭证写入本机 `~/.unc/auth.json`；插件不读取或复制 token。
4. `ugreen_nas_auth` 的 `status` 动作可检查登录状态；`logout` 动作清除凭证。

### 开发期 `.env`

项目根目录的 `.env` 仅用于开发期初始化，不会进入发布包：

```dotenv
UGREEN_NAS_LOGIN_MODE=ddns
UGREEN_NAS_HOST=https://nas.example.com:9443
UGREEN_NAS_LINK_ID=your-link-id
UGREEN_NAS_TOKEN=<访问令牌>
```

`UGREEN_NAS_LOGIN_MODE` 可省略；只配置 `UGREEN_NAS_LINK_ID` 时默认使用 UGREENlink ID，否则默认使用 DDNS。旧字段 `HOST`、`AUTH_TOKEN` 仍兼容。

私有局域网地址通常使用自签名证书，Host 只对 localhost、私有 IPv4 地址段和 `.local` 域名自动追加 `--insecure`；公网地址仍执行正常证书校验。

## 使用示例

```json
{"argv":["file","ls-root","--root","shared"]}
{"argv":["file","ls","/volume1/your-share"]}
{"argv":["docker","ps"]}
{"argv":["storage","disk","ls"]}
{"argv":["taskmgr","overview","--format","json"]}
```

`file ls /` 不是有效的共享根查询，应先执行 `file ls-root --root shared`，再使用返回的 `/volumeX/...` 路径。

写操作和破坏性操作需要在当前工具调用中显式传入 `confirm: true`，插件不会自动确认，也不会自动追加 `--yes`。

## 工具

| 工具 | 用途 |
|---|---|
| `ugreen_nas` | 执行 `unc` 命令；`argv` 为参数数组 |
| `ugreen_nas_auth` | 登录、状态、退出和取消登录 |
| `ugreen_nas_setup` | 查询、安装和更新 `unc` 二进制 |

## 配置

运行配置的默认值位于 `lib/state.js`：

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `versionPolicy` | `latest` | 使用最新版本，或使用固定清单 |
| `pinnedVersion` | `0.1.61` | 固定策略使用的版本 |
| `autoCheckHours` | `24` | 发布信息缓存时长 |
| `timeoutMs` | `60000` | `unc` 命令默认超时 |
| `maxOutputBytes` | `1048576` | 默认输出上限 |
| `allowWrites` | `true` | 是否允许非破坏性写操作 |
| `requireConfirm` | `true` | 风险操作是否需要显式确认 |
| `installSkills` | `true` | 安装 `unc` 时是否同时安装 Skill |
| `dataDir` | `$DSH_HOME/ugreen-nas` | 二进制和发布缓存目录 |

状态目录包含 `versions/<version>/` 和 `current.json`，但不会保存访问令牌。

## Skill

- `ugreen-nas`：插件内置 Skill，是面向用户的主入口，负责引导模型使用 `ugreen_nas` 工具和登录流程。
- `ugreen-nas-cli`：官方 `unc` 安装器附带的原始 CLI Skill；默认不自动调用，用户仍可手动使用。

## 开发与验证

```bash
npm test
node --check index.js
node --check lib/*.js
node --check test/*.js
npm pack --dry-run
```

测试覆盖归档安全、校验和、平台识别、发布解析、策略分类、二进制状态、认证脱敏与双模式登录、connection fetch 路由、客户端 bundle 和 Skill 注册。

## 安全默认值

- 插件不会把 token 写入 `cordis.patch.yml`、普通配置或日志。
- 下载使用 HTTPS、重定向校验和 SHA-256 校验。
- 写操作和破坏性操作默认需要调用方显式确认。
- `.env` 仅用于开发，已加入 `.gitignore`。

## 目录结构

- `index.js`：DSH bundle 入口，注册工具、认证路由和内置 Skill。
- `lib/`：平台、发布、下载、归档、二进制管理、策略、认证、状态、Web 路由、客户端 bundle 和工具定义。
- `skills/ugreen-nas/`：Skill 指令和命令参考。
- `assets/pinned-manifest.json`：`unc` 固定版本资产与校验和。
- `locale/`：插件展示元数据。
- `docs/DESIGN.md`：设计说明。
- `docs/IMPLEMENTATION_PLAN.md`：实施计划与验收标准。
