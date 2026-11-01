import assert from 'node:assert/strict';
import test from 'node:test';

import { DingtalkHarnessBridge } from '../../../src/channels/dingtalk/dingtalk-bridge.mjs';
import { setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';

const key = 'p2p:staff-approved';
const workspace = 'C:\\workspace';

function stateFixture() {
  const sessions = new Map([[key, 'session-original']]);
  const seen = new Set();
  const outbound = [];
  return {
    sessions,
    seen,
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => seen.add(id),
      rememberOutboundMessage: async (entry) => outbound.push(structuredClone(entry)),
      recentOutboundTextFor: () => null,
      sessionFor: (conversationKey) => sessions.get(conversationKey) ?? null,
      setSession: async (conversationKey, sessionId) => sessions.set(conversationKey, sessionId),
      clearSession: async (conversationKey) => sessions.delete(conversationKey),
      pendingSenders: () => [],
      recordPendingSender: async () => ({}),
      removePendingSenderByStaffId: async () => false,
    },
  };
}

function message(id, text) {
  return {
    msgId: id,
    msgtype: 'text',
    text: { content: text },
    conversationType: '1',
    conversationId: 'conversation-chinese-command',
    senderStaffId: 'staff-approved',
    senderNick: '钉钉用户',
    sessionWebhook: `https://oapi.dingtalk.com/robot/reply?ticket=${id}`,
  };
}

function bridgeFixture() {
  const fixture = stateFixture();
  const sent = [];
  const asks = [];
  const menus = [];
  const ensureRunning = [];
  const api = {
    sendText: async ({ text }) => { sent.push(text); return { messageId: `reply-${sent.length}` }; },
    createMenuCard: async (request) => {
      menus.push(request);
      return { cardInstanceId: 'menu-card-instance' };
    },
  };
  const harness = {
    currentWorkspace: () => workspace,
    ensureRunning: async (options) => { ensureRunning.push(options); },
    listWorkspaces: async () => [workspace],
    listWorkspaceSessions: async () => ({ sessions: [{ sessionId: 'session-original', title: '原会话' }] }),
    listModels: async () => ({ current: null, groups: [] }),
    agentPresetSettings: async () => ({ agentPreset: null, agentPresetCatalog: { items: [] } }),
    sessionExists: async () => true,
    ask: async (sessionId, content) => {
      asks.push({ sessionId, content });
      return '测试回复';
    },
  };
  const bridge = new DingtalkHarnessBridge({
    api,
    clientId: 'ding-client',
    clientSecret: 'host-secret',
    harness,
    state: fixture.state,
  });
  let sequence = 0;
  return {
    fixture,
    sent,
    asks,
    menus,
    ensureRunning,
    send: async (text) => {
      const id = `chinese-command-${++sequence}`;
      await bridge.accept(message(id, text));
    },
  };
}

test('DingTalk accepts Chinese /帮助 and appends the Chinese command hint once', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/帮助');

  const help = f.sent.at(-1);
  assert.match(help, /\/help/);
  assert.match(help, /中文命令同样可用：/);
  assert.match(help, /\/帮助/);
  assert.equal((help.match(/中文命令同样可用：/gu) ?? []).length, 1);
  assert.equal(f.asks.length, 0);
});

test('DingTalk treats Chinese /新对话 exactly like /new', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/新对话');

  assert.equal(f.fixture.state.sessionFor(key), null);
  assert.match(f.sent.at(-1), /已开启新会话/);
  assert.equal(f.asks.length, 0);
});

test('DingTalk treats Chinese /状态 exactly like /status', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/状态');

  assert.equal(f.ensureRunning.length, 1);
  assert.match(f.sent.at(-1), /连接正常/);
  assert.equal(f.asks.length, 0);
});

test('DingTalk treats Chinese /菜单 exactly like /m', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/菜单');

  assert.equal(f.menus.length, 1);
  assert.equal(f.asks.length, 0);
});

test('DingTalk treats Chinese /版本 exactly like /version', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/版本');

  assert.match(f.sent.at(-1), /dsh-im v\d+\.\d+\.\d+/);
  assert.equal(f.asks.length, 0);
});

test('DingTalk does not read /帮助我 as the help command', async (t) => {
  setImHostLanguage('zh');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/帮助我');

  assert.equal(f.asks.length, 1);
  assert.equal(f.asks[0].content, '/帮助我');
  assert.equal(f.sent.some((text) => /中文命令同样可用/.test(text)), false);
});

test('DingTalk omits the Chinese hint when the interface language is not zh', async (t) => {
  setImHostLanguage('en');
  t.after(() => setImHostLanguage('zh'));
  const f = bridgeFixture();

  await f.send('/help');

  assert.equal(f.sent.at(-1).includes('中文命令同样可用'), false);
  assert.equal(f.asks.length, 0);
});