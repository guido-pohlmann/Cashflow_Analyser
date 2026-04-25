export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return Response.json(
    {
      error: {
        code: "INTERNAL",
        message: "Analyse-Endpoint noch nicht implementiert (S0-Stub).",
      },
    },
    { status: 501 },
  );
}
