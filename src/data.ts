'use strict'

const usersFile: string = "./resources/users.json";
const userModeFile: string = "./resources/user_mode.json";

export function truncateText(text: string, maxLength: number) {
    if (text.length > maxLength)
        return text.slice(0, maxLength) + "...";
}

export async function writeLatestURL(data: any, mode: "kz" | "world") {
    switch (mode) {
        case "kz":
            await Deno.writeTextFile(
                "./resources/latest_kz_article.json",
                JSON.stringify(data, null, 2)
            );
            break;
        case "world":
            await Deno.writeTextFile(
                "./resources/latest_world_article.json",
                JSON.stringify(data, null, 2)
            );
            break;
    }

}

export const users = await loadUsers();

// Reading all added users
export async function loadUsers(): Promise<Set<number>> {
    try {
        const data = await Deno.readTextFile(usersFile);
        return new Set(JSON.parse(data));
    } catch {
        return new Set();
    }
}

// Adding a user who executed the /start command
export async function saveUsers(subs: Set<number>) {
    await Deno.writeTextFile(
        usersFile,
        JSON.stringify(Array.from(subs), null, "\t")
    );
}

export async function loadUserMode() {
    try {
        const data = await Deno.readTextFile(userModeFile);
        return JSON.parse(data);
    } catch {
        return {};
    }
}

export async function saveUserMode(mode: string) {
    const json = JSON.stringify(mode, null, "\t");
    await Deno.writeTextFile(userModeFile, json);
}