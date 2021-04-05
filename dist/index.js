'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.onInteraction = exports.Responder = exports.getCommands = exports.removeAllCommands = exports.removeCommand = exports.createCommand = exports.onReact = exports.onMessage = exports.login = void 0;
const Discord = require("discord.js");
const di = require("slash-commands");
let clientToken;
let clientAutoRetry = false;
let clientKey = '';
const client = new Discord.Client();
exports.login = (key, token, autoRetry = false) => {
    clientKey = key;
    clientToken = token;
    clientAutoRetry = autoRetry;
    return wrapLogin();
};
const wait = (delay) => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay);
    });
};
const wrapLogin = () => {
    if (!clientAutoRetry) {
        return doLogin();
    }
    return doLogin().catch((err) => {
        console.error('error logging in', err);
        console.error('retrying login in 20 seconds');
        return wait(20000).then(() => {
            return exports.login(clientKey, clientToken, clientAutoRetry);
        });
    });
};
const doLogin = () => {
    var _a;
    if ((_a = client.uptime) !== null && _a !== void 0 ? _a : 0 > 0) {
        return Promise.resolve(client);
    }
    return new Promise((resolve, reject) => {
        client.on('ready', () => {
            getInteractions();
            resolve(client);
        });
        client.on('error', (err) => {
            console.log('discord.js runtime error', err);
        });
        client.login(clientToken).catch((err) => {
            reject(err);
        });
    });
};
const messageHandlers = [];
exports.onMessage = (handler) => {
    messageHandlers.push(handler);
};
client.on('message', (message) => {
    messageHandlers.forEach((handler) => {
        handler(message);
    });
});
const reactHandlers = [];
exports.onReact = (handler) => {
    reactHandlers.push(handler);
};
client.on('messageReactionAdd', (reaction, user) => {
    if (reaction.me || user == client.user)
        return;
    reactHandlers.forEach((handler) => {
        handler(reaction, user);
    });
});
let interactions = null;
const getInteractions = () => {
    if (interactions) {
        return Promise.resolve(interactions);
    }
    return setupCommands(client).then((int) => {
        interactions = int;
        return int;
    });
};
const setupCommands = (client) => {
    return client.fetchApplication().then((app) => {
        return new di.DiscordInteractions({
            applicationId: app.id,
            authToken: clientToken,
            publicKey: clientKey,
        });
    });
};
class CommandCreationError extends Error {
    constructor(msg, err) {
        super(msg);
        this.message = msg;
        this.obj = err;
    }
}
exports.createCommand = (command, guildId) => {
    return getInteractions().then((interactions) => {
        return interactions.createApplicationCommand(command, guildId).then((resp) => {
            if (resp.errors) {
                throw new CommandCreationError(`Unable to create command`, resp.errors);
            }
            return resp;
        });
    });
};
exports.removeCommand = async (commandId, guildId) => {
    const interactions = await getInteractions();
    return interactions.deleteApplicationCommand(commandId, guildId);
};
exports.removeAllCommands = async (guildId) => {
    const interactions = await getInteractions();
    return interactions.getApplicationCommands(guildId).then((commands) => {
        return Promise.all(commands.map((command) => {
            return exports.removeCommand(command.id, command.guild_id);
        }));
    });
};
exports.getCommands = async (guildId) => {
    const interactions = await getInteractions();
    return interactions.getApplicationCommands(guildId);
};
class Responder {
    constructor(interaction, client) {
        var _a, _b, _c;
        this.hasPostedOriginal = false;
        this.interaction = interaction;
        this.client = client;
        this.user = ((_a = interaction.member) === null || _a === void 0 ? void 0 : _a.user) || interaction.user;
        this.nickname = ((_b = interaction.member) === null || _b === void 0 ? void 0 : _b.nick) || ((_c = this.user) === null || _c === void 0 ? void 0 : _c.username);
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
    getProp(...keys) {
        const found = keys.find((key) => {
            if (this.interaction[key] !== undefined) {
                return true;
            }
        });
        return this.interaction[found || keys[0]];
    }
    getChannelId() {
        return this.getProp('channel_id', 'channelId');
    }
    getGuildId() {
        return this.getProp('guild_id', 'guildId');
    }
    getResolvedUser(userId) {
        const resolved = this.interaction.data.resolved;
        if (!resolved)
            return null;
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
        return found ? user : null;
    }
    getUserNick(user) {
        return user.nick || user.username || user.id;
    }
    ack(type = 1) {
        return this.client.api
            .interactions(this.interaction.id, this.interaction.token)
            .callback.post({
            data: {
                type,
            },
        }).catch((err) => {
            console.error('error acking command', err);
        });
    }
    reply(content) {
        if (!this.hasPostedOriginal) {
            return this.sendOriginal(content);
        }
        return this.sendFollowup(content);
    }
    ;
    sendOriginal(content, embeds = [], type = di.InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE) {
        if (this.hasPostedOriginal) {
            return this.editOriginal(content, embeds);
        }
        this.hasPostedOriginal = true;
        return this.client.api
            .interactions(this.interaction.id, this.interaction.token)
            .callback.post({
            data: {
                type: type,
                data: { content, embeds },
            },
        }).catch((err) => {
            console.error('error posting original', err);
        });
    }
    editOriginal(content, embeds = []) {
        if (!this.hasPostedOriginal) {
            return this.sendOriginal(content, embeds);
        }
        return this.client.api
            .webhooks(this.client.user.id, this.interaction.token)
            .messages('@original')
            .patch({
            data: { content, embeds },
        }).catch((err) => {
            console.error('error patching original', err);
        });
        ;
    }
    sendFollowup(content, embeds = []) {
        const channel = client.channels.cache.get(this.getChannelId());
        if (channel) {
            return channel.send(content);
        }
        else {
            return this.client.api
                .webhooks(this.client.user.id, this.interaction.token)
                .post({ data: { content, embeds } }).then((followup) => {
                this.lastFollowup = followup;
                return followup;
            }).catch((err) => {
                console.error('error posting followup', err);
            });
        }
    }
    editFollowup(followup, content, embeds = []) {
        return this.sendFollowup(content);
    }
}
exports.Responder = Responder;
const interactionHandlers = [];
exports.onInteraction = (handler) => {
    interactionHandlers.push(handler);
};
client.ws.on('INTERACTION_CREATE', (interaction) => {
    try {
        const responder = new Responder(interaction, client);
        interactionHandlers.forEach((handler) => {
            const response = handler(interaction, responder);
        });
    }
    catch (e) {
        console.error('Error while trying to run interaction handlers', e);
    }
});
//# sourceMappingURL=index.js.map