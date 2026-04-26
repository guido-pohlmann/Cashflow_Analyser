import { analyzeCashflow } from "@/lib/analyzeCashflow";
import {
  ContentTooShortError,
  InvalidUrlError,
  mapError,
} from "@/lib/errors";
import { extractText } from "@/lib/extractText";
import { fetchPage } from "@/lib/fetchPage";
import { AnalyzeRequest } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = AnalyzeRequest.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidUrlError(
        parsed.error.issues[0]?.message ?? "Ungültige URL.",
      );
    }
    const { url } = parsed.data;

    const page = await fetchPage(url);
    const extracted = extractText(page.bodyHtml, page.finalUrl);
    if (extracted.charCount < 500) {
      throw new ContentTooShortError(
        "Auf der Seite wurden keine auswertbaren Inhalte gefunden.",
      );
    }

    const result = await analyzeCashflow({
      text: extracted.text,
      sourceUrl: page.finalUrl,
    });

    return Response.json(result);
  } catch (error) {
    return mapError(error);
  }
}
