# 在另一台电脑上安装 dsh-network-config

给 DeepSeek Harness 加一个**设置 → 网络**分区：跟随系统代理 / 直连 / 自定义代理。

整个插件不依赖任何第三方 npm 包，只用 Node 内置模块 + Harness 自带的 `undici`，
所以**拷过去就能用**，不需要联网安装依赖。

---

## 一、准备

目标机器需要：

| 要求 | 说明 |
|---|---|
| DeepSeek Harness 桌面版 | 已安装并**至少启动过一次**（这样它才会建好自己的 profile 目录） |
| Windows | 「跟随系统」模式读的是 Windows 注册表；其它系统上插件能装、能用直连/自定义，但跟随系统会退回读环境变量 |
| PowerShell | 系统自带即可，不需要 PowerShell 7 |

把 `dsh-network-config-1.0.0.zip` 拷到目标机器，解压到任意位置（例如 `D:\dsh-network-config`）。

## 二、安装

在解压出来的文件夹里打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会依次做四件事：

1. 找到 profile 目录（默认 `%USERPROFILE%\.dsh\profiles\desktop`，也认 `DSH_HOME`）
2. 把插件复制进 `<profile>\node_modules\dsh-network-config`
3. 把 `dsh-network-config` 加进该 profile 的 `dsh.profile.bundles` 列表（改前自动备份 `package.json.bak-dsh-network-config`）
4. 校验文件齐全、入口能通过语法检查

看到 `Done.` 就是装好了。

### 常用参数

```powershell
# 装到别的 profile（脚本会列出有哪些可用）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web

# 直接指定 profile 目录
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProfileDir "D:\somewhere\profiles\desktop"

# 只复制文件，不动 bundles 列表
powershell -ExecutionPolicy Bypass -File .\install.ps1 -NoRegister

# 卸载
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

## 三、重启应用（必须）

**完全退出 DeepSeek Harness，再重新打开。**

Harness 的模块图是在启动时构建的：正在运行的进程不会加载新装的插件。重启后：

* 设置面板左侧会多出一项「**网络**」
* 插件在启动时就按存档的模式安装好出站策略

## 四、验证

重启后，在同一个文件夹执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1
```

它会问插件自己的 host 路由，报告当前模式和实际生效的路由，然后测两个地址：

```
1. Is the plugin mounted at http://127.0.0.1:19387 ?     YES
2. What is configured / in effect
   mode          : system
   route         : http://127.0.0.1:7890/
   bypass entries: 21
   private direct: True
   full matcher  : True
3. Reach a public address (must use the proxy) : https://www.deepseek.com/
   reachable - HTTP 200 in 163 ms
```

想顺便验证内网直连，加一个你自己的内网地址：

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1 -Lan "http://192.168.1.10:8080"
```

内网地址应该是**几十毫秒内**返回；如果卡了几秒才失败，说明它走了代理。

---

## 手册（不想跑脚本的话）

改成三步手动操作，效果一样：

1. 把 `package.json`、`cordis.patch.yml`、`lib\`、`client\` 复制到
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-network-config\`
2. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，在
   `dsh.profile.bundles` 数组末尾加一行 `"dsh-network-config"`
3. 重启应用

`cordis.patch.yml` 里的 `- insert:` 会让 Harness 把这个插件挂进 profile 的层栈，
所以**只需要这个包名出现在 `bundles` 里**，不需要写进 `dependencies`。

---

## 为什么必须复制进 profile，不能做软链接

DSH 的 profile 解析器只为**位于 `%USERPROFILE%\.dsh\profiles` 之下**的模块路由
`@deepseek-ai/*` 这些 Harness 自身的包。如果插件目录是个指回别处（比如工作区）的
junction/symlink，解析出来的真实路径在 profiles 树之外，`@deepseek-ai/dsh-http-proxy`
就导入失败——插件能挂上、设置页能打开，但策略装不上。

所以安装 = **真实复制**。插件很小（约 60 KB），没有第三方依赖，复制是安全的。

---

## 迁移配置（可选）

插件自己的设置存在 `%USERPROFILE%\.dsh\network-config.json`：

```json
{
  "version": 1,
  "mode": "system",
  "custom": { "proxy": "", "bypass": "" }
}
```

想在新机器上沿用同样的选择，把这个文件一起拷过去即可。不拷也没关系——默认是「跟随系统」。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

然后重启应用。插件在 profile 里只占 `node_modules\dsh-network-config` 一个目录和
`bundles` 里的一行；它不在别处留任何东西，唯一的数据文件就是上面那个
`network-config.json`（卸载不会删它，要删请手动删）。

---

## 常见问题

**设置里没有「网络」这一项。**
没重启，或者重启得不彻底。检查 `%USERPROFILE%\.dsh\profiles\desktop\package.json`
的 `dsh.profile.bundles` 里有没有 `dsh-network-config`。

**页面在，但「当前生效」显示「尚未安装」。**
看页面上的红色错误文字。通常是 `@deepseek-ai/dsh-http-proxy` 导入失败——说明插件目录
不是复制进去的，而是被链接进去的，或者 Harness 版本过旧（该包自 DSH 0.2.0 起随附）。

**探针显示「完整绕过匹配未安装」。**
插件没能在 profile 内解析到 `undici`，已退回 Harness 自带的 dispatcher。退路可用，
但 `192.168.*` 这类系统绕过写法与内网直连不再生效。

**内网地址要走代理。**
确认目标地址属于这些范围——回环、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、
`100.64/10`（运营商级 NAT，Tailscale 也在这里）。这些插件一律直连，不需要额外配置。
其它地址要么在「不走代理的地址」里逐个写，要么用自定义模式的绕过列表。

**和别的代理插件冲突。**
谁最后调用 `setGlobalDispatcher` 谁说了算。装了 `dsh-clash-proxy` 之类的插件时，两者不能同时启用。
