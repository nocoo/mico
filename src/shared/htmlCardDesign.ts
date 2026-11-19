export const HTML_CARD_CSS = `
* { box-sizing: border-box; }
html, body { background: transparent; }
body { margin: 0; font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: oklch(.27 .04 285); }
.mico-report { padding: 24px; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.mico-report h1 { margin: 2px 0 14px; font-size: 21px; line-height: 1.3; letter-spacing: -.01em; }
.mico-report h2 { margin: 0 0 6px; font-size: 14px; line-height: 1.4; font-weight: 700; }
.mico-report p { margin: 0 0 6px; }
.mico-report p:last-child { margin-bottom: 0; }
.mico-eyebrow { color: oklch(.47 .035 285); font-size: 11.5px; }
.mico-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mico-full { grid-column: 1 / -1; }
.mico-panel { min-width: 0; padding: 13px 15px; border-radius: 20px; background: oklch(.5 .07 285 / .06); box-shadow: inset 0 0 0 1px oklch(.4 .06 285 / .11); }
.mico-hero { color: oklch(.98 .01 285); background: linear-gradient(135deg, oklch(.42 .13 285), oklch(.3 .09 262)); box-shadow: inset 0 1.5px 0 oklch(1 0 0 / .3), inset 0 -14px 20px -12px oklch(.7 .18 300 / .5), 0 14px 24px -14px oklch(.4 .15 285 / .8); }
.mico-hero small { display: block; margin-top: 3px; color: oklch(.9 .03 285 / .85); }
.mico-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mico-tile { min-width: 0; padding: 11px 14px; border-radius: 18px; color: oklch(.35 .09 236); background: linear-gradient(158deg, oklch(.968 .0425 236 / .92), oklch(.9 .085 236 / .92)); box-shadow: inset 0 1.5px 0 oklch(1 0 0 / .75), inset 0 -12px 20px -12px oklch(.7 .1275 236 / .45), 0 16px 30px -16px oklch(.7 .1275 236 / .45); }
.mico-tile strong { display: block; font-size: 17px; line-height: 1.3; }
.mico-tile span { font-size: 11px; }
.mico-list { margin: 0; padding-left: 18px; }
.mico-list li + li { margin-top: 4px; }
.mico-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mico-table th { padding: 3px 4px; text-align: left; color: oklch(.47 .035 285); }
.mico-table td { padding: 5px 4px; border-top: 1px solid oklch(.4 .06 285 / .11); vertical-align: top; }
.mico-tag { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; color: oklch(.48 .19 283); background: oklch(.62 .17 285 / .13); }
`

export const HTML_CARD_FRAGMENTS = `<main class="mico-report">
  <div class="mico-eyebrow">Context</div>
  <h1>Specific title</h1>
  <div class="mico-grid">
    <section class="mico-panel mico-hero mico-full"><h2>Key conclusion</h2><p>Evidence-based takeaway</p><small>Qualifier or source</small></section>
    <div class="mico-tiles mico-full"><div class="mico-tile"><strong>Value</strong><span>Metric</span></div><div class="mico-tile"><strong>Value</strong><span>Metric</span></div><div class="mico-tile"><strong>Value</strong><span>Metric</span></div></div>
    <section class="mico-panel"><h2>Heading</h2><ul class="mico-list"><li>First point</li><li>Second point</li></ul></section>
    <section class="mico-panel"><h2>Heading</h2><p>Supporting detail</p><span class="mico-tag">Status</span></section>
    <section class="mico-panel mico-full"><h2>Comparison</h2><table class="mico-table"><thead><tr><th>Item</th><th>Detail</th></tr></thead><tbody><tr><td>Topic</td><td>Evidence</td></tr></tbody></table></section>
  </div>
</main>`

export const HTML_CARD_DESIGN_INSTRUCTIONS = `# Reusable HTML card design

Bootstrap 5 CSS/JS and the reusable .mico-* design CSS are automatically injected into every HTML card's <head>; do NOT copy <style> boilerplate for these base classes into card html. Compose semantic <main class="mico-report"> content directly from the fragments below, omit unused fragments, replace example copy with supported facts, and size cards generously so content fits without clipping or scrolling.

Available classes: .mico-report, .mico-eyebrow, .mico-grid (2-col), .mico-full (span all cols), .mico-panel, .mico-hero, .mico-tiles (3-col), .mico-tile, .mico-list, .mico-table, .mico-tag.

${HTML_CARD_FRAGMENTS}`
