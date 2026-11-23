# Symbole erzeugen

`web/js/icons.js` enthält nur die benötigten Lucide-Symbole (ISC-Lizenz) und die Zuordnung Emoji → Symbol (`emojimap.txt`).
Neues Emoji im Katalog? Zeile in `emojimap.txt` ergänzen und neu erzeugen:

```sh
npm pack lucide-static@0.460.0 && mkdir lucide && tar xzf lucide-static-0.460.0.tgz -C lucide
python3 -I genicons.py . lucide/package/icons ../../web/js/icons.js
```
