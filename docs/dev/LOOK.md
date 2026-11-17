# Beocreate 2 look: developer map
Root: `beocreate-port/server/`. Screenshots: `../shots/<kiosk|phone|desktop>-<state>.png` (states: bar-playing, bar-idle, nowplaying-playing, nowplaying-idle, home, menu, sources, sound, screen, general, general-power, about, name-edit, volume-dragging).

## CSS
- **Essential:** `beo-views/default/beostyle2018.css` (4748 lines): tokens, nav, header, menu items, buttons, sliders, popups, player bar, all media queries.
- **Essential for player:** `beo-extensions/now-playing/now-playing.css` (664): mini bar + full Now Playing + artwork.
- **Needed for home:** `product-information/product-information.css` (316).
- Extension-specific, skip first: `equaliser.css` (646), `beosonic.css` (394), `sound.css` (33).
- Loaded via `<link>` in `beo-views/default/index.html`; extension CSS is injected by `data-stylesheet` on each `menu.html`.

## Fonts and icons
- Metropolis, 18 static OTFs (Thin..Black + italics) in `beo-system/common/fonts/`, declared in `metropolis.css`. Stack: `Metropolis, Gotham, sans-serif`. Body 18px. UI mostly 400/500/600; headings and uppercase labels tracked at `--uppercase-spacing: .1em`. No licence file is in the tree (Metropolis is SIL OFL upstream; verify before redistributing).
- Icons: monochrome SVGs in `beo-system/common/symbols-black/` (48), `symbols-white/` (41), `symbols-colour/` (e.g. checkmark-green). Per-extension `symbols-*` folders too.
- Colouring: **CSS mask**. An element carries `style="-webkit-mask-image:url(...); mask-image:url(...)"` and the CSS sets `background-color` (so `.symbol`/`.menu-icon` follow text colour and dark mode). The player bar volume icons are plain `<img>` of the white set. Black vs white sets exist for these `<img>` cases. Logos: `common/*.svg`, `beo-extensions/product-information/*.svg`.

## Layout model
- `body` is fixed, flex column. Children: `nav.bar.top-level` (49px top tab bar), `#extensions` (all `.menu-screen` sections, one visible), `#player-bar` (50px, `--bottom-bg` #222, always dark), `nav.full` (dark slide-in menu, compact only), overlays (`.plexi` backplates, `.ask` dialogs, `#text-input`, `.hud-notification`).
- Screens: `section.menu-screen#sound|sources|screen|general-settings|product-information` containing `header` (back button `.back-button`, `h1`) + `.scroll-area > .menu-content`. `.large-title` gives big h1 + left sidebar column in wide mode (sidebar bg `--sidebar-bg` #f5f5f5; widths `--sidebar-width` 37vw, 330px at >=900px).
- Settings rows: `.menu-item` (icon `.menu-icon`, `.menu-label`, chevron), `.segmented-control`, `.menu-toggle`, `.slider-wrap > .ui-slider` (jQuery UI), `.button.pill`.
- Mini player: Vue `<mini-now-playing>` inside `#player-bar-wrap` (chevron, source icon, title/artist, volume `#player-bar-volume-slider`, hamburger `#player-bar-menu-button`).
- Now Playing: `#now-playing` (fixed, z 6) > `#now-playing-container` (full cover, `--main-bg`), `header` with source name, `#artwork-area-wide`/`#artwork-area-narrow`, `#track-string`, `#artist-album-string`, `.now-playing-transport` (dark `#now-playing-lower` strip with transport + volume). Shown with `v-show="visible"`; the player bar content fades/lifts (`#player-bar.shifted`).
- Light/dark: `body.dark` toggled by `setAppearance()` in `views/default/scripts/beo-ui.js` (localStorage `beocreateAppearance` auto|dark|light, plus `prefers-color-scheme`). All colours are `--vars` on `body`/`body.dark`.
- Breakpoints: compact = `max-width:620px` (JS `updateInterfaceMode`: `matchMedia` too), wide = `>=621px`; extras at 800 (`.menu-content` 20% side padding, bigger h1) and 900 (sidebar 330px). Now Playing: `max-aspect-ratio 16/12` (portrait/narrow), `min-width 621 and min-aspect 16/12` (side-by-side landscape), `max-height 430px` and `350px` (kiosk tightening), `max-aspect 10/19`.
- **800x480 = wide layout**: top tab bar, no hamburger, sidebar-style two-column screens, landscape Now Playing (artwork left, text right, dark transport strip bottom-right) with the max-height:430 rules. 390x844 = compact: hamburger opens dark `nav.full` from the right (`#extensions.shifted` translateX(-50px)); mini bar shows a two-row title strip above controls; portrait Now Playing. 1280x800 = wide, same as kiosk with larger paddings.

## Tokens
- Light: text #000, bg #fff, sidebar/ultra-light #f5f5f5, bottom bar #222, button bg rgba(0,0,0,.05), line rgba(0,0,0,.1). Dark: bg #222, sidebar #1a1a1a (nav.full #111), bottom #000, lines rgba(255,255,255,.1).
- Accents (little used): carnation #FF3E46, yellow #FFAA46, turquoise #2CD5C4, mariner #2C7FE4 (+ `-dark` variants).
- `--menu-height` 46px, `--sidebar-padding` 20px (5vw/45px wide). Radii: almost everything square; sliders, toggles, handles use `50%`. Section titles small-caps-style uppercase 0.7-0.8em, letter-spacing .1em. Pill buttons: uppercase, black fill = primary, grey = secondary.
- Motion: `cubic-bezier(.18,0,0,1)` 0.5s for transform slides (`#extensions`, player-bar-wrap); opacity .3-.5s ease; Now Playing enters with `.now-playing-fade` and `.now-playing-lift` (blur 20px + translateY 50px to 0); body fades from opacity 0 to 1 on connect.

## Third-party JS (bundled)
jQuery 1.10.2, jQuery UI 1.12.1 (slider/draggable), jquery.ui.touch-punch 0.2.3 (touch sliders), Vue 2.6.11 (Now Playing and mini player), Underscore 1.9.1, Modernizr 2.5.3 custom (`touch`/`no-touch` classes drive hover styles), FastClick, Flotr2 modified (EQ graphs only). Own: `beo-ui.js`, `beo-comms.js` (WebSocket), `beo-drag.js`.

## Accidents and device-specific
- Initial page is blank until an extension is shown; screenshots call `beo.showExtension()`.
- Hover vs touch styling depends on Modernizr `touch`/`no-touch` classes, not media queries; kiosk needs touch to get tap behaviour.
- `index.html` has `body style="opacity:0"` until connected; `.disconnected` disables pointer events.
- Safe-area insets (`env(safe-area-inset-*)`) only matter on iOS standalone. Branding (CREATE logo, product image) comes from `beo-product-identities`; title shows "null" if the system name is unset. Screen/brightness and Power items are Raspberry Pi specific. Artwork reaches the browser through the server's `/acr-artwork` proxy (port-specific).
