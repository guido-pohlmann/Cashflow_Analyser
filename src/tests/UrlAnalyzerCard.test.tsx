import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UrlAnalyzerCard } from "@/components/UrlAnalyzerCard";

describe("UrlAnalyzerCard", () => {
  it("shows inline error on empty submit", async () => {
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    await user.click(screen.getByRole("button", { name: /analysieren/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/url/i);
  });

  it("rejects non-http(s) protocols client-side", async () => {
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    const input = screen.getByLabelText(/unternehmens-url/i);
    await user.type(input, "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: /analysieren/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/http\(s\)/i);
  });

  it("transitions idle → loading → success on valid URL", async () => {
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    const input = screen.getByLabelText(/unternehmens-url/i);
    await user.type(input, "https://example.com/q4");
    await user.click(screen.getByRole("button", { name: /analysieren/i }));

    // loading state visible immediately
    expect(screen.getByLabelText(/analyse läuft/i)).toBeInTheDocument();

    // success state appears after mock delay
    expect(
      await screen.findByText("Operativer Cashflow", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("input has aria-invalid when there is an inline error", async () => {
    const user = userEvent.setup();
    render(<UrlAnalyzerCard />);
    const input = screen.getByLabelText(/unternehmens-url/i);
    expect(input).toHaveAttribute("aria-invalid", "false");
    await user.click(screen.getByRole("button", { name: /analysieren/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
