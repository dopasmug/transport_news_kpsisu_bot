import { Bot, CommandContext, Context, Keyboard, InlineKeyboard } from "grammy";
import { parseFeed } from "rss";
import {
    truncateText,
    writeLatestURL,
    users,
    loadUsers,
    saveUsers,
    loadUserMode,
    saveUserMode
} from "./data.ts";
import { DOMParser } from "deno-dom";
import { HearsContext } from "grammy-context";
import { translate } from "google-translate";

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
const mainKeyboard = new Keyboard()
    .text("📰 Последняя статья")
    .text("⚙️ Выбрать режим")
    .row()
    .text("ℹ️ Информация о боте и его командах")
    .text("❌ Отключить бота")
    .resized();

const translateInlineButton = new InlineKeyboard()
    .text("🌐 Перевести", "translate");

// Reading all RSS feeds
async function readFeeds(mode: "kz" | "world"): Promise<Set<string>> {
    const feedsJSON = await Deno.readTextFile(`./resources/${mode}_feeds.json`);
    const feeds = JSON.parse(feedsJSON);
    return feeds;
}

async function isRelevantNews(text: string): Promise<boolean> {
    const keywordsJSON = await Deno.readTextFile("./resources/keywords.json");
    const keywords = JSON.parse(keywordsJSON);

    const normalizedText = text.toLowerCase();
    return keywords.some((word: string) => normalizedText.includes(word.toLowerCase()));
}

// Displaying the most recent news from a single RSS feed
async function getLatestNews(feedURL: string, mode: "kz" | "world") {
    const feeds = await readFeeds(mode);

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
        await console.log(feeds.indexOf(feedURL) + 1, "|", latestDate, "|", lastPublished, `| ${mode}`, "-", "No news available");
    } catch (_) {
        console.log("Ошибка обработки запроса. Возможна проблема с подключением к интернету");
    }
}

// Collecting and parsing RSS feeds
async function checkAllFeeds() {
    await checkFeed("kz");
    await checkFeed("world");
}

async function checkFeed(mode: "kz" | "world") {
    const feeds = await readFeeds(mode);

    for (const url of feeds) {
        const latest = await getLatestNews(url, mode);
        const users = await loadUsers();
        const userMode = await loadUserMode();
        
        if (latest) {
            const title = latest.title?.value || "Без названия";
            const link = latest.links?.[0]?.href || "";
            const description = truncateText(
                latest.description?.value || "",
                512
            ) || "";

            const messageDom = new DOMParser().parseFromString(
                `${title}\n${description}`,
                "text/html"
            );
            const message = messageDom.textContent
                .replace("<p>", "")
                .replace("</p>", "")
                .replace(/<\/?font[^>]*>/gi, "")
                .replace("&nbsp;", "");
            
            const JSONNews = {
                title: title,
                url: link
            }
            
            if ( await isRelevantNews(message) ) {
                for (const [id, selectUserMode] of Object.entries(userMode)) {
                    try {
                        for (const user of users) {
                            if (+id == user && selectUserMode == mode) {
                                writeLatestURL(JSONNews, mode);
                                await bot.api.sendMessage(id,
                                    `${title}\n<a href="${link}">🔗 Ссылка на источник</a>`,
                                    { parse_mode: "HTML", reply_markup: translateInlineButton }
                                );
                            }
                        }
                    } catch (e) {
                        console.error(`Error sending to ${id}: `, e);
                        console.log("Новость не дошла до пользователей: ", title);
                        break;
                    }
                }
                console.log("Article sent: ", title);
            }
        }
    }
}

function startBot(context: HearsContext<Context> | CommandContext<Context>): void {
    const chatId = context.chat.id;
    if (users.has(chatId)) {
        context.reply("<i>Уже запущен</i>", { parse_mode: "HTML", reply_markup: mainKeyboard });
    } else {
        users.add(chatId);
        saveUsers(users);
        context.reply("<i>Бот запущен! Рассылка новостей включена</i>\nНачат сбор новостных лент...", { parse_mode: "HTML", reply_markup: mainKeyboard });
        console.log("New user added: " + context.chat.id);
    }
}

function stopBot(context: HearsContext<Context> | CommandContext<Context>): void {
    const startKeyboard = new Keyboard()
        .text("⭕️ Запустить бота")
        .resized()
    
    const chatId = context.chat.id;
    if (users.delete(chatId)) {
        saveUsers(users);
        context.reply(
            "<i>Рассылка новостей отключена</i>\nВы всё ещё можете воспользоваться командой /latest, чтобы получить на данный момент самую актуальную новость",
            { parse_mode: "HTML", reply_markup: startKeyboard }
        );
        console.log("User deleted: " + context.chat.id);
    } else {
        context.reply("<i>Уже отключен</i>", { parse_mode: "HTML" });
    }
}

async function showLatestArticle(context: HearsContext<Context> | CommandContext<Context>, mode: "kz" | "world"): Promise<void> {
    const latestNewsJSON = await Deno.readTextFile(`./resources/latest_${mode}_article.json`);
    const latestNews = JSON.parse(latestNewsJSON);

    const title = latestNews.title;
    const link = latestNews.url;

    context.reply(`${title}\n<a href="${link}">🔗 Ссылка на источник</a>`, { parse_mode: "HTML", reply_markup: translateInlineButton });
}

async function showHelpMessage(context: HearsContext<Context> | CommandContext<Context>): Promise<void> {
    try {
        const message = await Deno.readTextFile("./resources/help.md");
        context.reply(message, { parse_mode: "Markdown" });
    } catch {
        console.log('%cОшибка парсинга Markdown "help.md"', "color: yellow");
        context.reply("<i>Команда временно недоступна</i>", { parse_mode: "HTML" });
    }
}

async function chooseOnlyKZMode(context: HearsContext<Context> | CommandContext<Context>): Promise<void> {
    const mode = await loadUserMode();
    const id = context.chat.id;
    
    mode[id] = "kz";
    await saveUserMode(mode);

    context.reply("Выбран режим: <b>🇰🇿 Только Казахстан</b>", { parse_mode: "HTML", reply_markup: mainKeyboard });
}

async function chooseWorldMode(context: HearsContext<Context> | CommandContext<Context>): Promise<void> {
    const mode = await loadUserMode();
    const id = context.chat.id;

    mode[id] = "world";
    await saveUserMode(mode);

    context.reply("Выбран режим: <b>🌎 Все страны</b>", { parse_mode: "HTML", reply_markup: mainKeyboard });
}

bot.command("latest", async ctx => {
    const mode = await loadUserMode();
    const id = ctx.chat.id;
    
    await showLatestArticle(ctx, mode[id]);
});

bot.command("start", async ctx => {
    const mode = await loadUserMode();
    const id = ctx.chat.id;

    if (!mode[id]) {
        mode[id] = "world";
        await saveUserMode(mode);
    }

    await startBot(ctx);
});

bot.command("help", ctx => {
    showHelpMessage(ctx);
});

bot.command("stop", async ctx => {
    await stopBot(ctx)
});

bot.command("world_mode", ctx => {
    chooseWorldMode(ctx);
});

bot.command("kz_mode", ctx => {
    chooseOnlyKZMode(ctx);
});

// Admin commands
bot.command("article", async ctx => {
    const users = await loadUsers();
    const text = ctx.message?.text;

    if (!text) {
        return ctx.reply("<i>Некорректная команда</i>", { parse_mode: "HTML" })
    }

    const args = text?.split(" ");

    const userMode = await loadUserMode();

    const selectMode = args[1];
    const titleParts = args.slice(2, args.length - 1);
    const title = titleParts.join(" ");
    const url = args[args.length - 1];

    const message = `${title}\n<a href="${url}">🔗 Ссылка на источник</a>`;

    const JSONNews = {
        title: title,
        url: url
    }

    for (const [id, mode] of Object.entries(userMode)) {
        try {
            for (const user of users) {
                if (selectMode == mode && +id == user) {
                    await bot.api.sendMessage(id, message, { parse_mode: "HTML", reply_markup: translateInlineButton });
                    switch (mode) {
                        case "kz":
                            writeLatestURL(JSONNews, "kz");
                            break;
                        case "world":
                            writeLatestURL(JSONNews, "world");
                            break;
                    }
                }
            }
        } catch (e) {
            console.error(`Error sending to ${id}: `, e);
            console.log("Новость не дошла до пользователей: ", title);
            break;
        }
    }
});
//

bot.hears("⭕️ Запустить бота", async ctx => {
    await startBot(ctx);
});

bot.hears("❌ Отключить бота", async ctx => {
    await stopBot(ctx);
});

bot.hears("📰 Последняя статья", async ctx => {
    const mode = await loadUserMode();
    const id = ctx.chat.id;

    await showLatestArticle(ctx, mode[id]);
});

bot.hears("⚙️ Выбрать режим", async ctx => {
    const chooseModeKeyboard = new Keyboard()
        .text("🌎 Все страны")
        .text("🇰🇿 Только Казахстан")
        .resized();
    await ctx.reply("<i>Выберите режим отображения статей</i>", { parse_mode: "HTML", reply_markup: chooseModeKeyboard });
});

bot.hears("ℹ️ Информация о боте и его командах", ctx => {
    showHelpMessage(ctx);
});

bot.hears("🌎 Все страны", ctx => {
    chooseWorldMode(ctx);
});

bot.hears("🇰🇿 Только Казахстан", ctx => {
    chooseOnlyKZMode(ctx);
});

bot.callbackQuery("translate", async ctx => {
    const msg = ctx.callbackQuery.message;
    const defaultText = msg?.text?.split("\n") || "";
    const translated = await translate(defaultText[0], { to: "ru" } );

    if (msg && msg.entities) {
        for (const entity of msg.entities) {
            if (entity.type === "text_link" && entity.url) {
                await ctx.editMessageText(
                    defaultText[0] + "\n" + `<a href="${entity.url}">🔗 Ссылка на источник</a>` + "\n\n" + "<b>Перевод</b>" + "\n" + translated.text.split("\n")[0],
                    { parse_mode: "HTML" }
                );
            }
        }
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

console.log("%cBot started (Press Ctrl+C to Stop)", "color: green");
bot.start();

// Interval between requests
// Milliseconds * Seconds * Minutes
setInterval(checkAllFeeds, 1000 * 60 * 10);
await checkAllFeeds();

// Method called when the Deno server is shut down
Deno.addSignalListener("SIGINT", async () => {
    const users = await loadUsers();

    if (notifyOnServerStatus) {
        for (const id of users)
            await bot.api.sendMessage(
                id,
                "<i>Сервер бота отключён. Все функции сейчас недоступны. Рассылка приостановлена</i>",
                { parse_mode: "HTML" }
            );
    }
    
    console.log("\n%cBot stopped", "color: yellow");
    Deno.exit();
})