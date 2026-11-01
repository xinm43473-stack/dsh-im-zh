import assert from 'node:assert/strict';
import test from 'node:test';

import { WecomHarnessBridge } from '../../../src/channels/wecom/wecom-bridge.mjs';
import { getImHostLanguage, setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';

function frame(id, content) {
  return {
    headers: { req_id: `req-${id}` },
    body: {
      msgid: id,
      chattype: 'single',
      from: { userid: 'member-1' },
      msgtype: 'text',
      text: { content },
    },
  };
}

function state() {
  const seen = new Set();
  return {
    seen,
    hasSeen: (id) => seen.has(id),
    markSeen: async (id) => seen.add(id),
    sessionFor: () => 'session-existing',
    sessionExists: async () => true,
    setSession: async () => {},
    clearSession: async () => {},
  };
}

function harness({ asks = [] } = {}) {
  return {
    ensureRunning: async () => {},
    sessionExists: async () => true,
    ask: async (_sessionId, text) => {
      asks.push(text);
      return '模型回答';
    },
  };
}

function transport() {
  const streamed = [];
  const active = [];
  const cards = [];
  const client = {
    replyStream: async (source, streamId, content, finish) => {
      streamed.push({ messageId: source.body.msgid, streamId, content, finish });
    },
    replyStreamNonBlocking: async (source, streamId, content, finish) => {
      streamed.push({ messageId: source.body.msgid, streamId, content, finish });
    },
    replyTemplateCard: async (source, card) => {
      cards.push({ via: 'replyTemplateCard', messageId: source.body.msgid, card });
    },
    sendMessage: async (chatId, body) => {
      active.push({ chatId, body });
      if (body.msgtype === 'template_card') {
        cards.push({ via: 'sendMessage', chatId, card: body.template_card });
      }
    },
  };
  return { streamed, active, cards, client };
}

function bridgeFor(delivery, { asks = [] } = {}) {
  return new WecomHarnessBridge({
    client: delivery.client,
    harness: harness({ asks }),
    state: state(),
  });
}

async function eventually(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('condition did not become true');
}

function withoutTaskId(card) {
  const clone = structuredClone(card);
  delete clone.task_id;
  return clone;
}

test('Enterprise WeChat accepts Chinese command aliases exactly like English ones', async () => {
  const delivery = transport();
  const bridge = bridgeFor(delivery);

  await bridge.accept(frame('help-en', '/help'));
  const englishHelp = delivery.streamed.at(-1).content;
  await bridge.accept(frame('help-zh', '/帮助'));
  const chineseHelp = delivery.streamed.at(-1).content;
  assert.equal(chineseHelp, englishHelp);
  assert.match(chineseHelp, /\/help/u);
  assert.match(chineseHelp, /中文命令同样可用：/u);
  assert.match(chineseHelp, /\/帮助/u);

  await bridge.accept(frame('new-en', '/new'));
  const englishNew = delivery.streamed.at(-1).content;
  await bridge.accept(frame('new-zh', '/新对话'));
  assert.equal(delivery.streamed.at(-1).content, englishNew);

  await bridge.accept(frame('status-en', '/status'));
  const englishStatus = delivery.streamed.at(-1).content;
  await bridge.accept(frame('status-zh', '/状态'));
  assert.equal(delivery.streamed.at(-1).content, englishStatus);
});

test('Enterprise WeChat renders the same menu cards for /菜单 and /m', async () => {
  const delivery = transport();
  const bridge = bridgeFor(delivery);

  await bridge.accept(frame('menu-en', '/m'));
  await eventually(() => delivery.cards.length === 2);
  const englishCards = delivery.cards.map((entry) => withoutTaskId(entry.card));

  await bridge.accept(frame('menu-zh', '/菜单'));
  await eventually(() => delivery.cards.length === 4);
  const chineseCards = delivery.cards.slice(2).map((entry) => withoutTaskId(entry.card));

  assert.deepEqual(chineseCards, englishCards);
});

test('Enterprise WeChat leaves an unmatched Chinese prefix for the model', async () => {
  const delivery = transport();
  const asks = [];
  const bridge = bridgeFor(delivery, { asks });

  await bridge.accept(frame('not-a-command', '/帮助我'));
  await eventually(() => asks.length === 1);

  assert.deepEqual(asks, ['/帮助我']);
  assert.equal(delivery.streamed.at(-1).content, '模型回答');
});

test('Enterprise WeChat help mentions Chinese commands only for the zh interface', async () => {
  const previous = getImHostLanguage();
  const delivery = transport();
  const bridge = bridgeFor(delivery);
  try {
    setImHostLanguage('zh');
    await bridge.accept(frame('help-zh-language', '/help'));
    assert.match(delivery.streamed.at(-1).content, /中文命令同样可用：/u);

    setImHostLanguage('en');
    await bridge.accept(frame('help-en-language', '/help'));
    const english = delivery.streamed.at(-1).content;
    assert.doesNotMatch(english, /中文命令同样可用/u);
    assert.doesNotMatch(english, /\/帮助/u);
  } finally {
    setImHostLanguage(previous);
  }
});
