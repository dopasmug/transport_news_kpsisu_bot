import { Bot } from "grammy";
import { parseFeed } from "rss";
import { truncateText, writeLatestURL } from "./data-manager.ts";
import { DOMParser } from "deno-dom";

// Notifying users about the bot server being turned off/on
const notifyOnServerStatus = false;

// Date of the last published news
let lastPublished: Date | null = null;

const TOKEN = Deno.env.get("BOT_TOKEN");

if (!TOKEN) {
    console.log("BOT_TOKEN не найдет в .env", TOKEN);
    Deno.exit(-1);
}

const bot = new Bot(TOKEN);

const users_file = "./resources/users.json";
const users = await loadUsers();

// Reading all RSS feeds
async function readFeeds(): Promise<Set<string>> {
    const feedsJSON = await Deno.readTextFile("./resources/feeds.json");
    const feeds = JSON.parse(feedsJSON);
    return feeds;
}

function isRelevantNews(text: string): boolean {
    const keywords = [
        "дтп",
        "Дорожно-транспортно",
        "железнодорожная авария",
        "авиакатастрофа",
        "падение самолета",
        "авария самолета",
        "дорожная авария"
    ];
    
    const normalizedText = text.toLowerCase();
    return keywords.some(word => normalizedText.includes(word.toLowerCase()));
}

// Reading all added users
async function loadUsers(): Promise<Set<number>> {
    try {
        const data = await Deno.readTextFile(users_file);
        return new Set(JSON.parse(data));
    } catch {
        return new Set();
    }
}

// Adding a user who executed the /start command
async function saveUsers(subs: Set<number>) {
    await Deno.writeTextFile(
        users_file,
        JSON.stringify(Array.from(subs), null, 2)
    );
}

// Displaying the most recent news from a single RSS feed
async function getLatestNews(feedURL: string) {
    const feeds = await readFeeds();

    try {
        const response = await fetch(feedURL);
        const xml = await response.text();
        const feed = await parseFeed(xml);

        if (!feed.entries.length) return null;

        const latest = feed.entries.reduce((latest, entry) => {
            const date = new Date(entry.published || entry.updated || 0);
            const latestDate = new Date(latest.published || latest.updated || 0);
            return date > latestDate ? entry : latest;
        });

        const latestDate = new Date(latest.published || latest.updated || 0);
        
        if (!lastPublished) {
            lastPublished = latestDate;
            return;
        }

        if (latestDate > lastPublished) {
            lastPublished = latestDate;
            return latest;
        }
        // Deno incorrectly points to an error
        await console.log(feeds.indexOf(feedURL) + 1, latestDate, "|", lastPublished, "-", "No news available");
    } catch (_) {
        console.log("Ошибка обработки запроса. Возможна проблема с подключением к интернету");
    }
}

// Collecting and parsing RSS feeds
async function checkFeed() {
    const feeds = await readFeeds();

    for (const url of feeds) {
        const latest = await getLatestNews(url);
        const users = await loadUsers();

        if (latest) {
            const title = latest.title?.value || "Без названия";
            const link = latest.links?.[0]?.href || "";
            const description = truncateText(
                latest.description?.value || "",
                512
            ) || "";

            const messageDom = new DOMParser().parseFromString(
                `${title}\n${description}\n<b>Источник:</b> ${link}`,
                "text/html"
            );
            const message = messageDom.textContent
                .replace("<p>", "")
                .replace("</p>", "")
                .replace(/<\/?font[^>]*>/gi, "")
                .replace("&nbsp;", "");

            if ( isRelevantNews(message) ) {
                for (const id of users) {
                    try {
                        await bot.api.sendMessage(id, message, { parse_mode: "HTML" });
                        writeLatestURL(latest);
                    } catch (e) {
                        console.error(`Error sending to ${id}: `, e);
                        console.log("Новость не дошла до пользователей: ", title);
                        break;
                    }
                }
                console.log("Новость отправлена: ", title);
            }
        }
    }
}

bot.command("latest", async ctx => {
    const latestNewsJSON = await Deno.readTextFile("./resources/latest_article.json");
    const latestNews = JSON.parse(latestNewsJSON);

    const title = latestNews.title?.value;
    const link = latestNews.links?.[0]?.href;
    const description = truncateText(
        latestNews.description?.value || "",
        512
    ) || "";

    const messageDom = new DOMParser().parseFromString(
        `${title}\n${description}\n<b>Источник:</b> ${link}`,
        "text/html"
    );
    const message = messageDom.textContent
        .replace("<p>", "")
        .replace("</p>", "")
        .replace(/<\/?font[^>]*>/gi, "")
        .replace("&nbsp;", "");

    ctx.reply(message, { parse_mode: "HTML"});
});

bot.command("start", ctx => {
    const chatId = ctx.chat.id;
    if (users.has(chatId)) {
        ctx.reply("<i>Уже запущен</i>", { parse_mode: "HTML" });
    } else {
        users.add(chatId);
        saveUsers(users);
        ctx.reply("<i>Бот запущен! Рассылка новостей включена</i>\nНачат сбор новостных лент...", { parse_mode: "HTML" });
        console.log("Добавлен новый пользователь: " + ctx.chat.id);
    }
});

bot.command("help", async ctx => {
    try {
        const message = await Deno.readTextFile("./resources/help.md");
        ctx.reply(message, { parse_mode: "Markdown" });
    } catch {
        console.log('%cОшибка парсинга Markdown "help.md"', "color: yellow");
        ctx.reply("<i>Команда временно недоступна</i>", { parse_mode: "HTML" });
    }
});

bot.command("stop", ctx => {
    const chatId = ctx.chat.id;
    if (users.delete(chatId)) {
        saveUsers(users);
        ctx.reply(
            "<i>Рассылка новостей отключена</i>\nВы всё ещё можете воспользоваться командой /latest, чтобы получить на данный момент самую актуальную новость",
            { parse_mode: "HTML" }
        );
        console.log("Пользователь удалён: " + ctx.chat.id);
    } else {
        ctx.reply("<i>Уже отключен</i>", { parse_mode: "HTML" });
    }
});

// Admin commands
bot.command("check", async ctx => {
    const subscribersJSON = await Deno.readTextFile("./resources/subscribers.json");
    const subscribers = JSON.parse(subscribersJSON);
    const adminsJSON = await Deno.readTextFile("./resources/admins.json");
    const admins = JSON.parse(adminsJSON);
    const access = admins.includes(ctx.chat.id);
    const checkOn = subscribers.includes(ctx.chat.id);

    if (checkOn) {
        if (access) {
            ctx.reply("<i>Новостные ленты обновлены</i>", { parse_mode: "HTML" });
            checkFeed();
        } else {
            ctx.reply("<i>Доступ запрещён. Команда доступна только администраторам.</i>", { parse_mode: "HTML" });
        }
    } else {
        ctx.reply("<i>Бот отключен</i>", { parse_mode: "HTML" });
    }
});

if (notifyOnServerStatus) {
    const subscribers = await loadUsers();

    for (const id of subscribers) {
        await bot.api.sendMessage(
            id,
            "<i>Сервер бота запущен. Все функции стали доступны. Рассылка возобновлена</i>",
            { parse_mode: "HTML" }
        );
    }
}

console.log("%cБот запущен (Сtrl+C для отключения)", "color: green");
bot.start();

// Interval between requests
// Milliseconds * Seconds * Minutes
setInterval(checkFeed, 1000 * 60 * 5);
await checkFeed();

// Method called when the Deno server is shut down
Deno.addSignalListener("SIGINT", async () => {
    const subscribers = await loadUsers();

    if (notifyOnServerStatus) {
        for (const id of subscribers)
            await bot.api.sendMessage(
                id,
                "<i>Сервер бота отключён. Все функции сейчас недоступны. Рассылка приостановлена</i>",
                { parse_mode: "HTML" }
            );
    }

    console.log("%cБот отключен", "color: yellow");
    Deno.exit();
})