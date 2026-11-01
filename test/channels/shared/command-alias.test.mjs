import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findDuplicateLocalizedAliases,
  localizedAliasesFor,
  localizedCommandAliasEntries,
  localizedCommandForms,
  normalizeCommandText,
} from '../../../src/channels/shared/command-alias.mjs';
import {
  SHARED_COMMAND_CATALOG,
  commandsForChannel,
} from '../../../src/channels/shared/command-catalog.mjs';
import { getImHostLanguage, setImHostLanguage } from '../../../src/channels/shared/i18n.mjs';
import { TelegramHarnessBridge } from '../../../src/channels/telegram/telegram-bridge.mjs';

test('Chinese command aliases normalize to the canonical English command', () => {
  assert.equal(normalizeCommandText('/帮助'), '/help');
  assert.equal(normalizeCommandText('/新对话'), '/new');
  assert.equal(normalizeCommandText('/新会话'), '/new');
  assert.equal(normalizeCommandText('/状态'), '/status');
  assert.equal(normalizeCommandText('/停止'), '/stop');
  assert.equal(normalizeCommandText('/清空'), '/clear');
  assert.equal(normalizeCommandText('/压缩'), '/compact');
  assert.equal(normalizeCommandText('/菜单'), '/m');
});

test('aliases keep arguments byte-identical', () => {
  assert.equal(normalizeCommandText('/新对话 你好'), '/new 你好');
  assert.equal(normalizeCommandText('/模型 2'), '/model 2');
  assert.equal(normalizeCommandText('/工作区 2 all'), '/workspace 2 all');
  assert.equal(normalizeCommandText('/停止\n'), '/stop\n');
  // A group channel appends the bot mention to the command token itself.
  assert.equal(normalizeCommandText('/帮助@my_bot'), '/help@my_bot');
  assert.equal(normalizeCommandText('/模型@my_bot 2'), '/model@my_bot 2');
});

test('ordinary text that only looks like an alias is left alone', () => {
  for (const text of [
    '/帮助我',
    '/未知命令',
    '/ help',
    '/',
    '帮助',
    '/帮助x y',
    '你好，请帮我看看',
    '',
  ]) {
    assert.equal(normalizeCommandText(text), text, text);
  }
  // Non-strings pass through, so a caller never has to pre-check the type.
  assert.equal(normalizeCommandText(undefined), undefined);
  assert.equal(normalizeCommandText(null), null);
});

test('English commands are never rewritten', () => {
  assert.equal(normalizeCommandText('/help'), '/help');
  assert.equal(normalizeCommandText('/new topic'), '/new topic');
});

test('every catalog command has at least one Chinese alias', () => {
  for (const command of SHARED_COMMAND_CATALOG) {
    assert.ok(
      localizedAliasesFor(command.name).length > 0,
      `${command.name} has no Chinese alias`,
    );
  }
});

test('no alias belongs to two commands', () => {
  assert.deepEqual(findDuplicateLocalizedAliases(), []);
  // The pair list and the reverse lookup agree.
  for (const [alias, command] of localizedCommandAliasEntries()) {
    assert.equal(normalizeCommandText(`/${alias}`), `/${command}`);
  }
});

test('localizedCommandForms prefixes each alias with a slash', () => {
  assert.deepEqual(localizedCommandForms('help'), ['/帮助', '/帮助信息', '/使用说明']);
  assert.deepEqual(localizedCommandForms('nope'), []);
});

async function helpTextFor(language, content = '/帮助') {
  const previous = getImHostLanguage();
  setImHostLanguage(language);
  let help;
  try {
    const bridge = new TelegramHarnessBridge({
      bot: { sendText: async (_, text) => { help = text; } },
      harness: {},
      state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: () => null },
    });
    await bridge.accept({
      messageId: 'help', senderId: '42', kind: 'direct', conversationId: '88',
      content, replyTarget: {},
    });
  } finally {
    setImHostLanguage(previous);
  }
  return help;
}

test('the Chinese help page lists the Chinese spelling of every command', async () => {
  const help = await helpTextFor('zh');
  const trailer = help.split('\n').find((line) => line.startsWith('中文命令同样可用：'));
  assert.ok(trailer, 'the Chinese help page must carry the alias line');
  for (const item of commandsForChannel('telegram')) {
    const [form] = localizedCommandForms(item.name);
    assert.ok(form && trailer.includes(form), `missing ${form ?? item.name}`);
  }
});

test('a non-Chinese help page keeps no Chinese trailer', async () => {
  const help = await helpTextFor('en', '/help');
  assert.ok(!help.includes('中文命令同样可用：'));
  assert.ok(help.includes('Show this help'));
});

test('/帮助 reaches the bridge exactly like /help', async () => {
  assert.equal(await helpTextFor('zh', '/帮助'), await helpTextFor('zh', '/help'));
});