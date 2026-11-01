import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuHarnessBridge } from '../../../src/channels/feishu/bridge.mjs';
import { helpCard, menuHelpText } from '../../../src/channels/feishu/feishu-cards.mjs';
import { setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';

function event(messageId, text, overrides = {}) {
  const { senderOpenId = 'ou_user', ...messageOverrides } = overrides;
  return {
    sender: { sender_type: 'user', sender_id: { open_id: senderOpenId } },
    message: {
      message_id: messageId,
      message_type: 'text',
      chat_type: 'p2p',
      chat_id: 'oc_chat',
      content: JSON.stringify({ text }),
      ...messageOverrides,
    },
  };
}

function stateFixture(initialSessions = []) {
  const sessions = new Map(initialSessions);
  const seen = new Set();
  return {
    sessions,
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => seen.add(id),
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => sessions.set(key, sessionId),
      clearSession: async (key) => sessions.delete(key),
    },
  };
}

function bridgeStatus() {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
  };
}

function textClient(sendText) {
  let sequence = 0;
  return {
    im: { v1: { message: { create: async (request) => {
      await sendText({
        chatId: request.data.receive_id,
        text: request.data.msg_type === 'text'
          ? JSON.parse(request.data.content).text
          : undefined,
      });
      sequence += 1;
      return { code: 0, data: { message_id: `om_test_${sequence}` } };
    } } } },
  };
}

function cardClient(onSend) {
  let sequence = 0;
  return {
    im: { v1: { message: { create: async (request) => {
      await onSend({
        chatId: request.data.receive_id,
        msgType: request.data.msg_type,
        content: JSON.parse(request.data.content),
      });
      sequence += 1;
      return { code: 0, data: { message_id: `om_card_${sequence}` } };
    } } } },
  };
}

// Minimal harness: enough for the local command paths plus one plain prompt.
function harness() {
  return {
    ensureRunning: async () => true,
    sessionExists: async () => true,
    createSession: async () => 'session-alias',
    currentWorkspace: () => null,
    agentPresetSettings: async () => ({
      agentPreset: null,
      agentPresetCatalog: { defaultId: null, items: [] },
    }),
  };
}

function textBridge(fixture, sent, options = {}) {
  return new FeishuHarnessBridge({
    client: textClient(async ({ text }) => {
      if (text !== undefined) sent.push(text);
    }),
    channel: {},
    harness: { ...harness(), ...options.harness },
    state: fixture.state,
    status: bridgeStatus(),
    allowedSenderOpenIds: new Set(['ou_owner']),
  });
}

test('Feishu `/帮助` behaves exactly like `/help`', async () => {
  const fixture = stateFixture();
  const sent = [];
  const bridge = textBridge(fixture, sent);

  await bridge.accept(event('help-ascii', '/help', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  const asciiReply = sent.at(-1);

  await bridge.accept(event('help-chinese', '/帮助', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  const chineseReply = sent.at(-1);

  assert.match(asciiReply, /助手菜单/);
  assert.equal(chineseReply, asciiReply);
});

test('Feishu `/新对话` behaves exactly like `/new`', async () => {
  const fixture = stateFixture([['p2p:ou_owner', 'session-old']]);
  const sent = [];
  const bridge = textBridge(fixture, sent);

  await bridge.accept(event('new-ascii', '/new', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  assert.equal(fixture.sessions.has('p2p:ou_owner'), false);
  const asciiReply = sent.at(-1);

  await fixture.state.setSession('p2p:ou_owner', 'session-old-again');
  await bridge.accept(event('new-chinese', '/新对话', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  assert.equal(fixture.sessions.has('p2p:ou_owner'), false);
  assert.equal(sent.at(-1), asciiReply);
  assert.match(asciiReply, /已开启全新 Harness 会话/);
});

test('Feishu `/状态` behaves exactly like `/status`', async () => {
  const fixture = stateFixture();
  const sent = [];
  const bridge = textBridge(fixture, sent);

  await bridge.accept(event('status-ascii', '/status', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  const asciiReply = sent.at(-1);

  await bridge.accept(event('status-chinese', '/状态', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  const chineseReply = sent.at(-1);

  assert.match(asciiReply, /连接正常/);
  assert.equal(chineseReply, asciiReply);
});

test('Feishu `/菜单` behaves exactly like `/m`', async () => {
  const fixture = stateFixture();
  const cards = [];
  const bridge = new FeishuHarnessBridge({
    client: cardClient(async (outgoing) => cards.push(outgoing)),
    channel: {},
    harness: harness(),
    state: fixture.state,
    status: bridgeStatus(),
    allowedSenderOpenIds: new Set(['ou_owner']),
  });

  await bridge.accept(event('menu-ascii', '/m', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();
  await bridge.accept(event('menu-chinese', '/菜单', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();

  assert.equal(cards.length, 2);
  assert.equal(cards[0].msgType, 'interactive');
  assert.equal(cards[1].msgType, 'interactive');
  // The menu card embeds a fresh new-session action id per render; everything
  // else must be byte-identical between `/m` and `/菜单`.
  const stable = (card) => JSON.stringify(card)
    .replace(/"newSessionActionId":"[^"]*"/g, '"newSessionActionId":"<id>"');
  assert.equal(stable(cards[1].content), stable(cards[0].content));
});

test('Feishu keeps `/帮助我` as an ordinary prompt', async () => {
  const fixture = stateFixture();
  const sent = [];
  const asked = [];
  const bridge = textBridge(fixture, sent, {
    harness: {
      ask: async (_sessionId, text) => {
        asked.push(text);
        return '收到，我来回答。';
      },
    },
  });

  await bridge.accept(event('almost-help', '/帮助我', { senderOpenId: 'ou_owner' }));
  await bridge.waitForIdle();

  assert.deepEqual(asked, ['/帮助我']);
  assert.doesNotMatch(sent.join('\n'), /助手菜单|中文命令同样可用/);
  assert.match(sent.at(-1), /收到，我来回答/);
});

test('Feishu help advertises Chinese aliases in Chinese and not in English', async () => {
  setImHostLanguage('zh');
  try {
    assert.match(menuHelpText(), /中文命令同样可用：\/帮助 \/新对话/);
    assert.match(helpCard(), /中文命令同样可用：\/帮助 \/新对话/);

    const fixture = stateFixture();
    const sent = [];
    const bridge = textBridge(fixture, sent);
    await bridge.accept(event('help-zh-hint', '/帮助', { senderOpenId: 'ou_owner' }));
    await bridge.waitForIdle();
    assert.match(sent.at(-1), /中文命令同样可用：\/帮助 \/新对话/);
  } finally {
    setImHostLanguage('zh');
  }

  setImHostLanguage('en');
  try {
    assert.doesNotMatch(menuHelpText(), /[\u3400-\u9fff]/u);
    assert.doesNotMatch(helpCard(), /[\u3400-\u9fff]/u);

    const fixture = stateFixture();
    const sent = [];
    const bridge = textBridge(fixture, sent);
    await bridge.accept(event('help-en-hint', '/help', { senderOpenId: 'ou_owner' }));
    await bridge.waitForIdle();
    assert.doesNotMatch(sent.at(-1), /[\u3400-\u9fff]/u);
  } finally {
    setImHostLanguage('zh');
  }
});