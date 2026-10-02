# dsh-network-config

**给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加一个「设置 → 网络」页面 —— 选择整个应用怎么访问外网，保存即生效。**

```
设置 → 网络
  ( ) 跟随系统      读取 Windows 系统代理，并跟随它的开关
  ( ) 直连          完全不用代理
  (•) 自定义        手填 http(s) 代理地址 + 绕过列表
```

不用重启，不用导出环境变量，不用改 YAML。点保存的那一刻，模型调用、网页搜索、网页抓取、HTTP MCP 就都换成新路由了。

> [English](README.md) | 中文

---

## 为什么做这个

DeepSeek Harness 只在**启动时读一次**出站代理策略，来源是 `http_proxy` / `https_proxy` /
`no_proxy` / `all_proxy` 这几个环境变量。于是有两个日常麻烦：

1. **必须先设好环境变量再启动应用**，代理一变就得重启。
2. **它根本不支持「跟随系统代理」** —— 上游有意不读操作系统的代理配置，所以你在代理软件里
   把开关拨了，仍然得自己去导出环境变量（这是[上游文档里写明的限制](https://github.com/deepseek-ai/deepseek-harness)）。

这个插件补上了这块界面。顺便，它还修了一个会悄悄弄坏内网访问的 bug —— 见下。

## 内建的直连规则（重点）

只要在走代理，下面这些目的地**永远直连**，不需要你配置任何东西：

| 类别 | 范围 |
|---|---|
| 回环 | `localhost`、`127.0.0.0/8`、`::1` |
| 私有网段（RFC 1918） | `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` |
| 链路本地 | `169.254.0.0/16`、`fe80::/10` |
| 运营商级 NAT | `100.64.0.0/10`（Tailscale 也在这里） |

转发代理是在**它自己的网络里**解析地址的，把内网目的地交给它，结果只会是超时或 502。
而 Harness 单独运行时只豁免回环，别的什么都不管。

操作系统写进绕过列表的条目也全部被尊重 —— 包括 Harness 自己的匹配器表达不了的那些写法：

| Windows 写的条目 | 含义 | 只有 Harness | 加上本插件 |
|---|---|---|---|
| `192.168.*` | 前缀通配 | ❌ 永远匹配不上 | ✅ |
| `10.0.0.0/8` | 网段（CIDR） | ❌ 永远匹配不上 | ✅ |
| `<local>` | 任何不带点的主机名 | ❌ 永远匹配不上 | ✅ |
| `*.corp.example` | 后缀 | ✅ | ✅ |
| `api.test:8443` | 带端口的主机 | ✅ | ✅ |

在真实机器上实测（系统代理已开启，内网地址直连约 20 ms）：

| 目标 | 只有 Harness | 加上本插件 |
|---|---|---|
| `http://100.68.18.63:7863/v1/models` | **HTTP 502 · 5175 ms** | **HTTP 401 · 22 ms** |
| `http://192.168.99.97:8080/v1/models` | 401 · 8 ms | 401 · 4 ms |
| `https://www.deepseek.com/` | 200 | 200 · 253 ms *(仍走代理 —— 正确)* |

## 安装

**环境要求：** DeepSeek Harness 桌面版（「跟随系统」模式需要 Windows；其它系统上插件照常可用，
但该模式会退回读环境变量），以及 PowerShell。

1. 从 [releases 页面](https://github.com/johnsonpanq-ctrl/dsh-network-config/releases) 下载
   `dsh-network-config-1.0.0.zip` —— 或者直接 clone 本仓库。
2. 解压到任意位置，在该文件夹里执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

3. **完全退出并重新打开 DeepSeek Harness。** 模块图是在启动时构建的，正在运行的进程
   不会加载新装的插件。

4. 验证：

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1
```

```
1. Is the plugin mounted at http://127.0.0.1:19387 ?   YES
2. mode: system   route: http://127.0.0.1:7890/
   bypass entries: 21   private direct: True   full matcher: True
3. Reach a public address (must use the proxy) : https://www.deepseek.com/
   reachable - HTTP 200 in 163 ms
```

完整步骤、手动安装做法、迁移到另一台机器、以及排错清单见 **[INSTALL.md](INSTALL.md)**。

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

然后重启应用。插件在 profile 里只占一个目录和 `dsh.profile.bundles` 里的一行；
它唯一的数据文件是 `%USERPROFILE%\.dsh\network-config.json`。

## 实现原理

插件不会从零自己造一套代理策略。它把解析好的模式交给 Harness 自己的
`@deepseek-ai/dsh-http-proxy`，于是 `proxyRouteFor()`、发布出去的环境变量、以及每个
子进程看到的仍然是同一个答案。

然后它把**真正承载流量的那个 dispatcher** 换成自己的逐 origin agent —— 因为那个包的
绕过匹配器只做「主机名相等或后缀相等」。两半都需要：官方包维持进程级的契约，插件的匹配器
负责实现那套契约表达不了的条目。

```
设置 → 网络                 (client/client.js)
     │  GET  /dsh-network-config/state
     │  POST /dsh-network-config/state   { mode, custom: { proxy, bypass } }
     ▼
host 半侧                   (lib/index.js)
     │  validate → store.save → resolvePolicy
     ├─ installProxyFromEnvironment   ← 官方策略：proxyRouteFor()、环境变量、子进程
     └─ installRouting(compileBypass) ← 真正承载流量的 dispatcher
     ▼
undici 全局 dispatcher + http_proxy / https_proxy / no_proxy
```

### 源码地图

| 文件 | 职责 |
|---|---|
| [`lib/index.js`](lib/index.js) | Host 半侧：设置文档、模式解析、安装传输策略、HTTP 路由 |
| [`lib/bypass.js`](lib/bypass.js) | 绕过匹配器：通配、CIDR、`<local>`、后缀、端口，以及内网判定 |
| [`lib/routing.js`](lib/routing.js) | 逐 origin 的 undici dispatcher，每个请求都问 `lib/bypass.js` 该去哪 |
| [`lib/system-proxy.js`](lib/system-proxy.js) | Windows 系统代理读取（`reg query` → 代理 URL + 绕过列表） |
| [`lib/policy.js`](lib/policy.js) | 三种模式 → 一份传输策略 |
| [`lib/store.js`](lib/store.js) | `network-config.json` 的校验与原子读写 |
| [`lib/text.js`](lib/text.js) | Host 半侧的中文提示文案 |
| [`client/client.js`](client/client.js) | 浏览器半侧：一个打包好的 `window.__ModuleLoader__` 模块，把页面注册进 `settings.section` |
| [`install.ps1`](install.ps1) / [`verify.ps1`](verify.ps1) | 安装器 / 重启后验证器 |
| [`build-package.ps1`](build-package.ps1) | 打可移植 zip |
| [`test/`](test) | 39 条单元测试 |

插件的 HTTP 路由和 Harness 自己的插件路由用了同一道围栏：`Host` 头必须是回环地址，
浏览器标为 `cross-site` 的请求一律拒绝。这是防 DNS rebinding，不是身份认证。

## 已知限制

- **不支持 SOCKS，也不支持 PAC。** 传输层只接受 `http(s)://` 代理 URL。系统配置了 PAC
  脚本（`AutoConfigURL`）时，插件会说明并按直连处理，而不是假装生效。
- **`proxyRouteFor()` 用的是官方包那套较窄的匹配器。** 因为官方策略是原样安装的，
  `dsh-web-fetch-http` 判断「这次抓取要不要走代理」时用的是它 —— 所以抓取一个**内网** URL
  仍可能走代理。公开网页抓取不受影响。真正承载流量的一侧（模型、搜索、MCP）走的是本插件的匹配器。
- **子进程只在 Node 22.21+/24+ 跟随策略。** 这是 `dsh-http-proxy` 的行为，由
  `NODE_USE_ENV_PROXY` 决定。在「直连」模式下插件会额外清掉 `all_proxy` / `ALL_PROXY`，
  避免子进程继续使用代理。
- **需要 profile 内可解析到 `undici`。** 取不到时插件会退回官方包的 dispatcher，并在页面上
  说明 —— 退路可用，但通配条目与内网直连不再生效。
- **和别的代理插件互斥。** 谁最后调用 `setGlobalDispatcher`，谁说了算；不要和
  `dsh-clash-proxy` 之类的插件同时启用。
- **系统代理只在 Windows 上读注册表**，其它平台退回环境变量。

## 开发

```powershell
npm test          # 等价于 node --test test/*.test.mjs
```

没有构建步骤，没有依赖。浏览器半侧是手写的 `window.__ModuleLoader__` bundle，
测试完全按客户端的方式装载它，然后断言页面的元素树 —— 所以不需要 DOM，也不需要 React 渲染器。

欢迎贡献 —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

MIT —— 见 [LICENSE](LICENSE)。

本项目与 DeepSeek 官方无关。「DeepSeek Harness」指被本插件扩展的上游应用。
