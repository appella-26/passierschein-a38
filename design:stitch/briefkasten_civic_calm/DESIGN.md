---
name: Briefkasten Civic Calm
colors:
  surface: '#faf9f7'
  surface-dim: '#dadad8'
  surface-bright: '#faf9f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f1'
  surface-container: '#efeeec'
  surface-container-high: '#e9e8e6'
  surface-container-highest: '#e3e2e0'
  on-surface: '#1a1c1b'
  on-surface-variant: '#42474c'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1ef'
  outline: '#73787d'
  outline-variant: '#c2c7cc'
  surface-tint: '#466275'
  primary: '#042436'
  on-primary: '#ffffff'
  primary-container: '#1e3a4c'
  on-primary-container: '#88a4b9'
  inverse-primary: '#aecae1'
  secondary: '#2c694e'
  on-secondary: '#ffffff'
  secondary-container: '#aeeecb'
  on-secondary-container: '#316e52'
  tertiary: '#381a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#572c00'
  on-tertiary-container: '#ed861e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cae6fd'
  primary-fixed-dim: '#aecae1'
  on-primary-fixed: '#001e2e'
  on-primary-fixed-variant: '#2e4a5c'
  secondary-fixed: '#b1f0ce'
  secondary-fixed-dim: '#95d4b3'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#0e5138'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#faf9f7'
  on-background: '#1a1c1b'
  surface-variant: '#e3e2e0'
typography:
  headline-xl:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Newsreader
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 30px
  headline-sm:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.5rem
  gutter-desktop: 2rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

The design system embodies a modern editorial civic tech perspective: a calm, competent companion cutting through the anxiety of German bureaucratic correspondence (*Behördenpost*). The emotional intent is reassurance, total privacy, clarity, and sovereign authority without institutional coldness. 

To break away from synthetic, ephemeral AI tropes, this design system rejects purple gradients, ambient sparkle glyphs, and decorative floating glassmorphism. It is anchored instead in grounded tactile minimalism and refined editorial restraint. Visual structures borrow from high-grade physical stationery, Swiss civic design, and architectural clarity: solid flat foundations, crisp 1px borders, purposeful white cards atop a warm porcelain ground, and typographic pacing optimized for the rhythm of compound German nouns.

## Colors

The palette establishes institutional dependability balanced by warm, humanistic undertones. The default mode is light, echoing physical archival paper and natural daylight readability.

- **Primary (`#1E3A4C`)**: Warm deep petrol slate. Conveys legal gravitas, security, and administrative rigor without the clinical sterility of standard enterprise blue.
- **Secondary (`#2D6A4F`)**: Deep forest sage. Represents low urgency, safe administrative resolution, verified compliance, and resolved actions.
- **Tertiary (`#D97706`)**: Warm honey amber. Directs focused attention to actionable administrative deadlines (*Fristen*), missing attachments, and statutory waiting windows.
- **Neutral Canvas (`#F9F8F6`)**: Warm porcelain/calcified linen ground that mitigates harsh display glare and supports pure white card surfaces (`#FFFFFF`).
- **Semantic Urgency Tokens**:
  - *High Urgency / Legal Deadline*: Warm crimson (`#C53030`). Strictly reserved for immediate legal consequences, final payment demands (*Mahnung*), or legal appeal windows (*Widerspruchsfrist*).
  - *Medium Urgency / Action Needed*: Warm amber (`#D97706`). For upcoming dates and pending verifications.
  - *Low Urgency / Informational*: Calming forest sage (`#2D6A4F`) and muted slate (`#475569`). For archival notes, informational letters, and completed obligations.
- **Structural Outlines**: Crisp tactile borders (`#E2E8F0` / `#E5E2DC`) preserve defined spatial edges under varied ambient light.

## Typography

The typographic system creates an interplay between editorial authority and humane accessibility:
- **Headlines (Newsreader)**: Evokes the quiet credibility of established broadsheets, official gazettes, and legal literature without anachronistic ornament. Used for letter titles, executive summaries, and key takeaway headers.
- **Body & Labels (Plus Jakarta Sans)**: Delivers geometric clarity and open apertures. Generous default line-heights (`1.6x` to `1.65x`) are mandated to comfortably accommodate long German compound words (e.g., *Rechtsbehelfsbelehrung*, *Einkommensteuerbescheid*, *Versicherungsvertragsnummer*) without tight collisions or awkward hyphenation breaks. Text blocks must enable soft hyphenation (`hyphens: auto; lang: de;`) on narrow viewports.

## Layout & Spacing

A mobile-first fluid layout prioritizing immediate one-thumb comprehension during stressful letter appraisal:
- **Canvas & Margins**: Mobile viewports utilize an unyielding `16px` (`1rem`) outer canvas margin to preserve maximum horizontal line-length for complex prose. Tablet screens widen margins to `32px` (`2rem`), while desktop views cap main reading containers at a focused `720px` to `840px` column width to prevent unreadable, over-extended line lengths.
- **Vertical Rhythm**: Generous paragraph spacing (`space-md` to `space-lg`) prevents dense document summaries from appearing intimidating. Stacked metadata pairs (sender, agency reference, statutory date) use consistent `space-xs` and `space-sm` increments for rapid scannability.

## Elevation & Depth

Visual hierarchy uses physical material separation over synthetic depth:
- **Tonal Layers & Tactile Surfaces**: Background elements sit directly on the warm neutral canvas (`#F9F8F6`). Cards and interactive panels sit on pure `#FFFFFF` layers bordered by a 1px solid stroke (`#E2E8F0` or `#E5E2DC`).
- **Restrained Shadows**: Avoid multi-stage diffuse ambient drops. When interactive cards or drawers rise (e.g., sheet modals during letter scanning or action menus), employ a single, tight, tinted shadow: `box-shadow: 0 4px 16px -2px rgba(30, 58, 76, 0.07), 0 1px 3px rgba(30, 58, 76, 0.04)`. The tint derives from the deep petrol primary rather than neutral black, preserving an organic, paper-like presence.
- **No Glassmorphism**: Translucent backdrops and blur filters are strictly prohibited in letter presentation to preserve high typographic contrast and text fidelity.

## Shapes

The geometry strikes a balance between approachable friendliness and document-grade discipline:
- **Card Containers**: Configured with `rounded-2xl` (`1rem` / `16px`) corners, framing complex correspondence in clean, humanized paper-like units.
- **Buttons & Form Fields**: Configured with `rounded-xl` (`0.75rem` / `12px`), establishing distinct tactile tap surfaces.
- **Status Badges & Urgent Pills**: Configured with `rounded-full` (`9999px`) to immediately set them apart from rectangular content blocks.
- **Stroke Rules**: All shapes feature a uniform 1px structural outer border to ground them cleanly against the off-white canvas.

## Components

All interactive elements must guarantee an absolute minimum tap target area of **48 × 48px** for stress-free mobile manipulation.

### Buttons
- **Primary Action**: Solid `#1E3A4C` background with `#FFFFFF` text. Height is 48px to 52px, radius is `rounded-xl`, font is `label-lg`. Micro-press effect gives a subtle scale transform (`scale(0.99)`) with no artificial shine.
- **Secondary / Urgent Response**: High-urgency action buttons utilize solid terracotta crimson (`#C53030`) with white text (e.g., "Widerspruch einlegen" / Submit Appeal).
- **Tertiary / Subdued**: Clean 1px border (`#E2E8F0`) with white background, `#1E3A4C` text, and subtle hover tint (`#F1F5F9`).

### Urgency Chips & Status Pills
- Compact, pill-shaped tags (`rounded-full`) with uppercase or strong medium tracking (`label-sm`).
- **Urgent (Red)**: Background `#FEF2F2`, border 1px solid `#FCA5A5`, text `#C53030`.
- **Pending/Action (Amber)**: Background `#FFFBEB`, border 1px solid `#FCD34D`, text `#B45309`.
- **Safe/Resolved (Green)**: Background `#F0FDF4`, border 1px solid `#86EFAC`, text `#2D6A4F`.
- **Neutral/Archive (Slate)**: Background `#F8FAFC`, border 1px solid `#CBD5E1`, text `#475569`.

### Letter Cards (*Dokumenten-Karten*)
- Pure `#FFFFFF` base, `rounded-2xl` contour, with 1px border in `#E5E2DC`.
- Padding is strictly `space-lg` (`24px`). Cards display a top metadata bar (Sender agency name in `label-md`, receipt date in muted slate, urgency chip anchored top-right), followed by the editorial translated summary in `headline-sm` / `body-md`.

### Input Fields & Upload Drag-Drop
- Minimum field height of 48px with `rounded-xl` borders in `#CBD5E1`. Active state shifts border to 2px `#1E3A4C` without harsh blue outer glow rings.
- Upload/Camera input uses an inviting dashed stroke (2px `#94A3B8`) over `#FFFFFF` with clear, plain German instructions (*"Brief fotografieren oder PDF ablegen"*).

### Checkboxes & Segmented Controls
- Checkboxes are 24 × 24px with 48px interactive touch padding, `rounded-md` (4px), using `#1E3A4C` fill when active.
- Segmented switches (e.g., "Einfaches Deutsch" vs. "Originaltext") use pill containers (`rounded-full`) with `#F1F5F9` troughs and sliding `#FFFFFF` tabs bounded by fine hairline borders.

### Deadline Banner (*Fristen-Warner*)
- A dedicated alert component pinned to urgent documents. Features a left-side 4px solid accent bar (in `#C53030` or `#D97706`), porcelain/tinted surface, explicit day counter (*"Noch 4 Tage"*), and a one-tap primary action button.