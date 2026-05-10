# Chrome Web Store assets

Generated assets for the Sidewire store listing.

## Included

- `promo-440x280.png` — small promo tile (recommended). Shown in the store search results / category pages.
- `listing.md` — all listing copy ready to paste into the developer dashboard (description, single purpose, permission justifications, data-usage disclosures).
- `../PRIVACY.md` — privacy policy. Host this in the repo and paste its public URL into the "Privacy policy URL" field of the dashboard.

## To produce manually

The store also requires:

- **Screenshots** — 1280×800 or 640×400 PNG/JPG. At least 1, up to 5. Take them with the extension loaded (side panel open with captured traffic, ideally one shot of the row list and one of an expanded entry showing headers/body).
- **Marquee promo tile** (optional, 1400×560) — only needed if you want to be eligible for featured placement.

## Source files

- Icon master: `../icons/icon.svg`
- PNG icons (16/32/48/128) used by the manifest: `../icons/icon-{size}.png`

## Regenerating

Both `icons/icon-*.png` and `store/promo-440x280.png` are produced from HTML templates rendered via headless Chrome. The templates are versioned: `store/render-icon.html` and `store/render-promo.html`.

```bash
# Icons (16/32/48/128) → ../icons/
for size in 16 32 48 128; do
  google-chrome --headless=new --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --window-size=$size,$size \
    --screenshot=../icons/icon-$size.png \
    "file://$PWD/render-icon.html"
done

# Promo tile 440x280 → ./
google-chrome --headless=new --disable-gpu --hide-scrollbars \
  --window-size=440,280 \
  --screenshot=promo-440x280.png \
  "file://$PWD/render-promo.html"
```
