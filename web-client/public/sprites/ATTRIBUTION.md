# Tamaweb Asset Attribution

The copied font and sprite assets in this directory are from the local Tamaweb reference:

- Source: `/home/vic/Documents/SITE_LATEST/TAMA_NEW/Tamaweb/resources/`
- License: `/home/vic/Documents/SITE_LATEST/TAMA_NEW/Tamaweb/LICENSE`
- License family: CC BY-NC-SA 4.0 as stated by the local project license.

This POC keeps the assets isolated for local research and must preserve attribution if folded into another app.

`unexists-banner.png` is copied from `/home/vic/Documents/SITE_LATEST/unexists-nextjs-frontend/public/promotion-bg.png` for local visual continuity with the Unexists frontend.

`characters/` is copied from `/home/vic/Documents/SITE_LATEST/TAMA_NEW/TamaParadiseApp_licenses/linux/CROSSPLATFORM_TAMA/CharacterSprites/` so the POC can match the existing app's body/eyes/mouth preview pipeline for known Paradise characters.

`egg.png` is `resources/img/misc/egg_normal_01.png` from Tamaweb — a 32×16 strip with two frames (idle / wobble). Used for the breeding-complete hatch animation in `ui/scene.ts`. The hatch sequence (sin sway with accelerating speed, frame swap to wobble at peak, then flash + radial spokes) is patterned after Tamaweb's `Pet.handleEgg()` flow at `Tamaweb/src/Pet.js:422`.

`heart.png` is the 16×16 horizontal half-heart strip from `~/Downloads/All 16x16 Health Heart Sets/Horizontal Half heart sets/16x16 Heart Health Pink Horizontal.png` — three frames (full / half / empty). Half-frame is used as the mid-frame in the friendship-up animation.
