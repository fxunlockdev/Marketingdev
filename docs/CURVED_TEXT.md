# Curved text in the canvas

Each text layer supports **Straight / Curve** and a signed **Bend** slider (-100 to 100). Positive values arch upward; negative values bend downward. Zero restores the original straight-text renderer. Font, supported weight, colour, alignment, position, width and contrast backing remain editable.

`curvature` is an optional, finite design-layer property. Existing schema-version-1 designs remain valid without migration; new saved versions preserve the property and image revisions retain it. API and isolated export validation reject out-of-range, nonnumeric and unexpected properties.

The browser and isolated renderer both use `apps/web/lib/curved-text.mjs`. It measures the actual loaded font, lays grapheme clusters along an arc, wraps long text, respects explicit newlines, and paints at original artwork resolution. Glyph bounds determine the height and contrast backing. Curved layers remain selectable and draggable; exports contain pixels, not the selection outline. Server exports reject artwork-bottom overflow.

This is arc text, not a freehand path editor or arbitrary text warping. Straight text retains Fabric's existing rendering and shaping.

Validation: contract tests cover old designs, invalid curvature and revision preservation. Isolated renderer tests exercise positive/negative bends, PNG/JPEG, backing, multiple lines, and overflow. The AI chat browser test uses mocked external generation but real auth, persistence, font loading, canvas, save/reopen, and PNG download. Read-only visual checks use an existing saved photograph at eight viewport sizes without generating or saving customer content.
