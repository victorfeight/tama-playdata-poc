# Asset Attribution

This proof-of-concept uses only local, handmade/source assets copied from the existing Tamaweb and TamaParadise references, plus the user-provided trade background.

## User-Provided

- `tama_trade.png`: copied from `/home/vic/Downloads/tama_trade.png`, then resized/cropped to `800x520` with object-fit-cover semantics for the canvas background.

## Tamaweb

Source root: `/home/vic/Documents/SITE_LATEST/TAMA_NEW/Tamaweb/resources/`

License reference: `/home/vic/Documents/SITE_LATEST/TAMA_NEW/Tamaweb/LICENSE` (`CC BY-NC-SA 4.0` in the local project).

- `PixelifySans-VariableFont_wght.ttf`: copied from Tamaweb resources.

## TamaParadise App

Source root: `/home/vic/Documents/SITE_LATEST/TAMA_NEW/TamaParadiseApp_licenses/linux/CROSSPLATFORM_TAMA/`

- `items/*.png`: copied from `BuiltinItems/images/*.png`. These are used to render item ids observed in type `0x2` gift packets.
- `src/item-catalog.ts` was generated from `Data/BuiltinItemsEmbedded.cs` so wire item ids resolve to the matching image filename and display name.
