// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "../theme-toggle";
import { describe, it, expect, vi } from "vitest";
import * as nextThemes from "next-themes";

// Mock next-themes
vi.mock("next-themes", async () => {
  const actual = await vi.importActual("next-themes");
  return {
    ...actual,
    useTheme: vi.fn(),
  };
});

describe("ThemeToggle", () => {
  it("calls setTheme to dark when current theme is light", () => {
    // given
    const setThemeMock = vi.fn();
    (nextThemes.useTheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      theme: "light",
      setTheme: setThemeMock,
    });

    // when
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });
    fireEvent.click(button);

    // then
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("calls setTheme to light when current theme is dark", () => {
    // given
    const setThemeMock = vi.fn();
    (nextThemes.useTheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      theme: "dark",
      setTheme: setThemeMock,
    });

    // when
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle theme/i });
    fireEvent.click(button);

    // then
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });
});
