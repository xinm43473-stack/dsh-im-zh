import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqStateStore } from '../../../src/channels/qq/state-store.mjs';
import { setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';

const key = 'c2c:owner';
const quiet = { warn() {}, error() {} };

// The menu needs a workspace/session catalog to render, so the fixture mirrors
// the one the menu suite uses instead of stubbing the view away.
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'qq-chinese-command-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const other = join(dir, 'other');
  await mkdir(other);
  const state = await new QqStateStore(join(dir, 'state.json')).load();
  await state.setSession(key, 'session-original');
  let workspace = dir;
  let selected = { provider: 'provider', model: 'model-1' };
  const asks = [];
  const sent = [];
  const catalog = () => ({
    current: selected,
    routable: true,
    failures: [],
    groups: [{ id: 'provider', name: '模型提供方', models: [{ id: 'model-1', name: '模型 1' }] }],
  });
  const harness = {
    currentWorkspace: () => workspace,
    ensureRunning: async () => {},
    listWorkspaces: async () => [workspace, other],
    listWorkspaceSessions: async () => ({ sessions: [{ sessionId: 'session-original', title: '原会话' }] }),
    sessionExists: async () => true,
    createSession: async () => 'session-new',
    ask: async (sessionId, text) => { asks.push({ sessionId, text }); return '测试回复'; },
    listModels: async () => catalog(),
    agentPresetSettings: async () => ({ agentPreset: null, agentPresetCatalog: { defaultId: 'standard', items: [] } }),
    workspaceSession: (sessionId) => ({
      ask: (text, options) => harness.ask(sessionId, text, options),
      sessionExists: async () => true,
      models: async () => catalog(),
      isRunning: async () => false,
      hasActiveTurn: async () => false,
    }),
  };
  const bot = {
    sendText: async (target, text) => { sent.push({ target, text }); return { id: `reply-${sent.length}` }; },
    send: async (args) => {
      sent.push({ ...args, text: args.markdown?.content ?? args.content });
      return { id: `reply-${sent.length}` };
    },
  };
  const bridge = new QqHarnessBridge({ bot, ownerUserOpenid: '*', harness, state, logger: quiet });
  let sequence = 0;
  return {
    state,
    asks,
    sent,
    send: async (content, overrides = {}) => {
      const messageId = `message-${++sequence}`;
      await bridge.accept({
        kind: 'c2c',
        rawEventType: 'C2C_MESSAGE_CREATE',
        senderId: 'owner',
        senderIsBot: false,
        messageId,
        content,
        replyTarget: { scope: 'c2c', targetId: 'owner', msgId: messageId },
        ...overrides,
      });
    },
    latestMenu: () => sent.findLast((entry) => entry.keyboard),
  };
}

test('QQ accepts Chinese /帮助 and appends the Chinese command hint once', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/帮助');

  const help = f.sent.at(-1).text;
  assert.match(help, /\/help/);
  assert.match(help, /中文命令同样可用：/);
  assert.match(help, /\/帮助/);
  assert.equal((help.match(/中文命令同样可用：/gu) ?? []).length, 1);
  assert.equal(f.asks.length, 0);
});

test('QQ treats Chinese /新对话 exactly like /new', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/新对话');

  assert.equal(f.state.sessionFor(key), null);
  assert.match(f.sent.at(-1).text, /已开启新会话/);
  assert.equal(f.asks.length, 0);
});

test('QQ treats Chinese /状态 exactly like /status', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/状态');

  assert.match(f.sent.at(-1).text, /连接正常/);
  assert.equal(f.asks.length, 0);
});

test('QQ treats Chinese /菜单 exactly like /m', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/菜单');

  const menu = f.latestMenu();
  assert.ok(menu, 'expected a keyboard menu reply');
  assert.match(menu.text, /菜单/);
  assert.equal(f.asks.length, 0);
});

test('QQ treats Chinese /版本 exactly like /version', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/版本');

  assert.match(f.sent.at(-1).text, /dsh-im v\d+\.\d+\.\d+/);
  assert.equal(f.asks.length, 0);
});

test('QQ does not read /帮助我 as the help command', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/帮助我');

  assert.equal(f.asks.length, 1);
  assert.equal(f.asks[0].text, '/帮助我');
  assert.equal(f.sent.some((entry) => /\/help/.test(entry.text ?? '') && !entry.keyboard), false);
});

test('QQ omits the Chinese hint when the interface language is not zh', async (t) => {
  setImHostLanguage('en');
  t.after(() => setImHostLanguage('zh'));
  const f = await fixture(t);

  await f.send('/help');

  assert.equal(f.sent.at(-1).text.includes('中文命令同样可用'), false);
  assert.equal(f.asks.length, 0);
});