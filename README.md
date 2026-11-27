<p align="center"><img src="docs/icon.png" width="96" alt=""></p>

# Atmosphere

A Safari extension for macOS that gets **Netflix** and **Disney+** to play **Dolby Atmos** in Safari. On Disney+ it also unlocks **up to 4K** and **Dolby Vision / HDR10**. On **YouTube**, it enables **Dolby Digital Plus 5.1** on videos that offer it.


## What it does

### Netflix

Netflix in Safari normally gets Dolby Digital Plus 5.1 at most, and macOS shows it as **Multichannel**. Atmosphere fixes two separate problems:

1. **Netflix doesn't ask for Atmos in Safari.** Atmosphere adds the Dolby profiles (`ddplus-atmos-dash`, among others) to the list of audio formats Netflix's player requests. On titles that have it, Netflix then sends an Atmos (DD+ JOC) stream.
2. **Safari doesn't switch into Atmos mode for streaming playback.** Safari plays Atmos through its streaming path (MSE) as "Multichannel", unless an Atmos file has already played through a plain `<audio src>` element in the same Safari session. Atmosphere plays a near-silent, 4-second Dolby Atmos test clip that way when Netflix opens, or on your first click. Safari then stays in Atmos mode. This is a WebKit bug, reported as [WebKit bug 331672](https://bugs.webkit.org/show_bug.cgi?id=331672) (details in [docs/webkit-bug.md](docs/webkit-bug.md)).

### Disney+

Disney+'s web player in Safari asks for AAC stereo and at most 720p, so Disney+ sends no Atmos. Atmosphere:

1. **Adds Dolby (`eac-3`) and the `ATMOS` / `5.1` audio types, HEVC, HDR, and up to 3840x2160** to the player's playback request. Disney+ then includes Atmos, 1080p–4K, and Dolby Vision or HDR10 versions.
2. **Points the player at the Atmos audio.** The player only treats AAC as playable in Safari (dropping AAC versions makes it fail with Error 83), so Atmosphere keeps the versions but remaps their audio to the Atmos group, and opens the audio buffer as `ec-3` to match the data that actually arrives.
3. **Applies your Quality setting** to the stream list before the player sees it. *Highest* (default) keeps only the title's top resolution, so 4K starts within seconds instead of the player climbing from 480p.
4. **Primes Safari's Atmos mode** at page start, the same workaround as Netflix.

### YouTube

Turn on **Dolby 5.1** in the Atmosphere popup and play a video with a Dolby surround track. Atmosphere enables YouTube's multichannel audio selection and reports the stream Safari opens.

On the [YouTube surround test video](https://www.youtube.com/watch?v=iTHtXgnhqfM), the popup reported **DD+ 5.1** at **1080p**, and macOS reported **Multichannel**. YouTube support is for 5.1 surround. Netflix and Disney+ can also play Dolby Atmos on supported titles.

### Playback status

Atmosphere doesn't touch DRM or decrypt anything. It only adjusts the player's requests and stream list, and reads stream headers (codec, channels, Atmos flag) to show its status.

The toolbar popup adapts to the site (purple for Netflix, blue for Disney+, and red for YouTube) and shows:
- whether enhanced audio was requested,
- the audio playing (Atmos, DD+ 5.1 or AAC stereo, with bitrate when available) and any mid-playback changes,
- the video playing (resolution, Dolby Vision / HDR10 / SDR, codec, dropped frames) and quality changes,
- whether Safari is in Atmos mode.

It has toggles for each feature, Disney+ **Quality** (Highest / Auto / 4K / 1440p / 1080p / 720p) and **HDR** (Dolby Vision / HDR10 / SDR) settings, and an optional **Debug mode** with logs.

## Requirements

- macOS with Safari 17 or later (built and tested on macOS 27 / Safari 27, Apple Silicon)
- Xcode, for building
- A Netflix plan with Atmos and/or a Disney+ plan with Atmos/4K (No Ads), and Atmos-capable output (AirPods with Spatial Audio, recent MacBook speakers, etc.)
- Spatial Audio on, and **Mono Audio off** (System Settings → Accessibility → Audio). If an app is using the AirPods' microphone, they switch to mono headset mode and no Atmos is possible.

## Build and install

```bash
git clone https://github.com/meghrathod/atmosphere.git
cd atmosphere
./tools/fetch-prime-clip.sh   # downloads Dolby's public Atmos test clip (not redistributed here)
cd Atmosphere
xcodebuild -scheme Atmosphere -configuration Release -derivedDataPath build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<your team ID> build
cp -R build/Build/Products/Release/Atmosphere.app ~/Applications/
open ~/Applications/Atmosphere.app
```

A free Apple ID works for signing: add it in Xcode → Settings → Accounts, and use its "Personal Team" ID. Then turn on **Atmosphere** in Safari → Settings → Extensions and allow it on the sites you use: netflix.com, disneyplus.com, and youtube.com.

If you don't want to sign it, you can load it unsigned instead: turn on Safari → Settings → Developer → *Allow unsigned extensions*, then use *Add Temporary Extension…* and pick the `netflix-atmos` folder.

## Repository layout

| Path | What it is |
|---|---|
| `netflix-atmos/` | The web extension: `page.js` (request and playback hooks), `content.js` (priming, state), `dec3.js` (audio header parser), popup |
| `Atmosphere/` | Xcode wrapper app generated with `safari-web-extension-converter` |
| `atmos-mse-test.html` | Test page: plays the Dolby clip directly, through MSE, and through MSE with video |
| `atmos-probe.html` | Reports what Safari tells sites about Dolby audio support |
| `netflix-atmos/disney-page.js` | Disney+ request and playlist handling |
| `netflix-atmos/youtube-page.js` | YouTube multichannel support and stream detection |
| `netflix-atmos/site-content.js` | Shared settings, priming, diagnostics, and popup status for Disney+ and YouTube |
| `netflix-atmos/background.js` | Forwards Debug-mode logs to the local log receiver |
| `tools/` | Icon generator, clip downloader, local log receiver |

## Debugging

Turn on **Debug mode** in the popup, then run the local log receiver; logs land in `logs/atmosphere.log` (git-ignored). Nothing leaves your Mac, and tokens/IDs are filtered out.

```bash
python3 tools/log-server.py
```

## Caveats

- This is unofficial and not affiliated with Netflix, Disney, Dolby or Apple. Changing what the players request may go against Netflix's or Disney+'s terms of use, so use it at your own risk.
- It depends on how each site's web player works today and may break whenever they change it.
- Priming keeps Safari in Atmos mode, so Control Center shows "Dolby Atmos" even for 5.1 content. The popup's **Playing in Atmos** step tells you what's actually playing.
- Disney+ support is experimental: the request fields and the AAC→Atmos remap rely on how Disney+'s web player works today. If a title fails (e.g. Error 83), turn off **Ask for Atmos**.
- Disney+ *Highest* and the fixed quality floors leave no lower versions to fall back to; on a slow connection, use *Auto*.

## Trademarks

Dolby, Dolby Atmos and Dolby Vision are trademarks of Dolby Laboratories. Netflix, Disney+, and YouTube are trademarks of their respective owners. This project is not affiliated with or endorsed by them. The Dolby Atmos and Dolby Vision logos in `netflix-atmos/brand/` (from Wikimedia Commons) are used only to identify the audio and video formats being played.

## License

MIT. See [LICENSE](LICENSE). The Dolby test clip isn't included and stays under Dolby's terms.
