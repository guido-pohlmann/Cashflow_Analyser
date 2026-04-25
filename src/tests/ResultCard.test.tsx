import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultCard } from "@/components/ResultCard";
import type { CashflowResult } from "@/lib/schema";

const SAMPLE: CashflowResult = {
  company: "Nvidia Corp",
  period: "Q4 FY25",
  currency: "USD",
  figures: {
    operating: 16.6,
    investing: -3.7,
    financing: -2.1,
    freeCashflow: 12.9,
    unit: "billion",
  },
  verdict: "positive",
  interpretation:
    "Stark positiver operativer Cashflow weit über den Investitions- und Finanzierungsabflüssen. Free Cashflow zweistellig.",
  confidence: "high",
  sourceUrl: "https://example.com",
  analyzedAt: "2026-04-25T12:00:00.000Z",
  warnings: [],
};

describe("ResultCard", () => {
  it("renders all four figure labels", () => {
    render(<ResultCard data={SAMPLE} onReset={() => {}} />);
    expect(screen.getByText("Operativer Cashflow")).toBeInTheDocument();
    expect(screen.getByText("Investitions-Cashflow")).toBeInTheDocument();
    expect(screen.getByText("Finanzierungs-Cashflow")).toBeInTheDocument();
    expect(screen.getByText("Free Cashflow")).toBeInTheDocument();
  });

  it("marks negative values with data-negative=true", () => {
    const { container } = render(
      <ResultCard data={SAMPLE} onReset={() => {}} />,
    );
    const negatives = container.querySelectorAll('[data-negative="true"]');
    // investing (-3.7) and financing (-2.1) → 2 negative cells
    expect(negatives.length).toBe(2);
  });

  it("renders verdict badge with data-verdict attribute", () => {
    const { container } = render(
      <ResultCard data={SAMPLE} onReset={() => {}} />,
    );
    expect(container.querySelector('[data-verdict="positive"]')).toBeTruthy();
  });

  it("calls onReset when reset button clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<ResultCard data={SAMPLE} onReset={onReset} />);
    await user.click(
      screen.getByRole("button", { name: /neue url analysieren/i }),
    );
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("shows the disclaimer", () => {
    render(<ResultCard data={SAMPLE} onReset={() => {}} />);
    expect(screen.getByText(/keine anlageberatung/i)).toBeInTheDocument();
  });

  it("links to source URL with target=_blank and rel=noopener", () => {
    render(<ResultCard data={SAMPLE} onReset={() => {}} />);
    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("renders warnings when present", () => {
    const withWarnings: CashflowResult = {
      ...SAMPLE,
      warnings: ["Quelle ist Pressemitteilung, kein vollständiger Bericht"],
    };
    render(<ResultCard data={withWarnings} onReset={() => {}} />);
    expect(screen.getByText(/pressemitteilung/i)).toBeInTheDocument();
  });
});
