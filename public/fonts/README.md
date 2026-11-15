# Self-hosted display fonts

Noto Serif SC is used for fixed display titles. Body text uses the system `--ui-font` stack. Card values retain `--font-card: Georgia, "Noto Serif SC", serif`; canvas card artwork remains unchanged.

The static 600 and 800 WOFF subsets are generated locally from the official Google Fonts variable TTF. See `source.json` for the pinned upstream commit, source URL, checksums, weights and byte sizes. `OFL.txt` is the upstream SIL Open Font License 1.1. Runtime pages request only these same-origin files; no Google Fonts request or device-installed Noto font is required.

`display-characters.txt` contains printable ASCII and the BMP characters currently present in `src` JavaScript, TypeScript and TSX, plus the decorative star. All 589 source Han characters are covered. Six decorative symbols not present in the upstream font use the existing system fallback; they are listed in `source.json`. Dynamic player-name headings remain system text.

To regenerate, use FontTools: load the pinned TTF, subset to `display-characters.txt` with name IDs/languages retained, instantiate `wght=600` and `wght=800` separately, update static family/style/PostScript names to SemiBold/ExtraBold, and save each with `font.flavor = "woff"`. WOFF uses the available zlib compressor and requires no new project dependency. Verify `OS/2.usWeightClass`, absence of `fvar`, and the character maps after saving. Keep this font's license with redistributed subsets.
