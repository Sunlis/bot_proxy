'use strict';

import * as Discord from 'discord.js';
import * as di from 'slash-commands';

let clientToken: string|undefined;
let clientAutoRetry: boolean = false;
let clientKey: string = '';

const client = new Discord.Client();
/**
 * Set up a connection to Discord.
 * @param key The application's public key.
 * @param token (optional) The bot token. Discord.js will attempt to read from
 *              `process.env.DISCORD_TOKEN` if this is left `undefined`.
 * @param autoRetry (optional) Automatically try to reconnect if the bot is
                    disconnected from Discord for any reason.
 * @return Promise<Discord.Client>
 */
export const login = (key: string, token?: string, autoRetry: boolean = false): Promise<Discord.Client> => {
  clientKey = key;
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
      return login(clientKey, clientToken!, clientAutoRetry);
    });
  });
};

const doLogin = (): Promise<Discord.Client> => {
  if (client.uptime ?? 0 > 0) {
    return Promise.resolve(client);
  }
  return new Promise<Discord.Client>((resolve, reject) => {
    client.on('ready', () => {
      getInteractions();
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

/* COMMANDS */


let interactions: di.DiscordInteractions|null = null;
const getInteractions = (): Promise<di.DiscordInteractions> => {
  if (interactions) {
    return Promise.resolve(interactions);
  }
  return setupCommands(client).then((int) => {
    interactions = int;
    return int;
  });
};
const setupCommands = (client: Discord.Client): Promise<di.DiscordInteractions> => {
  return client.fetchApplication().then((app) => {
    return new di.DiscordInteractions({
      applicationId: app.id,
      authToken: clientToken!,
      publicKey: clientKey!,
    });
  });
};

class CommandCreationError extends Error {
  message: string;
  obj: any;
  constructor(msg: string, err: any) {
    super(msg);
    this.message = msg;
    this.obj = err;
  }
}

export const createCommand = (command: di.PartialApplicationCommand, guildId?: string) => {
  return getInteractions().then((interactions) => {
    return interactions.createApplicationCommand(command, guildId).then((resp: any) => {
      if (resp.errors) {
        throw new CommandCreationError(`Unable to create command`, resp.errors);
      }
      return resp as di.ApplicationCommand;
    });
  });
};

export const removeCommand = async (commandId: string, guildId?: string) => {
  const interactions = await getInteractions();
  return interactions.deleteApplicationCommand(commandId, guildId);
}

export const removeAllCommands = async (guildId?: string) => {
  const interactions = await getInteractions();
  return interactions.getApplicationCommands(guildId).then((commands) => {
    return Promise.all(commands.map((command) => {
      return removeCommand(command.id, (command as any).guild_id);
    }));
  });
};

export const getCommands = async (guildId?: string) => {
  const interactions = await getInteractions();
  return interactions.getApplicationCommands(guildId);
};

export type InteractionUser = di.User & di.GuildMember;

export class Responder {
  private interaction: di.Interaction;
  private user: di.User;
  private nickname: string;
  private client: Discord.Client;

  private hasPostedOriginal: boolean = false;
  private lastFollowup?: Discord.Message;

  constructor(interaction: di.Interaction, client: Discord.Client) {
    this.interaction = interaction;
    this.client = client;
    this.user = interaction.member?.user || (interaction as any).user;
    this.nickname = interaction.member?.nick || this.user?.username;
  }

  getInteraction() {
    return this.interaction;
  }

  getUser() {
    return this.user;
  }

  getUserId() {
    return this.user.id;
  }

  getNick() {
    return this.nickname;
  }

  private getProp(... keys: string[]): any {
    const found = keys.find((key) => {
      if ((this.interaction as any)[key] !== undefined) {
        return true;
      }
    });
    return (this.interaction as any)[found || keys[0]];
  }

  getChannelId() {
    return this.getProp('channel_id', 'channelId');
  }

  getChannel(): Promise<Discord.TextChannel> {
    return this.client.channels.fetch(this.getChannelId()).then((channel) => {
      return channel as Discord.TextChannel;
    });
  }

  getGuildId() {
    return this.getProp('guild_id', 'guildId');
  }

  getResolvedUser(userId: string): InteractionUser|null {
    const resolved = (this.interaction as any).data.resolved;
    if (!resolved) return null;
    let user = {};
    let found = false;
    if (resolved.users && resolved.users[userId]) {
      found = true;
      user = {
        ...user,
        ...resolved.users[userId],
      };
    }
    if (resolved.members && resolved.members[userId]) {
      found = true;
      user = {
        ...user,
        ...resolved.members[userId],
      };
    }
    return found ? user as InteractionUser : null;
  }

  getUserNick(user: InteractionUser): string {
    return user.nick || user.username || user.id;
  }

  ack(type: number = 1) {
    return (this.client as any).api
      .interactions(this.interaction.id, this.interaction.token)
      .callback.post({
        data: {
          type,
        },
      }).catch((err: any) => {
        console.error('error acking command', err);
      });
  }

  reply(content: string): Promise<Discord.Message> {
    if (!this.hasPostedOriginal) {
      return this.sendOriginal(content);
    }
    return this.sendFollowup(content);
  };

  sendOriginal(
    content: string,
    embeds: Discord.MessageEmbed[] = [],
    type: di.InteractionResponseType = di.InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE
  ): Promise<Discord.Message> {
    if (this.hasPostedOriginal) {
      return this.editOriginal(content, embeds);
    }
    this.hasPostedOriginal = true;
    return (this.client as any).api
      .interactions(this.interaction.id, this.interaction.token)
      .callback.post({
        data: {
          type: type,
          data: {content, embeds},
        },
      }).catch((err: any) => {
        console.error('error posting original', err);
      });
  }

  editOriginal(content: string, embeds: Discord.MessageEmbed[] = []): Promise<Discord.Message> {
    if (!this.hasPostedOriginal) {
      return this.sendOriginal(content, embeds);
    }
    return (this.client as any).api
      .webhooks(this.client.user!.id, this.interaction.token)
      .messages('@original')
      .patch({
        data: {content, embeds},
      }).catch((err: any) => {
        console.error('error patching original', err);
      });;
  }

  sendFollowup(content: string, embeds: Discord.MessageEmbed[] = []): Promise<Discord.Message> {
    const channel = client.channels.cache.get(this.getChannelId()) as Discord.TextChannel;
    if (channel) {
      return channel.send(content);
    } else {
      return (this.client as any).api
        .webhooks(this.client.user!.id, this.interaction.token)
        .post({data:{content, embeds}}).then((followup: Discord.Message) => {
          this.lastFollowup = followup;
          return followup;
        }).catch((err: any) => {
          console.error('error posting followup', err);
        });
    }
  }

  editFollowup(followup: Discord.Message, content: string, embeds: Discord.MessageEmbed[] = []): Promise<Discord.Message> {
    return this.sendFollowup(content);
  }
}

export type InteractionHandler = (interaction: di.Interaction, responder: Responder) => void;
const interactionHandlers: InteractionHandler[] = [];
export const onInteraction = (handler: InteractionHandler) => {
  interactionHandlers.push(handler);
};
client.ws.on('INTERACTION_CREATE' as Discord.WSEventType, (interaction) => {
  try {
    const responder = new Responder(interaction, client);
    interactionHandlers.forEach((handler) => {
      const response = handler(interaction, responder);
    });
  } catch (e) {
    console.error('Error while trying to run interaction handlers', e);
  }
});
