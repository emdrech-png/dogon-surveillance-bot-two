require("dotenv").config();

const fs = require("fs");
const axios = require("axios");

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ========================================
// ROBLOX USERS TO TRACK
// ========================================

const ROBLOX_USERS = [
    "Dogon",
    "Tiltwilt",
    "MrVirtual",
    "MrCharlez",
    "ChrisHaveASuperPower",
    "Przzy",
    "robloxian4545",
    "GoopBloop94",
    "ChrisHaveASound",
    "2Piantissimo",
    "MisterVaine",
];

const CHECK_INTERVAL = 30000;

// ========================================
// PLACE TRACKING
// ========================================

const PLACE_FILE = "./tracked_places.json";

let trackedPlaces = {};

if (fs.existsSync(PLACE_FILE)) {
    try {
        trackedPlaces = JSON.parse(
            fs.readFileSync(PLACE_FILE, "utf8")
        );
    } catch (error) {
        console.log("Could not read tracked_places.json");
        trackedPlaces = {};
    }
}

function saveTrackedPlaces() {
    fs.writeFileSync(
        PLACE_FILE,
        JSON.stringify(trackedPlaces, null, 4)
    );
}

// ========================================
// ROBLOX USER DATA
// ========================================

const robloxUserIds = new Map();
const previousStatuses = new Map();

// ========================================
// DISCORD CHANNEL
// ========================================

async function getNotificationChannel() {
    const channelId = process.env.CHANNEL_ID;

    if (!channelId) {
        console.log("ERROR: CHANNEL_ID is missing from .env");
        return null;
    }

    try {
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
            console.log("ERROR: Could not find Discord channel.");
            return null;
        }

        return channel;

    } catch (error) {
        console.log(
            "ERROR getting Discord channel:",
            error.message
        );

        return null;
    }
}

// ========================================
// ROBLOX USER ID
// ========================================

async function getRobloxUserId(username) {
    try {
        const response = await axios.post(
            "https://users.roblox.com/v1/usernames/users",
            {
                usernames: [username],
                excludeBannedUsers: false
            }
        );

        if (
            !response.data.data ||
            response.data.data.length === 0
        ) {
            console.log(
                `Could not find Roblox user: ${username}`
            );

            return null;
        }

        return response.data.data[0].id;

    } catch (error) {
        console.log(
            `Error finding Roblox user ${username}:`,
            error.message
        );

        return null;
    }
}

// ========================================
// ROBLOX AVATAR
// ========================================

async function getRobloxAvatar(userId) {
    try {
        const response = await axios.get(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot",
            {
                params: {
                    userIds: userId,
                    size: "420x420",
                    format: "Png",
                    isCircular: false
                }
            }
        );

        const data = response.data.data?.[0];

        if (!data) {
            return null;
        }

        return data.imageUrl || null;

    } catch (error) {
        console.log(
            "Error getting Roblox avatar:",
            error.message
        );

        return null;
    }
}

// ========================================
// ROBLOX PRESENCE
// ========================================

async function getRobloxPresence(userIds) {
    try {
        const response = await axios.post(
            "https://presence.roblox.com/v1/presence/users",
            {
                userIds: userIds
            },
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        return response.data.userPresences || [];

    } catch (error) {
        console.log(
            "Error getting Roblox presence:",
            error.response?.data || error.message
        );

        return [];
    }
}

// ========================================
// STATUS NAME
// ========================================

function getStatusName(type) {
    switch (type) {
        case 0:
            return "Offline";

        case 1:
            return "Online";

        case 2:
            return "Playing";

        case 3:
            return "Roblox Studio";

        default:
            return "Unknown";
    }
}

// ========================================
// PLAYER STATUS EMBED
// ========================================

async function sendStatusEmbed(
    username,
    status,
    avatarUrl
) {
    const channel = await getNotificationChannel();

    if (!channel) {
        return;
    }

    let title = "";
    let description = "";

    if (status.type === 0) {

        title = "🔴 User Offline";

        description =
            `**${username}** is now offline.`;

    } else if (status.type === 1) {

        title = "🟢 User Online";

        description =
            `**${username}** is now online.`;

    } else if (status.type === 2) {

        title = "🎮 Game Joined";

        description =
            `**${username}** is now playing Roblox.`;

        if (status.location) {

            description +=
                `\n\n**Game:** ${status.location}`;

        }

    } else if (status.type === 3) {

        title = "🛠️ Roblox Studio";

        description =
            `**${username}** is now using Roblox Studio.`;

    } else {

        title = "ℹ️ Roblox Status";

        description =
            `**${username}** changed their Roblox status.`;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(avatarUrl || null)
        .setFooter({
            text: "Dogon Tracker"
        })
        .setTimestamp();

    try {

        await channel.send({
            embeds: [embed]
        });

        console.log(
            `Sent Discord notification for ${username}`
        );

    } catch (error) {

        console.log(
            "ERROR sending Discord message:",
            error.message
        );
    }
}

// ========================================
// CHECK ROBLOX USERS
// ========================================

async function checkUsers() {

    if (robloxUserIds.size === 0) {
        return;
    }

    const userIds =
        Array.from(robloxUserIds.values());

    const presences =
        await getRobloxPresence(userIds);

    for (const presence of presences) {

        let username = null;

        for (const [name, id] of robloxUserIds) {

            if (id === presence.userId) {
                username = name;
                break;
            }
        }

        if (!username) {
            continue;
        }

        const currentStatus = {

            type: presence.userPresenceType,

            location:
                presence.lastLocation || "",

            placeId:
                presence.placeId || null,

            gameId:
                presence.gameId || null
        };

        const oldStatus =
            previousStatuses.get(username);

        if (!oldStatus) {

            previousStatuses.set(
                username,
                currentStatus
            );

            console.log(
                `[INITIAL] ${username}: ${getStatusName(currentStatus.type)}`
            );

            continue;
        }

        const changed =
            oldStatus.type !== currentStatus.type ||
            oldStatus.location !== currentStatus.location ||
            oldStatus.placeId !== currentStatus.placeId ||
            oldStatus.gameId !== currentStatus.gameId;

        if (changed) {

            console.log("");
            console.log(
                `CHANGE DETECTED: ${username}`
            );

            console.log(
                `Old status: ${getStatusName(oldStatus.type)}`
            );

            console.log(
                `New status: ${getStatusName(currentStatus.type)}`
            );

            const avatarUrl =
                await getRobloxAvatar(
                    presence.userId
                );

            await sendStatusEmbed(
                username,
                currentStatus,
                avatarUrl
            );
        }

        previousStatuses.set(
            username,
            currentStatus
        );
    }
}

// ========================================
// SLASH COMMANDS
// ========================================

const commands = [

    new SlashCommandBuilder()
        .setName("track")
        .setDescription(
            "Track a Roblox Place ID"
        )
        .addStringOption(option =>
            option
                .setName("place_id")
                .setDescription(
                    "The Roblox Place ID to track"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("untrack")
        .setDescription(
            "Stop tracking a Roblox Place ID"
        )
        .addStringOption(option =>
            option
                .setName("place_id")
                .setDescription(
                    "The Roblox Place ID to stop tracking"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("tracked")
        .setDescription(
            "Show all tracked Roblox Place IDs"
        )

].map(command => command.toJSON());

// ========================================
// REGISTER SLASH COMMANDS
// ========================================

async function registerCommands() {

    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;

    if (!token) {
        console.log(
            "ERROR: DISCORD_TOKEN is missing."
        );
        return;
    }

    if (!clientId) {
        console.log(
            "ERROR: CLIENT_ID is missing from .env"
        );
        return;
    }

    if (!guildId) {
        console.log(
            "ERROR: GUILD_ID is missing from .env"
        );
        return;
    }

    const rest = new REST({
        version: "10"
    }).setToken(token);

    try {

        console.log(
            "Registering Discord slash commands..."
        );

        const data = await rest.put(
            Routes.applicationGuildCommands(
                clientId,
                guildId
            ),
            {
                body: commands
            }
        );

        console.log(
            `Registered ${data.length} slash commands.`
        );

    } catch (error) {

        console.log(
            "ERROR registering slash commands:"
        );

        console.log(error);
    }
}

// ========================================
// SLASH COMMAND HANDLER
// ========================================

client.on(
    "interactionCreate",
    async interaction => {

        if (!interaction.isChatInputCommand()) {
            return;
        }

        // ====================================
        // /track
        // ====================================

        if (interaction.commandName === "track") {

            const placeId =
                interaction.options.getString(
                    "place_id"
                ).trim();

            if (!/^\d+$/.test(placeId)) {

                await interaction.reply({
                    content:
                        "❌ That isn't a valid Roblox Place ID.",
                    ephemeral: true
                });

                return;
            }

            if (trackedPlaces[placeId]) {

                await interaction.reply({
                    content:
                        `⚠️ Place ID **${placeId}** is already being tracked.`,
                    ephemeral: true
                });

                return;
            }

            trackedPlaces[placeId] = {
                addedAt: new Date().toISOString(),
                version: null
            };

            saveTrackedPlaces();

            const embed =
                new EmbedBuilder()
                    .setTitle("🎮 Place Tracking Started")
                    .setDescription(
                        `Now tracking Roblox Place ID **${placeId}**.`
                    )
                    .addFields(
                        {
                            name: "Place ID",
                            value: `\`${placeId}\``,
                            inline: true
                        },
                        {
                            name: "Status",
                            value: "🟢 Tracking",
                            inline: true
                        }
                    )
                    .setFooter({
                        text: "Roblox Place Tracker"
                    })
                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

            console.log(
                `Started tracking Place ID: ${placeId}`
            );

            return;
        }

        // ====================================
        // /untrack
        // ====================================

        if (
            interaction.commandName ===
            "untrack"
        ) {

            const placeId =
                interaction.options.getString(
                    "place_id"
                ).trim();

            if (!trackedPlaces[placeId]) {

                await interaction.reply({
                    content:
                        `❌ Place ID **${placeId}** isn't being tracked.`,
                    ephemeral: true
                });

                return;
            }

            delete trackedPlaces[placeId];

            saveTrackedPlaces();

            const embed =
                new EmbedBuilder()
                    .setTitle("🛑 Place Tracking Stopped")
                    .setDescription(
                        `Stopped tracking Roblox Place ID **${placeId}**.`
                    )
                    .setFooter({
                        text: "Roblox Place Tracker"
                    })
                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

            console.log(
                `Stopped tracking Place ID: ${placeId}`
            );

            return;
        }

        // ====================================
        // /tracked
        // ====================================

        if (
            interaction.commandName ===
            "tracked"
        ) {

            const ids =
                Object.keys(trackedPlaces);

            if (ids.length === 0) {

                await interaction.reply({
                    content:
                        "📭 No Roblox places are currently being tracked."
                });

                return;
            }

            const list =
                ids
                    .map(
                        (id, index) =>
                            `**${index + 1}.** \`${id}\``
                    )
                    .join("\n");

            const embed =
                new EmbedBuilder()
                    .setTitle("📋 Tracked Roblox Places")
                    .setDescription(list)
                    .addFields({
                        name: "Total",
                        value: `${ids.length}`,
                        inline: true
                    })
                    .setFooter({
                        text: "Roblox Place Tracker"
                    })
                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

            return;
        }
    }
);

// ========================================
// BOT READY
// ========================================

client.once(
    "ready",
    async () => {

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            "       ROBLOX TRACKER ONLINE"
        );
        console.log(
            "================================"
        );

        console.log(
            `Discord bot: ${client.user.tag}`
        );

        console.log("");

        await registerCommands();

        console.log("");

        for (
            const username of ROBLOX_USERS
        ) {

            console.log(
                `Looking up ${username}...`
            );

            const userId =
                await getRobloxUserId(
                    username
                );

            if (userId) {

                robloxUserIds.set(
                    username,
                    userId
                );

                console.log(
                    `${username} -> ${userId}`
                );
            }
        }

        console.log("");

        const channel =
            await getNotificationChannel();

        if (channel) {

            console.log(
                `Notification channel: #${channel.name}`
            );
        }

        console.log("");

        await checkUsers();

        setInterval(
            checkUsers,
            CHECK_INTERVAL
        );

        console.log(
            "Roblox tracking is active."
        );

        console.log(
            "Checking every 30 seconds."
        );

        console.log(
            `Tracked places: ${Object.keys(trackedPlaces).length}`
        );

        console.log("");
    }
);

// ========================================
// LOGIN
// ========================================

client.login(
    process.env.DISCORD_TOKEN
);