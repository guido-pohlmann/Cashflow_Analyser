import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UrlAnalyzerCard } from "@/components/UrlAnalyzerCard";
import type { CashflowResult } from "@/lib/schema";

const VALID_RESULT: CashflowResult = {
  company: "ACME Corp",
  period: "Q4 FY25",
  currency: "USD",
  figures: {
    operating: 15.2,
    investing: -3.4,
    financing: -1.8,
    freeCashflow: 11.8,
    unit: "billion",
  },
  verdict: "positive",
  interpretation:
    "Der operative Cashflow ist mit 15,2 Mrd. USD deutlich positiv und übersteigt die Investitions- und Finanzierungsabflüsse, was zu einem starken freien Cashflow von 11,8 Mrd. USD führt.",
  confidence: "high",
  sourceUrl: "https://example.com",
  sourceMediaType: "text/html",
  requestedQuery: "ACME",
  sourceResolved: true,
  analyzedAt: "2026-04-26T10:00:00.000Z",
  warnings: [],
};

function mockFetchOk(data: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchError(status: number, code: string) {
  const fn = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { code, message: "x" } }),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("UrlAnalyzerCard", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows inline error on empty submit", async () => {
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    await user.click(screen.getByRole("button", { name: /analysieren/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/firmenname/i);
  });

  it("transitions idle → loading → success on company-name query", async () => {
    const fetchMock = mockFetchOk(VALID_RESULT);
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    const input = screen.getByLabelText(/firmenname/i);
    await user.type(input, "ACME");
    await user.click(screen.getByRole("button", { name: /analysieren/i }));

    expect(
      await screen.findByText("Operativer Cashflow", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyze",
      expect.objectContaining({ method: "POST" }),
    );
    const callArgs = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(callArgs.body)).toEqual({ query: "ACME" });
  });

  it("transitions idle → loading → success on URL query", async () => {
    mockFetchOk({ ...VALID_RESULT, sourceResolved: false });
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    await user.type(
      screen.getByLabelText(/firmenname/i),
      "https://example.com/q4",
    );
    await user.click(screen.getByRole("button", { name: /analysieren/i }));

    expect(
      await screen.findByText("Operativer Cashflow", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("renders ErrorMessage with mapped copy on API error", async () => {
    mockFetchError(422, "NO_SOURCE_FOUND");
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    await user.type(
      screen.getByLabelText(/firmenname/i),
      "asdf zzz",
    );
    await user.click(screen.getByRole("button", { name: /analysieren/i }));

    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(/keine cashflow-quelle gefunden/i);
    expect(alert).toHaveAttribute("data-error-code", "NO_SOURCE_FOUND");
  });

  it("input has aria-invalid when there is an inline error", async () => {
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    const input = screen.getByLabelText(/firmenname/i);
    expect(input).toHaveAttribute("aria-invalid", "false");
    await user.click(screen.getByRole("button", { name: /analysieren/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
