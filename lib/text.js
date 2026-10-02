/** The three mode values the settings page can submit. */
export const MODES = ['system', 'direct', 'custom']

/** Diagnostic reported when the harness transport package cannot be loaded. */
export const TRANSPORT_MISSING
  = '\u627e\u4e0d\u5230 @deepseek-ai/dsh-http-proxy\uff0c\u7f51\u7edc\u6a21\u5f0f\u65e0\u6cd5\u751f\u6548\uff1b\u8bf7\u786e\u8ba4 Harness \u7248\u672c\u5305\u542b\u8be5\u5305\u3002'

/** Human-readable reason for each submitted-document rejection. */
export const REJECTION_TEXT = {
  'custom mode needs an http:// or https:// proxy URL':
    '\u81ea\u5b9a\u4e49\u6a21\u5f0f\u9700\u8981\u4e00\u4e2a http:// \u6216 https:// \u4ee3\u7406\u5730\u5740\u3002',
  'mode must be one of system, direct, custom':
    '\u4ee3\u7406\u6a21\u5f0f\u5fc5\u987b\u662f system\u3001direct \u6216 custom \u4e4b\u4e00\u3002',
}

/** Diagnostic reported when a read of the registry failed and the environment was used. */
export const REGISTRY_FALLBACK_TEXT
  = '\u8bfb\u53d6 Windows \u7cfb\u7edf\u4ee3\u7406\u5931\u8d25\uff0c\u5df2\u6539\u7528\u73af\u5883\u53d8\u91cf\u3002'
