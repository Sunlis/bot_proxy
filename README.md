# bot_proxy
 middleware to make simple discord bots a tiny bit simpler

## Basic Usage

```ts
import * as bot from 'bot-proxy';

bot.login('myPublicKey', 'myBotToken').then((client) => {
  bot.onMessage((message) => {
    message.reply(`Hello, ${message.author.username}!`);
  });
});
```

## Slash Commands

I recommend using [slash-commands](https://www.npmjs.com/package/slash-commands) to build your command objects.

```typescript
import * as bot from 'bot-proxy';
import * as slash from 'slash-commands';

bot.login('myPublicKey', 'myBotToken').then((client) => {
  bot.createCommand((new slash.CommandBuilder())
    .setName('sayHi')
    .setDescription('Make the bot say hello!')
    .build(), 'myGuildId');
  bot.onInteraction((interaction, responder) => {
    responder.reply(`Hello, ${responder.getNick()}!`);
  });
});
```
