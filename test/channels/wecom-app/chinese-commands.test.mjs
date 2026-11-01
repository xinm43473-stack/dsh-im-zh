import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WecomAppBridge } from '../../../src/channels/wecom-app/wecom-app-bridge.mjs';
import { WecomAppStateStore } from '../../../src/channels/wecom-app/state-store.mjs';
import { getImHostLanguage, setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';

function textMessage(id, text) {
  return {
    msgid: id,
    msgtype: 'text',
    from: { userid: 'user-1' },
    text: { content: text },
  };
}

function harness({ asks = [] } = {}) {
  return {
    ensureRunning: async () => {},
    sessionExists: async () => true,
    createSession: async () => 'session-1',
    ask: async (_sessionId, prompt) => {
      asks.push(prompt);
      return '模型回答';
    },
  };
}

async function bridgeFor({ asks = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wecomapp-chinese-'));
  const state = await new WecomAppStateStore(join(root, 'state.json')).load();
  const sent = [];
  const bridge = new WecomAppBridge({
    api: {
      sendText: async ({ userId, content }) => {
        sent.push({ userId, content });
        return { message_id: 'outbound-' + sent.length };
      },
    },
    harness: harness({ asks }),
    state,
    status: { messagesReceived: 0, messagesReplied: 0 },
  });
  return {
    bridge,
    sent,
    async close() {
      await bridge.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function eventually(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('condition did not become true');
}

test('Enterprise WeChat app accepts Chinese command aliases exactly like English ones', async () => {
  const fixture = await bridgeFor();
  try {
    await fixture.bridge.accept(textMessage('help-en', '/help'));
    const englishHelp = fixture.sent.at(-1).content;
    await fixture.bridge.accept(textMessage('help-zh', '/帮助'));
    const chineseHelp = fixture.sent.at(-1).content;
    assert.equal(chineseHelp, englishHelp);
    assert.match(chineseHelp, /\/help/u);
    assert.match(chineseHelp, /中文命令同样可用：/u);
    assert.match(chineseHelp, /\/帮助/u);

    await fixture.bridge.accept(textMessage('new-en', '/new'));
    const englishNew = fixture.sent.at(-1).content;
    await fixture.bridge.accept(textMessage('new-zh', '/新对话'));
    assert.equal(fixture.sent.at(-1).content, englishNew);

    await fixture.bridge.accept(textMessage('status-en', '/status'));
    const englishStatus = fixture.sent.at(-1).content;
    await fixture.bridge.accept(textMessage('status-zh', '/状态'));
    assert.equal(fixture.sent.at(-1).content, englishStatus);
  } finally {
    await fixture.close();
  }
});

test('Enterprise WeChat app treats /菜单 like /m: both stay ordinary prompts', async () => {
  const asks = [];
  const fixture = await bridgeFor({ asks });
  try {
    await fixture.bridge.accept(textMessage('menu-zh', '/菜单'));
    await eventually(() => asks.length === 1);
    await fixture.bridge.accept(textMessage('menu-en', '/m'));
    await eventually(() => asks.length === 2);

    assert.deepEqual(asks, ['/菜单', '/m']);
    assert.equal(fixture.sent.at(-1).content, '模型回答');
  } finally {
    await fixture.close();
  }
});

test('Enterprise WeChat app leaves an unmatched Chinese prefix for the model', async () => {
  const asks = [];
  const fixture = await bridgeFor({ asks });
  try {
    await fixture.bridge.accept(textMessage('not-a-command', '/帮助我'));
    await eventually(() => asks.length === 1);

    assert.deepEqual(asks, ['/帮助我']);
    assert.equal(fixture.sent.at(-1).content, '模型回答');
  } finally {
    await fixture.close();
  }
});

test('Enterprise WeChat app help mentions Chinese commands only for the zh interface', async () => {
  const previous = getImHostLanguage();
  const fixture = await bridgeFor();
  try {
    setImHostLanguage('zh');
    await fixture.bridge.accept(textMessage('help-zh-language', '/help'));
    assert.match(fixture.sent.at(-1).content, /中文命令同样可用：/u);
    assert.match(fixture.sent.at(-1).content, /\/帮助/u);

    setImHostLanguage('en');
    await fixture.bridge.accept(textMessage('help-en-language', '/help'));
    assert.doesNotMatch(fixture.sent.at(-1).content, /中文命令同样可用/u);
    assert.doesNotMatch(fixture.sent.at(-1).content, /\/帮助/u);
  } finally {
    setImHostLanguage(previous);
    await fixture.close();
  }
});