// Chinese command aliases for the IM bot.
//
// A user types `/帮助` or `/新对话`; every command runner downstream still sees
// the canonical `/help` and `/new`. Normalizing at the edge — one call per
// channel entry point — keeps the alias table in a single place instead of
// teaching a dozen `isXxxCommand()` regexes a second spelling.
//
// The table is also the source for the `/help` hint: a command's aliases are
// shown next to its usage line when the interface language is Chinese, so the
// feature is discoverable without reading the docs.
//
// Aliases are matched as a whole command token: `/帮助我` is ordinary text, not
// `/help` followed by an argument, and `/取消订阅` resolves to `/unwatch`
// rather than to `/cancel`. A `@bot` mention suffix stays where it is, because
// group channels append one to the command itself (`/help@my_bot`).

// Command name -> Chinese aliases. Order matters only for the help hint (the
// first alias is the one shown); no alias may appear under two commands, and
// `findDuplicateLocalizedAliases()` (used by the tests) enforces that.
const ALIAS_GROUPS = Object.freeze({
  // Shared catalog commands (see command-catalog.mjs).
  new: Object.freeze(['新对话', '新会话', '新建对话', '新建会话']),
  compact: Object.freeze(['压缩', '压缩上下文', '整理上下文']),
  clear: Object.freeze(['清空', '清空上下文', '清除上下文']),
  history: Object.freeze(['历史', '历史消息', '聊天记录']),
  workspace: Object.freeze(['工作区', '切换工作区', '空间']),
  conv: Object.freeze(['对话', '对话工作区', '会话工作区']),
  workspacelist: Object.freeze(['工作区列表', '列出工作区']),
  sessionlist: Object.freeze(['会话列表', '列出会话']),
  session: Object.freeze(['会话', '绑定会话']),
  models: Object.freeze(['模型列表', '列出模型', '所有模型']),
  reasoninglist: Object.freeze(['推理列表', '推理等级列表']),
  reasoning: Object.freeze(['推理', '推理等级']),
  model: Object.freeze(['模型', '切换模型']),
  presetlist: Object.freeze(['预设列表', '列出预设']),
  preset: Object.freeze(['预设', '切换预设']),
  stop: Object.freeze(['停止', '中断', '终止']),
  steer: Object.freeze(['纠偏', '纠正', '补充指令']),
  batch: Object.freeze(['批量', '批量输入']),
  send: Object.freeze(['发送', '提交']),
  cancel: Object.freeze(['取消']),
  status: Object.freeze(['状态', '连接状态']),
  version: Object.freeze(['版本', '版本号']),
  help: Object.freeze(['帮助', '帮助信息', '使用说明']),
  // Channel-local commands. Each one is only ever offered by the channels that
  // implemented it (`/m` menus on Feishu/WeCom/QQ, `/repair` and the watch
  // family on Feishu), but a shared table keeps the spelling identical.
  m: Object.freeze(['菜单']),
  repair: Object.freeze(['修复']),
  watch: Object.freeze(['订阅']),
  unwatch: Object.freeze(['取消订阅']),
  watchlist: Object.freeze(['订阅列表']),
  archived: Object.freeze(['归档', '已归档']),
  permission: Object.freeze(['权限']),
});

const ALIASES_BY_COMMAND = new Map(
  Object.entries(ALIAS_GROUPS).map(([command, aliases]) => [command, aliases]),
);

const COMMAND_BY_ALIAS = new Map();
for (const [command, aliases] of ALIASES_BY_COMMAND) {
  for (const alias of aliases) {
    // First definition wins; findDuplicateLocalizedAliases() reports a clash so
    // a duplicated alias is a test failure, never a silent behavior change.
    if (!COMMAND_BY_ALIAS.has(alias)) COMMAND_BY_ALIAS.set(alias, command);
  }
}

// `/token`, an optional `@mention` suffix, then everything else untouched
// (arguments keep their own whitespace).
const SLASH_COMMAND = /^\/([^\s/@]+)(@[^\s/@]*)?([\s\S]*)$/u;

/**
 * Rewrite one Chinese command alias to its canonical English command, keeping
 * any arguments and any `@bot` suffix byte-identical. Anything that is not a
 * `/`-prefixed alias token comes back unchanged, so ordinary chat — including
 * Chinese text that happens to start with a slash — passes through untouched.
 *
 * @param {string} text inbound control text
 * @returns {string} the normalized text (the same string when nothing matched)
 */
export function normalizeCommandText(text) {
  if (typeof text !== 'string') return text;
  const match = SLASH_COMMAND.exec(text);
  if (!match) return text;
  const command = COMMAND_BY_ALIAS.get(match[1]);
  if (!command) return text;
  return `/${command}${match[2] ?? ''}${match[3] ?? ''}`;
}

/**
 * Chinese aliases defined for one canonical command name, in the order the
 * help hint should try them. Unknown or alias-less commands return `[]`.
 *
 * @param {string} command canonical command name, e.g. `help`
 * @returns {readonly string[]}
 */
export function localizedAliasesFor(command) {
  return ALIASES_BY_COMMAND.get(command) ?? [];
}

/**
 * The `/`-prefixed aliases of one command, ready to print.
 *
 * @param {string} command canonical command name, e.g. `help`
 * @returns {string[]}
 */
export function localizedCommandForms(command) {
  return localizedAliasesFor(command).map((alias) => `/${alias}`);
}

/**
 * Every alias→command pair, for tests and diagnostics. Frozen so a consumer
 * cannot accidentally edit the shared table.
 *
 * @returns {ReadonlyArray<readonly [string, string]>} `[alias, command]` pairs
 */
export function localizedCommandAliasEntries() {
  return Object.freeze([...COMMAND_BY_ALIAS.entries()]);
}

/**
 * A duplicate alias would make one of the two commands unreachable by its
 * Chinese name; the shared test fails on it instead of letting the first
 * definition quietly win in production.
 *
 * @returns {string[]} the aliases defined under more than one command
 */
export function findDuplicateLocalizedAliases() {
  const seen = new Map();
  const duplicates = new Set();
  for (const [command, aliases] of ALIASES_BY_COMMAND) {
    for (const alias of aliases) {
      const owner = seen.get(alias);
      if (owner !== undefined && owner !== command) duplicates.add(alias);
      else seen.set(alias, command);
    }
  }
  return [...duplicates];
}