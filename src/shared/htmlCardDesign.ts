export const HTML_CARD_CSS = `
:root[data-bs-theme="dark"] { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { background: transparent; }
body { margin: 0; font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: light-dark(oklch(.27 .04 285), oklch(.94 .012 285)); }
.mico-report { display: flex; flex-direction: column; gap: 12px; padding: 22px 24px; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.mico-report h1 { margin: 0; font-size: 20px; line-height: 1.28; letter-spacing: -.015em; font-weight: 750; color: light-dark(oklch(.24 .045 285), oklch(.97 .01 285)); }
.mico-report h2 { margin: 0 0 6px; font-size: 13.5px; line-height: 1.38; font-weight: 700; color: inherit; }
.mico-report h3 { margin: 0 0 4px; font-size: 12.5px; line-height: 1.38; font-weight: 700; color: inherit; }
.mico-report p { margin: 0 0 6px; }
.mico-report p:last-child, .mico-report > p { margin-bottom: 0; }
.mico-eyebrow { color: light-dark(oklch(.47 .035 285), oklch(.76 .02 285)); font-size: 11.5px; font-weight: 600; letter-spacing: .02em; }
.mico-eyebrow + h1 { margin-top: -8px; }
.mico-stack { display: flex; flex-direction: column; gap: 10px; }
.mico-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.mico-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mico-full { grid-column: 1 / -1; }
:where(.mico-panel, .mico-tile, .mico-callout) {
  --mh: 260;
  --mc: .035;
  --ma: .88;
  color: light-dark(oklch(.29 calc(var(--mc) * .85 + .01) var(--mh)), oklch(.93 calc(var(--mc) * .55) var(--mh)));
  background: linear-gradient(158deg, light-dark(oklch(.975 calc(var(--mc) * .45) var(--mh) / var(--ma)), oklch(.34 calc(var(--mc) * .85) var(--mh) / var(--ma))), light-dark(oklch(.915 var(--mc) var(--mh) / var(--ma)), oklch(.26 calc(var(--mc) * .95) var(--mh) / var(--ma))));
  box-shadow: inset 0 1.5px 0 light-dark(oklch(1 0 0 / .84), oklch(1 0 0 / .14)), inset 0 -12px 20px -12px light-dark(oklch(.7 calc(var(--mc) * 1.45) var(--mh) / .42), oklch(.62 calc(var(--mc) * 1.45) var(--mh) / .34)), inset 0 0 0 1px light-dark(oklch(.72 calc(var(--mc) * 1.1) var(--mh) / .24), oklch(.76 calc(var(--mc) * 1.1) var(--mh) / .24)), 0 12px 24px -16px light-dark(oklch(.66 calc(var(--mc) * 1.4) var(--mh) / .38), oklch(0 0 0 / .48));
}
.mico-panel { min-width: 0; padding: 14px 16px; border-radius: 20px; }
.mico-panel > *:last-child { margin-bottom: 0; }
.mico-hero { --mh: 282; --mc: .105; --ma: .94; padding: 16px 18px; }
.mico-hero small { display: block; margin-top: 5px; font-size: 11.5px; color: light-dark(oklch(.42 .065 var(--mh) / .9), oklch(.82 .05 var(--mh) / .9)); }
.mico-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mico-tile { --mh: 236; --mc: .085; --ma: .92; min-width: 0; padding: 12px 14px; border-radius: 20px; }
.mico-tile strong { display: block; font-size: 17px; line-height: 1.25; font-weight: 750; letter-spacing: -.01em; }
.mico-tile span { display: block; margin-top: 2px; font-size: 11.5px; opacity: .88; }
.mico-callout { min-width: 0; padding: 11px 14px; border-radius: 16px; border-left: 3px solid oklch(.62 calc(var(--mc) * 1.35 + .03) var(--mh) / .72); }
.mico-sky, [data-tone="sky"] { --mh: 236; --mc: .085; --ma: .92; }
.mico-mint, [data-tone="mint"] { --mh: 166; --mc: .095; --ma: .92; }
.mico-lemon, [data-tone="lemon"] { --mh: 98; --mc: .12; --ma: .92; }
.mico-peach, [data-tone="peach"] { --mh: 55; --mc: .105; --ma: .92; }
.mico-pink, [data-tone="pink"] { --mh: 8; --mc: .1; --ma: .92; }
.mico-grape, [data-tone="grape"] { --mh: 296; --mc: .1; --ma: .92; }
.mico-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 6px 0; border-top: 1px solid light-dark(oklch(.4 .05 var(--mh, 260) / .1), oklch(1 0 0 / .12)); }
.mico-kv:first-child { border-top: 0; padding-top: 0; }
.mico-kv strong { font-weight: 700; }
.mico-list { margin: 0; padding-left: 18px; }
.mico-list li + li { margin-top: 4px; }
.mico-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mico-table th { padding: 6px 8px; text-align: left; font-weight: 700; color: light-dark(oklch(.4 .05 260), oklch(.84 .03 260)); background: light-dark(oklch(.55 .06 260 / .1), oklch(1 0 0 / .09)); }
.mico-table th:first-child { border-radius: 8px 0 0 8px; }
.mico-table th:last-child { border-radius: 0 8px 8px 0; }
.mico-table td { padding: 7px 8px; border-top: 1px solid light-dark(oklch(.45 .05 260 / .1), oklch(1 0 0 / .1)); vertical-align: top; }
.mico-table tbody tr:first-child td { border-top: 0; }
.mico-badge, .mico-tag { --mh: 282; --mc: .11; display: inline-flex; align-items: center; gap: 4px; width: fit-content; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; color: light-dark(oklch(.38 calc(var(--mc) * 1.15) var(--mh)), oklch(.9 calc(var(--mc) * .7) var(--mh))); background: light-dark(oklch(.84 calc(var(--mc) * .85) var(--mh) / .38), oklch(.5 calc(var(--mc) * 1.1) var(--mh) / .36)); box-shadow: inset 0 1px 0 light-dark(oklch(1 0 0 / .7), oklch(1 0 0 / .16)), inset 0 0 0 1px oklch(.65 var(--mc) var(--mh) / .24); }
`

export const HTML_CARD_FRAGMENTS = `<main class="mico-report">
  <div class="mico-eyebrow">Context</div>
  <h1>Specific title</h1>
  <div class="mico-grid">
    <section class="mico-panel mico-hero mico-full"><h2>Key conclusion</h2><p>Evidence-based takeaway</p><small>Qualifier or source</small></section>
    <div class="mico-tiles mico-full"><div class="mico-tile mico-sky"><strong>Value</strong><span>Metric</span></div><div class="mico-tile mico-mint"><strong>Value</strong><span>Metric</span></div><div class="mico-tile mico-peach"><strong>Value</strong><span>Metric</span></div></div>
    <section class="mico-panel mico-mint"><h2>Heading</h2><ul class="mico-list"><li>First point</li><li>Second point</li></ul></section>
    <section class="mico-panel mico-peach"><h2>Heading</h2><p>Supporting detail</p><span class="mico-badge mico-mint">Status</span></section>
    <section class="mico-panel mico-full"><h2>Comparison</h2><table class="mico-table"><thead><tr><th>Item</th><th>Detail</th></tr></thead><tbody><tr><td>Topic</td><td>Evidence</td></tr></tbody></table></section>
  </div>
</main>`

export const HTML_CARD_DESIGN_INSTRUCTIONS = `# Reusable HTML card design

Bootstrap 5 CSS/JS and the reusable .mico-* jelly design CSS are automatically injected into every HTML card's <head>; do NOT write custom <style> boilerplate for layout or colors. Compose semantic <main class="mico-report"> DOM directly from the classes below, omit unused fragments, replace example copy with supported facts, and omit \`h\` in \`add_html_cards\` so the card fits its content without trailing whitespace.

Layout classes: .mico-report (vertical stack with auto 12px gaps), .mico-stack, .mico-grid (2-col), .mico-grid-3 (3-col), .mico-full (span grid), .mico-tiles (3-col KPI row), .mico-kv (key-value row).
Surface & jelly classes: .mico-eyebrow, .mico-hero, .mico-panel, .mico-tile, .mico-callout, .mico-list, .mico-table, .mico-badge, .mico-tag. Add any Mico jelly tone (.mico-sky, .mico-mint, .mico-lemon, .mico-peach, .mico-pink, .mico-grape) onto .mico-hero, .mico-panel, .mico-tile, .mico-callout, or .mico-badge.

${HTML_CARD_FRAGMENTS}`
