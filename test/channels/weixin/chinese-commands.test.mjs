import assert from 'node:assert/strict';
import test from 'node:test';

import { WeixinHarnessBridge } from '../../../src/channels/weixin/weixin-bridge.mjs';
import { getImHostLanguage, setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';

function message(id, text) {
  return {
    message_id: id,
    message_type: 1,
    from_user_id: 'owner-user',
    context_token: `context-${id}`,
    item_list: [{ type: 1, text_item: { text } }],
  };
}

function stateFixture() {
  const sessions = new Map();
  const seen = new Set();
  return {
    sessions,
    seen,
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => seen.add(id),
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => sessions.set(key, sessionId),
      clearSession: async (key) => sessions.delete(key),
    },
  };
}

function bridgeFor({ orders = [], asks = [] } = {}) {
  const sent = [];
  const bridge = new WeixinHarnessBridge({
    api: {
      sendText: async (request) => {
        sent.push(request.text);
        orders.push(request.text);
      },
    },
    baseUrl: 'https://ilinkai.weixin.qq.com/',
    token: 'host-token',
    ownerUserId: 'owner-user',
    harness: {
      ensureRunning: async () => {},
      sessionExists: async () => true,
      createSession: async () => 'session-1',
      ask: async (_sessionId, text) => {
        asks.push(text);
        return '模型回答';
      },
    },
    state: stateFixture().state,
  });
  return { bridge, sent };
}

async function eventually(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('condition did not become true');
}

test('Weixin accepts Chinese command aliases exactly like English ones', async () => {
  const { bridge, sent } = bridgeFor();

  await bridge.accept(message('help-en', '/help'));
  const englishHelp = sent.at(-1);
  await bridge.accept(message('help-zh', '/帮助'));
  const chineseHelp = sent.at(-1);
  assert.equal(chineseHelp, englishHelp);
  assert.match(chineseHelp, /\/help/u);
  assert.match(chineseHelp, /中文命令同样可用：/u);
  assert.match(chineseHelp, /\/帮助/u);

  await bridge.accept(message('new-en', '/new'));
  const englishNew = sent.at(-1);
  await bridge.accept(message('new-zh', '/新对话'));
  assert.equal(sent.at(-1), englishNew);

  await bridge.accept(message('status-en', '/status'));
  const englishStatus = sent.at(-1);
  await bridge.accept(message('status-zh', '/状态'));
  assert.equal(sent.at(-1), englishStatus);
});

test('Weixin treats /菜单 like /m: both stay ordinary prompts with their own spelling', async () => {
  const asks = [];
  const { bridge, sent } = bridgeFor({ asks });

  await bridge.accept(message('menu-zh', '/菜单'));
  await eventually(() => asks.length === 1);
  await bridge.accept(message('menu-en', '/m'));
  await eventually(() => asks.length === 2);

  assert.deepEqual(asks, ['/菜单', '/m']);
  assert.equal(sent.at(-1), '模型回答');
});

test('Weixin leaves an unmatched Chinese prefix for the model', async () => {
  const asks = [];
  const { bridge, sent } = bridgeFor({ asks });

  await bridge.accept(message('not-a-command', '/帮助我'));
  await eventually(() => asks.length === 1);

  assert.deepEqual(asks, ['/帮助我']);
  assert.equal(sent.at(-1), '模型回答');
});

test('Weixin help mentions Chinese commands only for the zh interface', async () => {
  const previous = getImHostLanguage();
  const { bridge, sent } = bridgeFor();
  try {
    setImHostLanguage('zh');
    await bridge.accept(message('help-zh-language', '/help'));
    assert.match(sent.at(-1), /中文命令同样可用：/u);
    assert.match(sent.at(-1), /\/帮助/u);

    setImHostLanguage('en');
    await bridge.accept(message('help-en-language', '/help'));
    assert.doesNotMatch(sent.at(-1), /中文命令同样可用/u);
    assert.doesNotMatch(sent.at(-1), /\/帮助/u);
  } finally {
    setImHostLanguage(previous);
  }
});