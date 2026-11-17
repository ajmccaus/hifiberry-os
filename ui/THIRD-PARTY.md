# Third-party material in the audio-os web UI

The packaged UI (`dist/`) must be shipped together with this file. The `audio-os` package installs it as
`/usr/share/doc/audio-os/THIRD-PARTY.md`.

## Beocreate 2 client (MIT)

Source: the Beocreate 2 server/client tree (`beo-views/default/beostyle2018.css`,
`beo-extensions/now-playing/now-playing.css`, `beo-extensions/product-information/product-information.css`,
`beo-system/common/symbols-*` and extension symbol folders).
Used: layout values (sizes, colors, spacing, easing, breakpoints) re-expressed in `src/styles/`, and the
monochrome symbol SVGs in `src/assets/symbols/` (unchanged files). No logos, product images or product names.

```
MIT License

Copyright (c) 2017 Bang & Olufsen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Metropolis typeface (Unlicense / public domain)

Files: `src/assets/fonts/Metropolis-Medium.otf`, `Metropolis-SemiBold.otf` (byte-identical to the copies in
the Beocreate 2 tree; "Copyright (c) 2016 by Chris Simpson", upstream https://github.com/chrismsimpson/Metropolis).
License: Unlicense (public-domain dedication), attribution Chris Simpson — as recorded by Fontsource
(`@fontsource/metropolis` 5.3.0 `metadata.json`: license type `Unlicense`, source https://github.com/dw5/Metropolis).
The font files themselves carry no license string. The license file in the upstream repository has not been
read, so the Unlicense is not confirmed at the source.
