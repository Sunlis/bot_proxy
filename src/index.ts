'use strict';

import * as Discord from 'discord.js';

let clientToken: string|undefined;
let clientAutoRetry: boolean = false;

const client = new Discord.Client();
/**
 * Set up a connection to Discord.
 * @param token (optional) The bot token. Discord.js will attempt to read from
 *              `process.env.DISCORD_TOKEN` if this is left `undefined`.
 * @param autoRetry (optional) Automatically try to reconnect if the bot is
                    disconnected from Discord for any reason.
 * @return Promise<Discord.Client>
 */
export const login = (token?: string, autoRetry: boolean = false): Promise<Discord.Client> => {
  clientToken = token;
  clientAutoRetry = autoRetry;
  return wrapLogin();
};

const wait = (delay: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, delay);
  });
};

const wrapLogin = () => {
  if (!clientAutoRetry) {
    return doLogin();
  }
  return doLogin().catch((err: any) => {
    console.error('error logging in', err);
    console.error('retrying login in 20 seconds');
    return wait(20000).then(() => {
      return login(clientToken, clientAutoRetry);
    });
  });
};

const doLogin = (): Promise<Discord.Client> => {
  if (client.uptime ?? 0 > 0) {
    return Promise.resolve(client);
  }
  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      resolve(client);
    });
    client.on('error', (err) => {
      console.log('discord.js runtime error', err);
    });
    client.login(clientToken).catch((err: any) => {
      reject(err);
    });
  });
};


type MessageHandler = (message: Discord.Message) => void;
const messageHandlers: MessageHandler[] = [];
export const onMessage = (handler: MessageHandler) => {
  messageHandlers.push(handler);
};
client.on('message', (message: Discord.Message) => {
  messageHandlers.forEach((handler: MessageHandler) => {
    handler(message);
  });
});

type ReactionHandler = (reaction: Discord.MessageReaction, user: Discord.User|Discord.PartialUser) => void;
const reactHandlers: ReactionHandler[] = [];
export const onReact = (handler: ReactionHandler) => {
  reactHandlers.push(handler);
};
client.on('messageReactionAdd', (reaction: Discord.MessageReaction, user: Discord.User|Discord.PartialUser) => {
  // Ignore own reaction events, ignore unless self has reacted.
  if (reaction.me || user == client.user) return;
  reactHandlers.forEach((handler: ReactionHandler) => {
    handler(reaction, user);
  });
});
