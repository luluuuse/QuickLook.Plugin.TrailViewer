# Icon system

TrailViewer uses one application-owned icon registry in `viewer/icons.js`. Do not add SVG paths directly to
individual feature modules.

The map-layer panel follows the same translucent tool-surface tokens as the toolbox, measurement and
overlay-export panels.

Toolbox/measurement and overlay-export panels are mutually exclusive. Opening one closes the other; the
map-layer menu filters its source list to the active map type.

## Visual contract

| Property | Value |
|---|---|
| Coordinate grid | `0 0 24 24` |
| Default size | `16 × 16 px` |
| Dense inline size | `12 × 12 px` |
| Stroke | `1.75` |
| Caps and joins | round |
| UI fill | none |
| Colour | `currentColor` |
| Hover colour | `#ffffff` |
| Disabled colour | `#666666` |
| Active colour | `#8fd9ff` |
| Active surface | `#234f79` |
| Active underline | inset `0 -2px #2f9bff` |

Buttons keep their visible labels, tooltips, `aria-label`, focus order and pressed/expanded semantics. Icons are
decorative and always `aria-hidden="true"`.

## Two icon tracks

- **UI icons** have no fill and describe an action or state. Use `iconElement()` for DOM controls,
  `iconMarkup()` for trusted Leaflet HTML, and `setIcon()` when replacing an existing node's content.
- **Data symbols** describe map information. They keep their semantic red, yellow, green or cyan fill, but use a
  dark `1.5` outline through the shared `data-symbol` and `symbol-*` classes. Use `symbolMarkup()` or
  `symbolElement()` for SVG data symbols; simple circles and paths rendered by Leaflet continue to use the
  shared numeric values.

Never use a filled UI icon for status colour. Never remove semantic data fill merely to match a toolbar control.

## Adding an icon

1. Add one uniquely named entry to `UI_ICONS` or `DATA_SYMBOLS` in `viewer/icons.js`.
2. Reuse the `24×24` grid and existing stroke contract. Add no inline `fill` to UI paths.
3. Use the default 16 px size. Use 12 px only for compact chevrons, selected checks and similar inline controls.
4. Keep the control's existing text label and accessible name.
5. Add the name to `tests/unit/icons.test.mjs` when it belongs to a required control family.
6. Add or update browser assertions in `tests/icons-test.cjs`; verify both default and compact tiers when used.

Unknown names fall back to `circle-help` for UI icons and `warning` for data symbols, so a missing registration
fails visibly without injecting unchecked markup.

## Leaflet controls

`installLeafletIcons(map, { closeLabel })` replaces the native text content of zoom controls and popup close
buttons while leaving `viewer/vendor/leaflet/` unchanged. Any future Leaflet control that exposes a text glyph
should receive the same adapter rather than overriding the vendored file.

## Initial registry families

- Map controls: zoom, locate, layers, settings, marker pin, list, close, check and chevrons.
- Toolbox and measurement: toolbox, ruler, image download, finish section, centre point, undo, redo, clear and stop.
- Splits: the route toggle and chevron; metric table headers intentionally remain text-only.
- Overview and photos: filter, edit, close, previous and next.
- Status and data: waypoint, camera, direction, warning, activity, start/end, profile pins and scrubber.
