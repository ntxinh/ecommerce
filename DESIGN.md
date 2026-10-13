# DESIGN.md — MarketFlow visual system

**Status: Implemented (tokens + conventions); marketing/landing polish Planned**

## Brand principles

Marketplace-first, utilitarian-clean: strong product imagery, clear price
hierarchy, predictable controls. No decorative gradients, no gratuitous
animation, no generic-admin-template look. Density favors browsing and table
work over marketing flourish.

## Color tokens

All colors are CSS custom properties mapped through `@theme inline` in
`src/app/globals.css` (shadcn `radix-nova` style, `neutral` base, `oklch`
values). Use the semantic utilities — never raw hex/oklch in components:

`background`, `foreground`, `card`, `popover`, `primary`, `secondary`,
`muted`, `accent`, `destructive`, `border`, `input`, `ring`, plus `sidebar-*`
and `chart-1..5`. Each has a paired `-foreground` where applicable
(e.g. `bg-primary text-primary-foreground`). Dark mode overrides live in the
`.dark` block of the same file (`@custom-variant dark (&:is(.dark *))`).

## Typography

- `--font-sans` (Geist Sans) is the default; `--font-mono` (Geist Mono) for
  code/SKUs/ids; `--font-heading` maps to sans.
- Hierarchy via Tailwind scale (`text-sm` secondary/muted, `text-base` body,
  `text-lg`–`3xl` headings); pair muted text with `text-muted-foreground`.

## Spacing, radii, shadows

- Spacing: Tailwind default 4px scale; page sections typically `space-y-6`,
  cards `p-6`, dense tables `p-3`.
- Radii derive from `--radius` (base) with `--radius-sm` (0.6×) through
  `--radius-4xl` (2.6×); use `rounded-md`/`rounded-lg` for controls/cards.
- Shadows come from the shadcn component presets (`shadow-sm` on cards); do
  not invent new shadow tokens.

## Breakpoints

Tailwind defaults; design targets per spec §18:

| Target | px | Notes |
|---|---|---|
| Small mobile | 320–375 | drawers/bottom sheets, stacked layouts |
| Mobile | 390–430 | simplified tables |
| Tablet (`md`) | 768 | two-col grids appear |
| Laptop (`lg`/`xl`) | 1024–1440 | full nav + filter sidebars |
| Desktop (`2xl`) | 1920 | max-width containers |

Never just shrink a desktop layout for mobile — swap to drawer/stack
patterns.

## Component conventions

- Generated primitives live in `src/components/ui` (shadcn/ui →
  `radix-ui` package, `cva` variants, `cn()` from `@/lib/utils`). Extend via
  `cva` variants, not prop-conditional class strings.
- App-level reusables in `src/components/shared/` (e.g. `site-header`,
  `theme-switcher`, `locale-switcher`); domain client code in
  `src/features/<domain>/`.
- Icons: `lucide-react` only. Toasts: `sonner`.
- Async UI: `Skeleton` for loading, typed empty states, inline field errors
  wired with `aria-describedby` (see `src/features/auth/ui.tsx` pattern).

## Theme behavior

`next-themes` class strategy + inline init script — Light/Dark/System, no
flash on load. Components must read token utilities only; both themes must
pass a visual check for every new component.

## Accessibility

- Target WCAG 2.2 AA: visible focus rings (`focus-visible` ring token),
  semantic HTML, accessible names on icon-only buttons (`aria-label`),
  dialog focus management (radix handles), `prefers-reduced-motion` honored.
- Form errors: `aria-describedby` + `aria-invalid`; status announcements for
  async results.
- Contrast: always pair color tokens with their `-foreground`.

## Page layout principles

- Locale segment wraps everything: `app/[locale]/{(storefront),(auth),seller,admin}`.
- Shells provide header/footer + guard; pages stay data-focused.
- Max-width content container centered; storefront uses full-width bands.

## Approved / discouraged

✔ `bg-card text-card-foreground rounded-lg border p-6`
✔ `text-muted-foreground` for secondary text
✔ Drawer/`Sheet` for mobile nav & filters
✘ Hardcoded colors (`#fff`, `oklch(...)` in components)
✘ `dark:` variant classes — the `.dark` custom variant + tokens handle it
✘ Animating layout properties; custom shadows; decorative gradients
