# DSH 绿联云插件实施计划

> 版本：0.1（规划稿）  
> 日期：2026-11-14  
> 状态：已实现并验收；原始计划保留，当前行为以 [README.md](../README.md) 和 [AGENTS.md](../AGENTS.md) 为准  
> 关联文档：[README.md](../README.md) · [DESIGN.md](./DESIGN.md)  
> 实现差异：最终交付为 Host+Client bundle；登录走插件详情页，支持 DDNS/HTTPS 与 UGREENlink ID 两种模式，Host 调用 `unc auth login`，不依赖 `unc auth workbuddy` 的浏览器回环页。

## 1. 计划范围

本计划最初描述把 `dsh-ugreen-nas` 从零实现为 DSH Host-only bundle；最终实现已扩展为 Host+Client bundle，当前行为以 [README.md](../README.md) 为准。原计划保留作为实施记录，M1 之后的代码、测试、bundle 和安装动作均已完成。

### 1.1 交付物

本阶段（M0）只交付：

```text
docs/ugreen-nas-dsh-plugin/
├── README.md
├── DESIGN.md
└── IMPLEMENTATION_PLAN.md
```

不交付：

- 插件源码、`package.json`、`cordis.patch.yml`
- `node_modules`、bundle 压缩包、安装脚本
- 对 WorkBuddy、DSH profile、`~/.unc` 或 `~/.agents` 的任何修改

### 1.2 完成定义

- 三份文档齐备、互链正确、内容与当前证据一致。
- 文档明确区分“已确认事实”“设计决定”“待验证假设”。
- 实施计划可被另一名工程师在没有口头补充的情况下执行。

## 2. 实施原则

1. **先验证 DSH 插件加载，再写业务代码。** 若 Host-only bundle 无法解析 `@deepseek-ai/dsh-tools`，后面的工具代码全部没有意义。
2. **二进制管理先行。** `ugreen_nas`、`ugreen_nas_auth`、`ugreen_nas_setup` 都依赖同一个 `BinaryManager`，先把安装、校验、回滚做对。
3. **每次变更可回退。** 任何下载/解压/切换失败都不能破坏当前可用版本。
4. **不做大而全的 73 个 typed tool。** 用 `argv` 透传覆盖全部命令，用 Skill 提供命令知识；v1 不手写 73 个 schema。
5. **安全默认值优先。** 不自动 `--yes`，不读 token，不用 shell，不把下载源写死在不可配置的代码里。
6. **测试按平台分层。** macOS arm64 与 Linux amd64 必须有自动化/半自动记录；Windows 至少做一次手动冒烟。

## 3. 里程碑总览

| 里程碑 | 目标 | 预计工作量 | 依赖 |
|---|---|---:|---|
| M0 | 设计与规划文档 | 0.5–1 人日 | 已完成分析与资料 |
| M1 | DSH 插件骨架与模块解析验证 | 1–1.5 人日 | M0 文档确认 |
| M2 | 平台检测、下载、校验、解压、二进制管理 | 1.5–2 人日 | M1 |
| M3 | `unc` 执行器、策略层、`ugreen_nas` / `ugreen_nas_setup` | 2–2.5 人日 | M2 |
| M4 | 认证管理、`ugreen_nas_auth`、Skill 注册 | 1–1.5 人日 | M3 |
| M5 | 集成、跨平台、异常测试、文档收尾 | 2–3 人日 | M4 |
| 合计 | 可交付 v0.1.0 本地 bundle | 8–11 人日 | — |

估算不含等待外部审批、NAS 环境准备和 Windows 真机获取时间。

## 4. M0：文档落地

### 4.1 任务

| 编号 | 任务 | 产物 |
|---|---|---|
| M0-1 | 写总览和阅读顺序 | `README.md` |
| M0-2 | 写架构、平台矩阵、工具 API、安全模型 | `DESIGN.md` |
| M0-3 | 写里程碑、任务、测试矩阵、验收、风险 | `IMPLEMENTATION_PLAN.md` |
| M0-4 | 自检：链接、术语、边界、无“已实现”误述 | 三份文档 |

### 4.2 验收

- 三份文件均为 UTF-8 Markdown，能从 `README.md` 到达另外两份。
- 不包含可执行源码；代码块只用于 schema、目录树和接口示意。
- 明确写出“只做文档，不开发、不安装”。

## 5. M1：插件骨架与兼容性验证

### 5.1 目标

建立一个能被 DSH `plugin_manager` 识别的本地 bundle，并验证三个关键接口：

1. `dsh.bundle.patch` 能被读取；
2. `apply(ctx, config)` 能被调用；
3. `defineTool`、`ctx.tools.register`、`ctx.skills.register` 可用。

### 5.2 文件清单

```text
dsh-ugreen-nas/
├── package.json
├── cordis.patch.yml
├── index.js
├── locale/en.json
├── locale/zh.json
├── README.md
├── icon.svg
└── lib/
    └── state.js
```

### 5.3 任务

| 编号 | 任务 | 细节 |
|---|---|---|
| M1-1 | 创建 `package.json` | `type: module`、`exports["."]`、`dsh.bundle.patch`、`peerDependencies` |
| M1-2 | 创建 `cordis.patch.yml` | `- insert: id: ugreen-nas, name: dsh-ugreen-nas` |
| M1-3 | 创建 `index.js` | 导出 `inject = ['tools','skills']` 与 `apply()`；先注册一个临时 `ugreen_nas_setup` 占位工具 |
| M1-4 | 创建 locale/README/icon | 中文标题“绿联云 NAS”，英文“UGREEN NAS”；图标为 SVG |
| M1-5 | 本地 bundle 安装测试 | 使用临时 DSH profile，不碰 `desktop` profile |
| M1-6 | 模块解析验证 | `@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` |
| M1-7 | 记录结果 | 写入 `docs/COMPATIBILITY.md` 或实施记录，不修改设计结论 |

### 5.4 关键接口

```js
// index.js
export const inject = ['tools', 'skills']

export async function apply(ctx, config) {
  // 注册工具、Skill、dispose 清理
}
```

### 5.5 兼容性备选

如果本地 bundle 无法解析 `@deepseek-ai/dsh-tools`：

1. 先确认 `plugin_manager` 安装后的 `node_modules` 结构；
2. 按 `dsh-better-sidebar` 等已安装插件的做法，在 `peerDependencies` 中声明 `@deepseek-ai/dsh-tools` 等核心包；
3. 仍失败时，检查 DSH 版本是否满足 peer 范围；
4. 不采用复制 DSH 核心包进 bundle 的方式。

### 5.6 验收

- `plugin_manager` 安装本地 bundle 成功，插件在 DSH 中显示名称/描述/图标。
- 无配置错误；DSH 启动日志无未捕获异常。
- 临时占位工具能在工具列表中出现。
- `ctx.skills.register` 注册的测试 Skill 能在 Skill 列表看到。

## 6. M2：二进制管理

### 6.1 目标

实现“给定 OS/架构，自动安装官方 `unc` 并返回可执行路径”的完整闭环。

### 6.2 文件与接口

```text
lib/
├── platform.js
├── release.js
├── download.js
├── archive.js
└── binary-manager.js
assets/
└── pinned-manifest.json
```

固定接口：

```js
// platform.js
export function detectPlatform(platform = process.platform, arch = process.arch)
// -> { os, arch, platformName, archiveName, binaryName, isZip }

// release.js
export async function resolveRelease({ versionPolicy, pinnedVersion, downloadBase, signal })
// -> { version, tag, assets, checksumsUrl, source: 'latest' | 'pinned' }

// download.js
export async function downloadVerified({ url, checksumsUrl, assetName, destDir, maxBytes, signal })
// -> { filePath, sha256, size }

// archive.js
export async function extractArchive({ archivePath, destDir, platform, signal })
// -> { binaryPath, skillDir }

// binary-manager.js
export async function ensureInstalled({ dataDir, config, signal })
// -> { version, platform, binaryPath, sha256, installedAt }

export async function getStatus({ dataDir })
// -> { currentVersion, platform, binaryPath, cacheSizeBytes, latestVersion? }

export async function update({ dataDir, config, signal })
// -> { fromVersion, toVersion, binaryPath }
```

### 6.3 任务

| 编号 | 任务 | 细节 |
|---|---|---|
| M2-1 | `platform.js` | 六个平台映射；其他平台抛 `UNSUPPORTED_PLATFORM` |
| M2-2 | `pinned-manifest.json` | v0.1.61 + 六平台 SHA-256；与 `DESIGN.md` 校验表一致 |
| M2-3 | `release.js` | 请求 latest API；校验 `version`/`assets`；24h 缓存；失败回退 pinned |
| M2-4 | `download.js` | `fetch` + `AbortSignal`；最大 128 MiB；流式 SHA-256；重定向只允许 HTTPS |
| M2-5 | `archive.js` | `tar` 解 `.tar.gz`，`yauzl` 解 `.zip`；白名单和路径穿越校验 |
| M2-6 | `binary-manager.js` | 临时目录、原子 rename、`current.json`、锁文件、旧版本清理 |
| M2-7 | 单元测试 | `platform` 六平台 + 三个不支持；checksum 解析；损坏包 |
| M2-8 | 真实网络测试 | macOS arm64、Linux amd64 至少各一次 |

### 6.4 安装流程

1. `detectPlatform()`。
2. `resolveRelease()`（latest 或 pinned）。
3. 若有 `current.json` 且版本匹配、文件存在、`unc version` 正常 → 直接复用。
4. 否则创建 `cache/<version>/` 和 `versions/<version>/<platform>.tmp/`。
5. 下载资产 + `checksums.txt`，校验 SHA-256。
6. 解压，只保留 `unc`/`unc.exe` 与 `skills/**`。
7. 执行 `unc version --format json` 验证版本。
8. `rename` 到正式目录，写 `current.json`。
9. 返回 `binaryPath`。

### 6.5 验收

- 在 macOS arm64 和 Linux amd64 上首次下载成功；`unc version --format json` 返回目标版本。
- 故意改坏一个字节的校验值，安装被拒绝，旧版本仍可用。
- 删除缓存后再次调用可重新安装。
- 并发 5 个 `ensureInstalled()` 只产生一次下载。
- Windows 至少验证 `detectPlatform()` 和 zip 解压（真机或 CI）。

## 7. M3：工具、执行器与策略

### 7.1 文件与接口

```text
lib/
├── unc-runner.js
├── policy.js
└── tools/
    ├── ugreen-nas.js
    └── ugreen-nas-setup.js
```

固定接口：

```js
// unc-runner.js
export async function runUnc({ binaryPath, argv, timeoutMs, maxOutputBytes, signal, env })
// -> { ok, exitCode, data?, stdout, stderr, truncated, durationMs }

// policy.js
export function classifyCommand(argv)
// -> { group, action, risk: 'read'|'write'|'destructive', allowed, reason }
```

### 7.2 `ugreen_nas` 工具

- 参数：`argv`、`timeoutMs`、`maxOutputBytes`、`dryRun`、`confirm`。
- 执行前跑 `classifyCommand`；`allowed: false` 返回 `COMMAND_NOT_ALLOWED`。
- `risk: 'destructive'` 且 `confirm !== true` 返回 `CONFIRMATION_REQUIRED`。
- `dryRun: true` 追加 `--dry-run`；不把 `--yes` 自动加入。
- 捕获 `spawn` 错误、超时、取消、非零退出，全部归一化。
- `render()` 先格式化 `data`，再给 `stdout`/`stderr`；大输出截断。

### 7.3 `ugreen_nas_setup` 工具

- `status`：不触发下载，只读 `current.json` 和版本目录。
- `install`：调用 `ensureInstalled()`；`version` 可指定 pinned 版本。
- `update`：调用 `update()`；成功后清理旧版本。
- 安装失败返回 `DOWNLOAD_FAILED` / `CHECKSUM_MISMATCH` / `ARCHIVE_INVALID`。

### 7.4 任务

| 编号 | 任务 | 细节 |
|---|---|---|
| M3-1 | `unc-runner.js` | `spawn` 绝对路径；不经过 shell；stdout/stderr 限制 |
| M3-2 | 超时与取消 | `AbortSignal`、`SIGTERM` → `SIGKILL`；Windows `taskkill /T /F` |
| M3-3 | `policy.js` | 分组白名单、危险命令识别、`plugin/skill/uninstall/upgrade` 拦截 |
| M3-4 | `ugreen_nas` | schema、execute、render、错误码 |
| M3-5 | `ugreen_nas_setup` | status/install/update；调用 BinaryManager |
| M3-6 | 单元测试 | 假 `unc` 脚本：JSON、非 JSON、非零退出、超时、输出截断 |
| M3-7 | 策略测试 | 允许 `file ls`；拒绝 `file rm --yes`；拒绝 `plugin install`；`auth export` 拒绝 |
| M3-8 | 手工验证 | `ugreen_nas` 执行 `version`；`ugreen_nas_setup status` |

### 7.5 验收

- `ugreen_nas { argv: ["version"] }` 返回 `version` 0.1.61。
- `ugreen_nas { argv: ["plugin","install"] }` 返回 `COMMAND_NOT_ALLOWED`。
- 带有删除/卸载语义的命令未 `confirm` 时返回 `CONFIRMATION_REQUIRED`。
- 超时 5 秒的假命令被终止，返回 `TIMEOUT`。
- 10 MiB 输出被截断，不把完整内容塞入上下文。

## 8. M4：认证与 Skill

### 8.1 文件与接口

```text
lib/
├── auth-manager.js
└── tools/
    └── ugreen-nas-auth.js
skills/ugreen-nas/
├── SKILL.md
└── references/
    ├── file.md
    ├── docker.md
    ├── download.md
    ├── storage.md
    ├── app.md
    ├── search.md
    ├── ctl.md
    ├── network.md
    └── taskmgr.md
```

固定接口：

```js
// auth-manager.js
export function createAuthManager({ binaryManager, logger })
// -> {
//      start(options): Promise<{ sessionId, url, state: 'pending' }>,
//      status(options): Promise<AuthStatus>,
//      cancel(sessionId): Promise<void>,
//      logout(options): Promise<UncResult>,
//      dispose(): Promise<void>
//    }
```

### 8.2 任务

| 编号 | 任务 | 细节 |
|---|---|---|
| M4-1 | `auth-manager.js` | `spawn` `unc auth workbuddy --wait-timeout 10m`；解析 `127.0.0.1` URL |
| M4-2 | 会话状态 | `pending/authenticated/expired/cancelled`；存内存，不落盘 token |
| M4-3 | `ugreen_nas_auth` | status/start/cancel/logout 四个 action |
| M4-4 | 超时与清理 | 10 分钟超时；`ctx.on('dispose')` 杀进程 |
| M4-5 | `SKILL.md` | 使用 `ugreen_nas`/`ugreen_nas_auth`，不直接调用 bash/unc |
| M4-6 | 命令参考 | 九个分组各一份简明参考，覆盖常用参数、只读/写属性 |
| M4-7 | 注册 | `ctx.skills.register({ name: 'ugreen-nas', description, content })` |
| M4-8 | 测试 | 假 auth 脚本输出 URL；超时；取消；status JSON |

### 8.3 Skill 验收

- DSH Skill 列表能看到 `ugreen-nas`。
- Skill 中不出现 `~/.unc/auth.json` 的读取指令。
- Skill 明确要求先 `status` 再执行业务命令。
- Skill 的示例与 `ugreen_nas` 参数 schema 一致（`argv` 数组）。
- 与官方 `ugreen-nas-cli` 同时存在时不冲突。

## 9. M5：集成与验收

### 9.1 测试矩阵

| 层级 | 用例 | 平台 | 期望 |
|---|---|---|---|
| 单元 | 平台映射六平台 | Node | 正确资产名 |
| 单元 | 不支持架构 | Node | `UNSUPPORTED_PLATFORM` |
| 单元 | semver 比较 | Node | pinned/latest 选择正确 |
| 单元 | checksum 解析 | Node | 正确匹配/缺失失败 |
| 单元 | tar 解压 | macOS/Linux | 提取 `unc` + skills |
| 单元 | zip 解压 | Windows/CI | 提取 `unc.exe` + skills |
| 单元 | zip-slip | Node | 拒绝 `../`、绝对路径 |
| 单元 | 下载超时/404/过大 | Node | 对应错误码 |
| 单元 | 运行器 JSON/非 JSON/非零/超时 | Node | 结构化结果 |
| 单元 | 命令策略 | Node | 允许/拒绝/确认 |
| 集成 | 首次安装 macOS arm64 | macOS | `unc version` 正常 |
| 集成 | 首次安装 Linux amd64 | Debian stable | `unc version` 正常 |
| 集成 | 缓存复用 | macOS/Linux | 不重复下载 |
| 集成 | 升级/回退 | macOS/Linux | 当前版本可恢复 |
| 集成 | 本地 bundle 安装 | 临时 DSH profile | 插件出现在列表 |
| 集成 | 工具调用 | DSH | `ugreen_nas_setup status` 正常 |
| 集成 | Skill 可见 | DSH | `ugreen-nas` 出现在 Skill 列表 |
| 手工 | Windows x64 冒烟 | Windows 11 | 安装/解压/运行/卸载 |
| 手工 | 真实 NAS 只读 | 用户 NAS | `storage`/`taskmgr`/`file ls` 正常 |
| 手工 | 真实 NAS 登录 | 用户 NAS | `ugreen_nas_auth start` 返回 URL，完成后 `status` true |

### 9.2 真实 NAS 测试边界

- 只做只读命令：`version`、`auth status`、`storage`、`taskmgr`、`file ls`、`search`。
- 不做删除、覆盖、卸载、重启、创建用户等写操作。
- 认证只使用用户自己的 NAS；不记录 token、不截图登录页、不导出 `auth.json`。

### 9.3 性能目标

| 项目 | 目标 |
|---|---|
| 已安装时的 `ugreen_nas_setup status` | < 200 ms（不含网络） |
| 已安装时的简单 `ugreen_nas` 调用开销 | < 100 ms |
| 首次安装（宽带） | 通常 < 60 秒；超时 10 分钟 |
| 下载包最大体积 | 128 MiB 限制 |
| 命令默认超时 | 60 秒；长任务可调至 30 分钟 |

### 9.4 安全验收

- 全代码检索确认没有 `exec`/`execSync`/`shell: true` 执行 `unc`。
- 所有下载 URL 必须 HTTPS；重定向不得跳到 HTTP 或非官方域。
- `checksums.txt` 缺失/无对应条目时安装失败。
- `current.json` 的路径被修改后，插件拒绝执行并重新安装。
- 日志不含 `--token` 值、`auth.json` 内容或完整环境变量。
- 所有插件数据位于 `$DSH_HOME/ugreen-nas`，可通过删除该目录完全清理。

## 10. 文件级实施清单

| 文件 | 作用 | 关键检查 |
|---|---|---|
| `package.json` | bundle 元数据、依赖、peerDependencies | `dsh.bundle.patch` 指向正确 |
| `cordis.patch.yml` | 插入 `ugreen-nas` 插件行 | YAML 合法、id 唯一 |
| `index.js` | 插件入口、注册与清理 | `apply()` 不阻塞；dispose 完整 |
| `lib/state.js` | 插件状态、配置、logger、dataDir | 不把状态放模块全局可变单例 |
| `lib/platform.js` | OS/架构映射 | 六平台 + 不支持错误 |
| `lib/release.js` | latest/pinned 解析 | API 失败回退、24h 缓存 |
| `lib/download.js` | 下载、限流、SHA-256 | 流式校验、超时、重定向 |
| `lib/archive.js` | tar.gz/zip 安全解压 | 白名单、路径穿越、符号链接 |
| `lib/binary-manager.js` | 安装、current、锁、回滚 | 原子 rename、旧版本保留 |
| `lib/unc-runner.js` | 子进程执行 | 无 shell、超时、输出上限 |
| `lib/policy.js` | 命令分类与白名单 | 禁止管理命令、破坏性确认 |
| `lib/auth-manager.js` | WorkBuddy 登录会话 | URL 回环、超时、清理 |
| `lib/tools/ugreen-nas.js` | 业务工具 | schema/execute/render 完整 |
| `lib/tools/ugreen-nas-auth.js` | 认证工具 | 不接收 token |
| `lib/tools/ugreen-nas-setup.js` | 安装/更新工具 | status 不触发下载 |
| `assets/pinned-manifest.json` | 固定版本清单 | 六平台哈希与官方一致 |
| `skills/ugreen-nas/SKILL.md` | DSH 适配 Skill | 不含 token 读取、示例准确 |
| `skills/ugreen-nas/references/*.md` | 分组参考 | 命令与 `unc` 版本匹配 |
| `locale/en.json` | 英文元数据 | `meta.title`/`meta.description` |
| `locale/zh.json` | 中文元数据 | 同上 |
| `README.md` | 详情页/用法 | 与当前实现一致 |
| `icon.svg` | 插件图标 | 简洁、无外部资源 |
| `docs/DETAIL.md` | 可选详情页 | 无远程资源、无脚本 |

## 11. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `unc` 闭源、安装包无许可证，商业再分发受限 | 高 | 高 | 默认内部使用；发布前做授权确认；不把二进制打进插件包，只从官方下载 |
| 官方版本 API 或资产路径变更 | 中 | 高 | pinned manifest 回退；`downloadBase` 可配置；错误信息给官方 URL |
| DSH 插件无法裸导入 `@deepseek-ai/dsh-tools` | 中 | 高 | M1 先行验证；按第三方插件 peerDependencies 模式处理 |
| Windows zip/杀毒软件拦截 | 中 | 中 | 使用纯 JS `yauzl`；文档说明 SmartScreen/360 处理；M5 真机验证 |
| `unc auth workbuddy` 输出格式变化 | 中 | 中 | 解析失败时回退 `auth status` 提示；支持手工 `unc auth login` |
| 命令白名单漏掉合法命令 | 中 | 中 | 以 `unc` 版本化命令表生成白名单；测试覆盖九个分组 |
| 破坏性命令误执行 | 低-中 | 高 | 默认不 `--yes`；dry-run；confirm；真实 NAS 测试只读 |
| 大输出撑爆上下文 | 中 | 中 | 默认 1 MiB 截断；提示用户用筛选/输出文件 |
| DSH 版本升级导致 API 变化 | 中 | 中 | peer 范围 + M1/M5 兼容测试；关注 DSH 发布说明 |
| 多个插件同名 Skill 冲突 | 低 | 低 | 注册名 `ugreen-nas`，避开官方 `ugreen-nas-cli` |
| 下载源被墙/代理不可用 | 中 | 中 | 支持 `downloadBase`/`HTTPS_PROXY`；pinned 包可离线放置 |

## 12. 发布与回滚

### 12.1 发布方式（未来）

- v0.1 用本地 bundle 目录，通过 DSH **Plugins** > **Add plugin** 或 `plugin_manager install_bundle` 安装。
- 不发布 npm 包；不写 DSH 市场。
- 安装前在临时 profile 验证；不直接改 `desktop` profile。

### 12.2 回滚

1. 在 DSH 插件管理器禁用/移除 `dsh-ugreen-nas`。
2. 如需恢复旧二进制，读取 `$DSH_HOME/ugreen-nas/current.json` 的 `previousVersion`，切换回去。
3. 完全清理：删除 `$DSH_HOME/ugreen-nas`，不会影响 `~/.unc` 登录态或用户其他数据。
4. 不修改 profile 的 `package.json`/`cordis.patch.yml`；回滚由插件管理器负责。

### 12.3 升级

- 二进制升级：`ugreen_nas_setup update`。
- 插件升级：重新安装本地 bundle 新版本；保留 `$DSH_HOME/ugreen-nas` 缓存。
- 不在后台自动更新；不静默替换二进制。

## 13. 开放问题

| 问题 | 影响 | 处理 |
|---|---|---|
| DSH Host-only bundle 在 Web/Server 模式下的 `DSH_HOME` 是否总是存在 | 中 | M1 检查环境变量；回退 `~/.dsh` |
| `@deepseek-ai/dsh-tools` 在本地 bundle 的解析方式 | 高 | M1 兼容性验证，必要时 peerDependencies |
| 官方 `unc` Skill 的许可证是否允许随插件分发 | 中 | 默认不整份复制；只使用自编适配 Skill |
| Windows ARM64 是否在目标 DSH 发行版中可用 | 低 | 资产存在；M5 可选真机验证 |
| `unc auth workbuddy` 的 URL 输出是否稳定可解析 | 中 | M4 用真实输出测试；失败时提示手工登录 |
| 官方版本 API 是否有速率限制 | 低 | 24h 缓存 + 失败回退；不在每次调用时请求 |

## 14. 后续工作（不在本次范围）

- 实现 M1–M5。
- 在临时 DSH profile 安装本地 bundle。
- 在 macOS arm64、Linux amd64、Windows x64 上做安装/运行验证。
- 用真实绿联 NAS 做只读命令测试和登录流程测试。
- 评审 `unc` 再分发授权后再决定是否公开发布。

## 15. 附：最小验收清单

- [ ] `README.md`、`DESIGN.md`、`IMPLEMENTATION_PLAN.md` 三份文档存在且互链。
- [ ] 文档明确“绿联云是 CLI 型连接器，不是 MCP”。
- [ ] 文档明确 `unc` 六平台资产和 Linux amd64 静态 ELF 结论。
- [ ] 文档明确 DSH Host-only bundle 方案和三个工具。
- [ ] 文档明确 `ugreen_nas` 的 `argv` 格式、错误码和安全边界。
- [ ] 文档明确 M1–M5 的文件、测试和验收。
- [ ] 文档没有声称插件已实现或已安装。
