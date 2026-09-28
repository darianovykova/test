<inputs>
Ask me for:
1. The existing UI screen I want to animate (a Figma frame link is preferred; a screenshot, image or HTML/reference also works).
2. What type of screen it is (dashboard, landing page, app home, analytics, product UI, etc.).
3. 5–10 key elements or areas that should participate in the animation.
4. The desired motion style: subtle / polished / expressive.
5. Colour: keep the screen's own palette (default), pure black and white, or one accent colour.
6. The viewport size, if it differs from the source frame. Default: the source frame's own size (for example 1440×900).
</inputs>

<direction>
Create a Dribbble-level UI motion piece based on the EXISTING SCREEN I provide.
The existing screen is the source of truth.
Do not redesign the UI, replace the layout, invent a new interface, or turn the animation into a collection of isolated UI components.

The goal is to make a finished product screen feel alive through coordinated motion.

Keep the original:
* layout and hierarchy
* typography
* spacing
* colours (the screen's own palette unless I ask otherwise)
* component styles
* content
* visual identity

Frame and viewport:
* The video frame IS the app's viewport. Its aspect ratio and size match the real screen (for example 1440×900, 16:10).
* No surrounding canvas, background colour, window chrome, rounded corners or drop shadow. At the overview the interface fills the frame edge to edge.
* The interface height is the real viewport height, not the full page. Content below the fold is reached by scrolling: fixed chrome (top bar, sidebar) stays put, the content area scrolls, and an overlay scrollbar appears only while scrolling.
* Below-the-fold content animates (draws, counts) when it scrolls into view.

Animate the existing elements through:
* smooth entrances
* staggered reveals
* subtle position and scale changes
* cards expanding or collapsing
* charts drawing themselves
* numbers counting/updating
* tabs switching
* filters opening
* menus appearing
* tooltips following the cursor
* content swapping with short blur/fade
* buttons reacting to clicks
* sliders responding to drag
* subtle hover states
* scrolling where the real viewport requires it

Every interaction should feel like part of one continuous product experience rather than a collection of separate demos.

Use the existing UI font, or Geist when no font is provided.

Motion should feel precise, premium and editorial:
* springs everywhere
* tiny overshoot at most
* smooth acceleration/deceleration
* no exaggerated bouncing
* no particle effects
* no glows
* no unnecessary gradients
* no generic template animations
* no decorative motion that doesn't communicate something

The cursor should drive meaningful interactions:
clicks, hover states, tabs, filters, scrolling and occasional drags.

The camera can zoom or pan to focus attention on important areas. It only ever moves inside the app: it must never reveal anything outside the viewport's edges. The UI must stay readable and grounded in the original screen.

Sound: realistic interface sounds only, with no music and no decorative or musical effects:
* a mouse-button press on each click, plus a softer release about 90–100 ms later
* scroll-wheel notches while scrolling
* hovers, menus, data updates, chart scrubbing and transitions are silent, as they are in a real web app

The animation should tell a simple visual story:
the screen loads → key content appears → the user interacts with the interface → information changes/reveals itself → the interface returns to its initial state.

The final frame must match the initial frame closely enough to create a seamless loop.
</direction>

<structure>
Build the animation around the actual structure of the provided screen.

Before writing code:
1. Analyze the provided screen, including any content below the fold in the source frame.
2. Identify its main visual hierarchy.
3. Identify which elements can realistically animate.
4. Define 6–10 meaningful motion states based on the actual UI.
5. Map those states to the beat grid.
6. Show me the proposed beat-by-beat storyboard before implementing anything.

Example structure for a dashboard:
Beat 1 — Initial dashboard. The complete screen is visible.
Beat 2 — Header / navigation enters. Subtle reveal of the top navigation and primary controls.
Beat 3 — Main content appears. Cards and key metrics reveal with a tight stagger.
Beat 4 — Chart animates. The chart draws itself and values update.
Beat 5 — User interaction. Cursor moves to a filter/tab and clicks.
Beat 6 — Content responds. The selected state changes and the relevant content smoothly updates.
Beat 7 — Detail interaction. Cursor hovers or drags across a chart, revealing a tooltip/value.
Beat 8 — Secondary interaction. A panel, dropdown or card expands, or the view scrolls to below-the-fold content.
Beat 9 — Overview returns. The interface smoothly resolves back toward its original composition (scrolled back to the top).
Beat 10 — Loop. Return to the exact initial state and cursor position.

The actual states must be based on the provided screen, not this example.
</structure>

<build>
1. Create one self-contained HTML file (font, images and script inlined). The page size equals the app viewport (for example 1440×900). Render the video at a higher device scale for crisp text, for example 4/3 → 1920×1200.
2. Treat the provided UI as the visual source of truth. When working from Figma, rebuild from the layer data and exported assets (icons, logo, images). If direct asset downloads are blocked, export them through the Figma plugin API and verify them byte for byte.
3. Every visual state must be computed from time inside seek(t).
4. Do not use CSS transitions, timers or mutable animation state.
5. Springs must be closed-form step responses.
6. When a property changes target multiple times, use the sum of independent spring responses so the animation remains a pure function of time. This includes the camera, cursor, scroll offset, numbers, chart shapes and tab indicators.
7. Cursor movement, clicks, drags and scrolling must also be deterministic functions of time.
8. During a drag or scrub, the value is determined directly from the cursor position. After release, it springs naturally from that position.
9. Text/content swaps need independent exit and enter timing so elements never overlap.
10. Number counters are critically damped and must land exactly on their final value before the next interaction, with no last-digit flicker.
11. There is no music, so use an internal 120 BPM beat grid (0.5 s per beat). Start on a downbeat, and place clicks, data changes and scrub stops on beats.
12. Keep the camera clamped to the app bounds (visible half-extent / zoom). Choose targets so the clamp never actually engages, which avoids velocity kinks. Verify this numerically.
13. Render with Playwright.
14. Render 4 subframes per frame and use ffmpeg tmix for motion blur at 60 fps. Spread the subframes over a 180° shutter (half the frame interval) and keep camera springs soft, so fast moves blur instead of showing ghost copies.
15. Export a sound cue sheet from the same timeline. Synthesize the realistic mouse sounds procedurally and place them on a circular buffer exactly one loop long, so the audio loops seamlessly. Keep the level modest (peak about −9 dBFS). Mux the audio into the video.
16. Before the full render, render one frame per beat and inspect the storyboard for:
 - timing
 - readability
 - cramped layouts
 - awkward overlaps
 - the cursor covering the text it points at (aim at empty space next to it instead)
 - elements appearing too early/late
 - interactions that don't land on the beat
 - camera framing that crops the element being interacted with
17. Fix these issues before rendering the final animation.
18. After rendering, verify:
 - the first and last frames are pixel-identical in the HTML
 - no frame edge shows anything outside the app
 - every audio onset matches its click or scroll cue

Do not use will-change on elements that are camera-scaled or contain text, since this can make text blurry.
</build>

<interaction-principles>
Interactions must feel like real product interactions.

The cursor should:
* move naturally between relevant elements
* pause briefly before important clicks
* visibly click buttons/tabs
* drag sliders or charts when appropriate
* hover over elements to reveal meaningful feedback
* scroll with the wheel to reach below-the-fold content, staying still while the content moves under it

Do not add interactions simply to create movement.

If an interaction would require content that doesn't exist in the provided screen (for example page 2 of a paginated list), use an interaction that the existing content supports instead, such as hover states.

If the provided screen has no meaningful interaction for a particular beat, animate the existing content instead:
* data appearing
* cards revealing
* chart drawing
* numbers changing
* sections expanding
* subtle scrolling
* focus moving through the interface
</interaction-principles>

<gotchas>
Never redesign the provided screen just to make the animation easier.

Never replace the real interface with generic placeholder UI.

Never turn every component into a separate animation demo.

Never introduce UI elements that don't belong to the original product unless they are required to demonstrate an interaction already implied by the screen (for example a dropdown's menu, a chart tooltip or an overlay scrollbar). Style those with the screen's existing colours, borders and shadows.

Never invent content that the screen doesn't show. If new data values are needed to demonstrate a filter changing, list them in the storyboard for approval.

Never show a background canvas, window frame or empty space around the interface.

Never add music, whooshes, pops, tones or any sound a real interface wouldn't make.

Text must remain crisp and readable.

When content changes inside a component, animate the outgoing and incoming content separately.

Avoid dead time: something meaningful should happen on almost every beat.

Keep the camera movement subtle and purposeful.

The last frame must match the first frame, including:
* UI state
* scroll position
* element positions
* scale
* camera
* cursor position
* cursor velocity

so the loop is seamless.
</gotchas>

<start>
First ask me for the inputs.

Once I provide the screen, DO NOT write code immediately.

First:
1. Analyze the existing UI.
2. Identify the key elements available for animation.
3. Create a beat-by-beat motion storyboard using only elements that exist in the provided screen, including which parts are below the fold and where scrolling happens.
4. Show me the state list and timing on the beat grid.
5. Wait for my approval before writing the HTML/animation code.
</start>
