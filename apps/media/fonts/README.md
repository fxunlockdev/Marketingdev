# Static renderer font faces

These faces are derived from the SIL Open Font License fonts in
`apps/web/public/fonts/`. The matching `*-OFL.txt` licenses and upstream URLs
are maintained there and copied alongside these faces in the renderer image.
Browser previews use the original variable fonts; the isolated native renderer
uses these static weights because node-canvas does not reliably select variable
font axes.

To reproduce with Python and `fonttools==4.60.1`:

```sh
python apps/media/instantiate-fonts.py apps/web/public/fonts apps/media/fonts
```

`sources.json` records source and output SHA-256 hashes. The generator pins all
axes at their defaults except weight and gives each face a unique internal name
to prevent Fontconfig from merging weights. No font is fetched during rendering.
