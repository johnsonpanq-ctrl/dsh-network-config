window.__ModuleLoader__.load({
	id: "dsh-network-config",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		/** Route prefix owned by the host half. */
		const ROUTE = "/dsh-network-config";

		/** Simplified Chinese copy. */
		const ZH = {
			nav: "网络",
			loading: "正在读取网络配置…",
			retry: "重试",
			loadFailed: "无法读取网络配置。",
			description: "选择 DeepSeek Harness 访问外网的方式。这里改的是整个进程的出站路由：模型、网页搜索、网页抓取与 HTTP MCP 都走它。",
			modeLabel: "代理模式",
			modeSystem: "跟随系统",
			modeDirect: "直连",
			modeCustom: "自定义",
			hintSystem: "读取 Windows 的 Internet 选项（系统代理），并跟随它的开关。改完代理软件后回来重开一次设置面板即可刷新。",
			hintDirect: "不使用任何代理，所有请求直接连接。",
			hintCustom: "手动指定一个 http:// 或 https:// 代理地址。",
			proxy: "代理地址",
			proxyHint: "例如 http://127.0.0.1:7890；可带用户名密码 http://user:pass@host:port。SOCKS 与 PAC 暂不支持。",
			bypass: "不走代理的地址",
			bypassHint: "逗号分隔。支持域名与子域（example.com 也匹配 api.example.com）、192.168.* 这类通配、10.0.0.0/8 这类网段，以及 <local>。留空表示只用下面的自动规则。",
			privateDirect: "内网直连",
			privateDirectValue: "本机、局域网、链路本地与运营商级 NAT 地址始终不走代理（转发代理到不了它们）",
			invalidProxy: "请填写合法的 http:// 或 https:// 代理地址。",
			sectionCurrent: "当前生效",
			sectionSystem: "系统代理",
			sectionDiagnostics: "提示",
			systemEnabled: "已启用",
			systemDisabled: "未启用（系统设置为直连）",
			systemUnavailable: "读取失败，已回退到环境变量",
			systemSkipped: "不适用（当前不是跟随系统模式）",
			pacDetected: "系统配置了 PAC 自动配置脚本",
			routeDirect: "直连",
			routeUnknown: "尚未安装",
			routeNoProxy: "不使用代理",
			bypassValue: "绕过列表",
			saved: "已保存并立即生效",
			save: "保存",
			saving: "保存中…",
			saveFailed: "保存失败，请检查填写内容。",
			test: "测试连接",
			testing: "测试中…",
			testOk: "连接正常",
			testFail: "连接失败",
			unavailable: "该功能当前不可用。",
			readOnly: "本部署的设置为只读。",
		};

		/** English copy. */
		const EN = {
			nav: "Network",
			loading: "Reading network configuration…",
			retry: "Retry",
			loadFailed: "Could not read the network configuration.",
			description: "Choose how DeepSeek Harness reaches the network. This is the process-wide outbound route: models, web search, web fetch, and HTTP MCP all use it.",
			modeLabel: "Proxy mode",
			modeSystem: "Follow system",
			modeDirect: "Direct",
			modeCustom: "Custom",
			hintSystem: "Reads the Windows Internet Options proxy and follows its on/off switch. Reopen this panel after changing your proxy client to refresh it.",
			hintDirect: "No proxy: every request connects directly.",
			hintCustom: "Point at one http:// or https:// proxy of your own.",
			proxy: "Proxy URL",
			proxyHint: "For example http://127.0.0.1:7890, optionally with credentials: http://user:pass@host:port. SOCKS and PAC are not supported.",
			bypass: "Bypass list",
			bypassHint: "Comma separated. A host also matches its subdomains (example.com matches api.example.com); wildcards (192.168.*), CIDR (10.0.0.0/8) and <local> are supported. Leave blank to rely on the automatic rule below.",
			privateDirect: "Private stays direct",
			privateDirectValue: "Loopback, LAN, link-local and carrier-grade NAT addresses never go through the proxy (a forward proxy cannot reach them)",
			invalidProxy: "Enter a valid http:// or https:// proxy URL.",
			sectionCurrent: "In effect",
			sectionSystem: "System proxy",
			sectionDiagnostics: "Notes",
			systemEnabled: "Enabled",
			systemDisabled: "Disabled (the system is configured for direct)",
			systemUnavailable: "Unreadable; fell back to the environment",
			systemSkipped: "Not applicable (this is not follow-system mode)",
			pacDetected: "A PAC configuration script is set",
			routeDirect: "Direct",
			routeUnknown: "Not installed yet",
			routeNoProxy: "No proxy",
			bypassValue: "Bypass list",
			saved: "Saved and applied",
			save: "Save",
			saving: "Saving…",
			saveFailed: "Saving failed; check the values.",
			test: "Test connection",
			testing: "Testing…",
			testOk: "Reachable",
			testFail: "Unreachable",
			unavailable: "This feature is unavailable.",
			readOnly: "This deployment stores settings read-only.",
		};

		/**
		 * The copy for the browser's current interface language. The settings
		 * shell resolves a registration's label through this same function, so
		 * the nav row and the page agree without the plugin depending on the
		 * locale service (and therefore without being unable to mount when that
		 * service is absent).
		 * @returns the dictionary to render with.
		 */
		function texts() {
			const declared = typeof document !== "undefined" && document.documentElement
				? document.documentElement.getAttribute("lang")
				: null;
			const language = String(
				declared || (typeof navigator !== "undefined" && navigator.language) || "en",
			).toLowerCase();
			return language.startsWith("zh") ? ZH : EN;
		}

		/**
		 * Call one of the host half's routes.
		 * @param path - route suffix, e.g. "/state".
		 * @param init - fetch options.
		 * @returns the decoded `{ ok: true, ... }` payload.
		 */
		async function request(path, init) {
			const options = init || {};
			const response = await fetch(ROUTE + path, {
				method: options.method || "GET",
				headers: options.body === undefined
					? { accept: "application/json" }
					: { accept: "application/json", "content-type": "application/json" },
				body: options.body,
			});
			let payload;
			try {
				payload = await response.json();
			} catch {
				payload = undefined;
			}
			if (!response.ok || payload === undefined || payload.ok !== true) {
				const message = payload && payload.error && payload.error.message
					? payload.error.message
					: "HTTP " + response.status;
				throw new Error(message);
			}
			return payload;
		}

		/** Whether a value is a usable http(s) proxy URL. */
		function isProxyUrl(value) {
			if (typeof value !== "string" || value.trim() === "") return false;
			try {
				const parsed = new URL(value.trim());
				return parsed.protocol === "http:" || parsed.protocol === "https:";
			} catch {
				return false;
			}
		}

		/** Copy a stored document into an editable draft. */
		function draftOf(config) {
			return {
				mode: config.mode,
				custom: { proxy: config.custom.proxy, bypass: config.custom.bypass },
			};
		}

		/** Whether the draft differs from what is stored. */
		function isDirty(draft, config) {
			if (draft === null || config === null || draft === undefined || config === undefined) return false;
			return draft.mode !== config.mode
				|| draft.custom.proxy !== config.custom.proxy
				|| draft.custom.bypass !== config.custom.bypass;
		}

		/** The one-line description of what the host currently routes. */
		function routeText(t, applied) {
			if (applied === null || applied === undefined) return t.routeUnknown;
			return applied.direct ? t.routeDirect : applied.summary;
		}

		/** The one-line description of the operating system's proxy. */
		function systemText(t, system) {
			if (system === null || system === undefined) return t.systemSkipped;
			if (system.registryError !== undefined && system.registryError !== null) return t.systemUnavailable;
			if (!system.enabled) return t.systemDisabled;
			return t.systemEnabled + (system.server ? " · " + system.server : "");
		}

		/** The mode-specific explanatory line. */
		function modeHint(t, mode) {
			if (mode === "system") return t.hintSystem;
			return mode === "direct" ? t.hintDirect : t.hintCustom;
		}

		/** Shorthand for one inline style object. */
		const S = {
			description: { margin: "0 0 18px", color: "var(--dsw-alias-label-secondary)", fontSize: 13, lineHeight: "20px" },
			field: { marginBottom: 16 },
			fieldLabel: { display: "block", marginBottom: 8, color: "var(--dsw-alias-label-primary)", fontSize: 13, fontWeight: 500 },
			hint: { margin: "8px 0 0", color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" },
			panel: {
				marginTop: 4,
				padding: "12px 14px",
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: 12,
				background: "var(--dsw-alias-bg-layer-2)",
			},
			row: { display: "flex", gap: 8, fontSize: 12, lineHeight: "20px" },
			rowLabel: { flex: "0 0 84px", color: "var(--dsw-alias-label-secondary)" },
			rowValue: { flex: "1 1 auto", color: "var(--dsw-alias-label-primary)", wordBreak: "break-all" },
			list: { margin: "8px 0 0", paddingLeft: 18, color: "var(--dsw-alias-state-warn-primary)", fontSize: 12, lineHeight: "18px" },
			error: { margin: "8px 0 0", color: "var(--dsw-alias-state-error-primary)", fontSize: 12, lineHeight: "18px" },
			success: { margin: "8px 0 0", color: "var(--dsw-alias-state-success-primary)", fontSize: 12, lineHeight: "18px" },
			actions: { display: "flex", gap: 8, alignItems: "center", marginTop: 12 },
		};

		/**
		 * Render one state of the Settings → Network page.
		 *
		 * Split out of the component so the page's whole element tree is a pure
		 * function of a plain model: the hook wrapper below owns only the fetch,
		 * the draft, and the transitions.
		 *
		 * @param view - `{ t, phase, remote, draft, saving, failed, notice, probing, probe, actions }`.
		 * @returns the page element tree.
		 */
		function renderNetworkPage(view) {
			const t = view.t;
			if (view.phase === "loading") {
				return h("p", { style: S.description, role: "status" }, t.loading);
			}
			if (view.phase === "error" || view.remote === null || view.draft === null) {
				return h("div", null,
					h("p", { style: S.error, role: "status" },
						t.loadFailed + (view.notice ? " " + view.notice : "")),
					h("div", { style: S.actions },
						h(primitives.Button, { variant: "outline", size: "sm", onClick: view.actions.load }, t.retry)));
			}

			const remote = view.remote;
			const draft = view.draft;
			const applied = remote.applied;
			const invalid = draft.mode === "custom" && !isProxyUrl(draft.custom.proxy);
			const dirty = isDirty(draft, remote.config);

			const rows = [
				h("div", { style: S.row, key: "route" },
					h("span", { style: S.rowLabel }, t.sectionCurrent),
					h("span", { style: S.rowValue }, routeText(t, applied))),
			];

			if (draft.mode === "system") {
				rows.push(h("div", { style: S.row, key: "system" },
					h("span", { style: S.rowLabel }, t.sectionSystem),
					h("span", { style: S.rowValue }, systemText(t, remote.system))));
				if (remote.system !== null && remote.system !== undefined && remote.system.pac) {
					rows.push(h("div", { style: S.row, key: "pac" },
						h("span", { style: S.rowLabel }, ""),
						h("span", { style: S.rowValue }, t.pacDetected + " · " + remote.system.pac)));
				}
			}

			if (applied !== null && applied !== undefined && !applied.direct) {
				rows.push(h("div", { style: S.row, key: "noProxy" },
					h("span", { style: S.rowLabel }, t.bypassValue),
					h("span", { style: S.rowValue }, applied.noProxy ? applied.noProxy : t.routeNoProxy)));
				rows.push(h("div", { style: S.row, key: "private" },
					h("span", { style: S.rowLabel }, t.privateDirect),
					h("span", { style: S.rowValue }, t.privateDirectValue)));
			}

			const notes = (remote.diagnostics || []).slice();
			if (remote.lastError) notes.push(remote.lastError);

			const children = [
				h("p", { style: S.description, key: "description" }, t.description),
				h("div", { style: S.field, key: "mode" },
					h("span", { style: S.fieldLabel }, t.modeLabel),
					h(primitives.SegmentedControl, {
						id: "dsh-network-mode",
						label: t.modeLabel,
						value: draft.mode,
						disabled: view.saving,
						options: [
							{ value: "system", label: t.modeSystem },
							{ value: "direct", label: t.modeDirect },
							{ value: "custom", label: t.modeCustom },
						],
						onChange: (value) => view.actions.setMode(value),
					}),
					h("p", { style: S.hint }, modeHint(t, draft.mode))),
			];

			if (draft.mode === "custom") {
				children.push(h(primitives.SettingsValueField, {
					key: "proxy",
					id: "dsh-network-proxy",
					label: t.proxy,
					hint: t.proxyHint,
					invalid: invalid,
					invalidLabel: t.invalidProxy,
					overridden: false,
					overriddenLabel: "",
					resetLabel: "",
					text: draft.custom.proxy,
					disabled: view.saving,
					onEdit: (value) => view.actions.setCustom({ proxy: value }),
					onReset: () => view.actions.setCustom({ proxy: "" }),
				}));
				children.push(h(primitives.SettingsValueField, {
					key: "bypass",
					id: "dsh-network-bypass",
					label: t.bypass,
					hint: t.bypassHint,
					overridden: false,
					overriddenLabel: "",
					resetLabel: "",
					text: draft.custom.bypass,
					disabled: view.saving,
					onEdit: (value) => view.actions.setCustom({ bypass: value }),
					onReset: () => view.actions.setCustom({ bypass: "" }),
				}));
			}

			const probeText = view.probe === null
				? null
				: view.probe.ok
					? t.testOk + " · HTTP " + view.probe.status + " · " + view.probe.ms + " ms"
					: t.testFail + " · " + (view.probe.error || "");

			children.push(h("div", { style: S.panel, key: "status" },
				rows,
				notes.length > 0
					? h("ul", { style: S.list }, notes.map((note, index) => h("li", { key: index }, note)))
					: null,
				h("div", { style: S.actions },
					h(primitives.Button, {
						variant: "outline",
						size: "sm",
						onClick: view.actions.probe,
						disabled: view.probing,
					}, view.probing ? t.testing : t.test),
					probeText === null
						? null
						: h("span", { style: view.probe.ok ? S.success : S.error }, probeText)),
				view.notice === null
					? null
					: h("p", { style: view.failed ? S.error : S.success }, view.notice)));

			return h(primitives.SettingsForm, {
				labels: {
					unavailable: t.unavailable,
					readOnly: t.readOnly,
					saveFailed: t.saveFailed,
					save: t.save,
					saving: t.saving,
				},
				state: { available: true, writable: true, dirty, invalid, saving: view.saving, failed: view.failed },
				onSave: view.actions.save,
				onDiscard: view.actions.discard,
			}, children);
		}

		/**
		 * The Settings → Network page's stateful half: fetch, draft, transitions.
		 * @returns the rendered page.
		 */
		function NetworkSection() {
			const t = texts();
			const [phase, setPhase] = React.useState("loading");
			const [remote, setRemote] = React.useState(null);
			const [draft, setDraft] = React.useState(null);
			const [saving, setSaving] = React.useState(false);
			const [failed, setFailed] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const [probing, setProbing] = React.useState(false);
			const [probe, setProbe] = React.useState(null);

			const load = React.useCallback(() => {
				setPhase("loading");
				setNotice(null);
				setProbe(null);
				request("/state").then((payload) => {
					setRemote(payload.state);
					setDraft(draftOf(payload.state.config));
					setPhase("ready");
				}).catch((error) => {
					setNotice(String((error && error.message) || error));
					setPhase("error");
				});
			}, []);

			React.useEffect(() => {
				load();
			}, [load]);

			const actions = {
				load,
				setMode: (mode) => {
					setNotice(null);
					setFailed(false);
					setDraft((current) => (current === null ? current : Object.assign({}, current, { mode })));
				},
				setCustom: (patch) => {
					setNotice(null);
					setFailed(false);
					setDraft((current) => (current === null
						? current
						: Object.assign({}, current, { custom: Object.assign({}, current.custom, patch) })));
				},
				discard: () => {
					setFailed(false);
					setNotice(null);
					if (remote !== null) setDraft(draftOf(remote.config));
				},
				save: () => {
					if (draft === null || saving) return;
					setSaving(true);
					setFailed(false);
					setNotice(null);
					request("/state", { method: "POST", body: JSON.stringify(draft) }).then((payload) => {
						setRemote(payload.state);
						setDraft(draftOf(payload.state.config));
						setNotice(t.saved);
					}).catch((error) => {
						setFailed(true);
						setNotice(String((error && error.message) || error));
					}).finally(() => {
						setSaving(false);
					});
				},
				probe: () => {
					if (probing) return;
					setProbing(true);
					setProbe(null);
					request("/probe", { method: "POST", body: "{}" }).then((payload) => {
						setProbe(payload.result);
					}).catch((error) => {
						setProbe({ ok: false, error: String((error && error.message) || error) });
					}).finally(() => {
						setProbing(false);
					});
				},
			};

			return renderNetworkPage({
				t,
				phase,
				remote,
				draft,
				saving,
				failed,
				notice,
				probing,
				probe,
				actions,
			});
		}

		/** Required client services: the slot registry the page registers into. */
		const inject = ["slots"];

		/**
		 * Mount the Settings → Network page.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "network",
				order: 60,
				label: () => texts().nav,
			}, NetworkSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "dsh-network-config";		// Unit-test surface: the page's pure helpers and its pure renderer, so
		// the browser half can be exercised without a DOM or a React renderer.
		exports.__internals = { texts, isProxyUrl, draftOf, isDirty, routeText, systemText, modeHint, renderNetworkPage };
		return module.exports;
	},
});
