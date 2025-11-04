export function truncateText(text: string, maxLength: number) {
    if (text.length > maxLength)
        return text.slice(0, maxLength) + "...";
}

export async function writeLatestURL(data: any) {
    await Deno.writeTextFile(
        "./resources/latest_article.json",
        JSON.stringify(data, null, 2)
    );
}