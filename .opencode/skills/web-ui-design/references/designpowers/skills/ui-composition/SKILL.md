---
name: ui-composition
description: Use when building layouts, choosing colours, setting typography, establishing visual hierarchy, designing responsive behaviour, or making any visual design decision — ensures every visual choice serves both aesthetics and accessibility
---

# UI Composition

Visual design is where intent becomes tangible. Every colour, every spacing decision, every typographic choice either includes or excludes people. This skill ensures visual decisions are principled, systematic, and inclusive.

## When to Use

- Designing screen layouts or page structures
- Choosing or refining colour palettes
- Setting typography systems
- Establishing spacing and grid systems
- Designing for responsive breakpoints
- Creating or modifying visual hierarchy
- Designing dark mode or high contrast variants

## Process

### Step 1: Reference the Foundation

Before making visual decisions, confirm you have:
- Design brief or strategy (from earlier phases)
- Personas (especially ability spectrum considerations)
- Existing design system (invoke `design-system-alignment` if one exists)

### Step 2: Layout and Structure

**Grid system:**
- Define columns, gutters, and margins
- Ensure the grid adapts across breakpoints (mobile, tablet, desktop)
- Test that content reflows sensibly when zoomed to 200%

**Visual hierarchy:**
- Establish a clear reading order that works both visually and in the DOM
- Ensure the hierarchy communicates through structure, not colour alone
- Verify that removing all colour still leaves a readable, navigable page

**Spacing system:**
- Use a consistent spacing scale (e.g., 4px base)
- Ensure touch targets are at least 44x44px
- Provide adequate spacing between interactive elements to prevent accidental activation

### Step 3: Colour

**Palette construction:**
- Define primary, secondary, neutral, and semantic colours (success, warning, error, info)
- Every colour pairing must meet WCAG AA contrast ratios minimum (4.5:1 for text, 3:1 for large text and UI components)
- Target WCAG AAA (7:1) where feasible

**Colour independence:**
- Never convey information through colour alone
- Always pair colour with text labels, icons, or patterns
- Test with simulated colour blindness (protanopia, deuteranopia, tritanopia)

**Dark mode / high contrast:**
- If applicable, design dark mode as a first-class experience, not an afterthought
- Ensure all contrast ratios hold in both modes
- Respect `prefers-color-scheme` and `prefers-contrast` media queries

### Step 4: Typography

**Type scale:**
- Define a modular scale with clear hierarchy (heading levels, body, caption, label)
- Base body size: minimum 16px (1rem)
- Line height: 1.5 for body text, 1.2-1.3 for headings

**Readability:**
- Line length: 45-75 characters for body text
- Paragraph spacing: at least 1.5x the font size
- Avoid justified text (ragged right is more readable for most people)
- Ensure text can be resized to 200% without loss of content or functionality

**Font selection:**
- Prioritise legibility over personality
- Ensure the chosen font has distinct characters for I, l, 1 and O, 0
- Provide fallback fonts in the same classification

### Step 5: Responsive Design

Design for these breakpoints (adjust to project needs):
- **Mobile** (320-480px): single column, stacked layout, thumb-reachable interactions
- **Tablet** (481-1024px): flexible layout, touch and pointer support
- **Desktop** (1025px+): multi-column, keyboard and pointer optimised

At every breakpoint:
- Content priority remains correct
- Touch targets remain adequate
- Text remains readable without horizontal scrolling
- No information is hidden that was visible at other breakpoints (unless intentionally progressive)

### Step 6: Document Decisions

For each visual decision, document:
- **What:** the decision made
- **Why:** how it serves the design principles and personas
- **Accessibility:** how it meets inclusive design requirements

## Integration

- **Called by:** `writing-design-plans` (as part of plan execution)
- **Pairs with:** `design-system-alignment` (for consistency), `cognitive-accessibility` (for visual load), `adaptive-interfaces` (for user preferences)
- **Reviewed by:** `designpowers-critique`

## Quick Reference: Accessibility Minimums

| Element | Requirement |
|---------|------------|
| Text contrast | 4.5:1 (AA) or 7:1 (AAA) |
| Large text contrast | 3:1 minimum |
| UI component contrast | 3:1 against adjacent colours |
| Touch target | 44x44px minimum |
| Focus indicator | Visible, 3:1 contrast against adjacent |
| Text resize | Content usable at 200% zoom |
| Colour alone | Never the sole indicator of state or meaning |
