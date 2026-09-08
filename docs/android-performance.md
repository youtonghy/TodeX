# Android emulator performance validation

Measured on 2026-09-08 in Android Studio's Pixel 10 Pro emulator (API 37,
1280 × 2856, arm64, hardware graphics on Apple M5 Pro). Both builds use the
same installed dependencies, including HeroUI Native 1.0.8, and Gradle Release
bundles without Metro. Baseline source is commit `2afadfb`.

## Findings and changes

HeroUI's closed BottomSheet portals still mount their native contents. Several
global and screen sheets accumulated hidden views before the user opened them.
`ActionSheet` and `AppSheet` now mount on demand and release their contents after
Gorhom reports the closing animation has reached index -1. Opening waits for the
portal layout and two animation frames: HeroUI requires a false-to-true open
transition after Gorhom has measured the new content. Immediate opening on mount
was tested and did not reliably show the first sheet.

`SplitLayout` also mounted the workbench when it had never been shown, including
on a phone. It now defers that subtree until the first visible split, then retains
it when hidden to preserve an already opened workbench's state.

## Measurements

`adb -s emulator-5554 shell dumpsys gfxinfo … framestats` and `dumpsys meminfo`
provide the counters. Aggregate outputs are in [performance](./performance/).
PSS is total proportional resident memory, not JS heap size.

| Scenario / metric | Baseline | Updated |
| --- | ---: | ---: |
| Cold workspace screen PSS | 196.8 MiB | 142.4 MiB |
| Cold workspace screen attached views | 326 | 56 |
| Cold workspace screen frame p95 | 34 ms | 19 ms |
| After six model-sheet open/cancel cycles PSS | 262.5 MiB | 196.5 MiB |
| After sheet cycles attached views | 844 | 96 |
| Sheet cycles janky frames | 11 / 565 (1.95%) | 13 / 645 (2.02%) |
| Sheet cycles frame p95 | 18 ms | 21 ms |
| After six keyboard show/hide cycles PSS | 268.7 MiB | 202.7 MiB |
| Keyboard cycles janky frames | 27 / 257 (10.51%) | 29 / 260 (11.15%) |
| Keyboard cycles frame p95 | 18 ms | 18 ms |

The clear result is lower resident memory and fewer hidden views. Sheet remounts
add layout work; these samples do **not** establish smoother sheet or keyboard
animation. Startup frame results are a single run per build and are sensitive to
emulator/host scheduling. Native Activity start time does not measure React Native
readiness and is not used as a launch-speed claim. Emulator GPU duration counters
were invalid and are excluded.

## Reproduction and functional checks

1. Build `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a` using the
   Android Studio JBR and Android SDK. Install with `adb -s emulator-5554 install -r`
   to preserve data; launch `com.unbaked0692.todexmobile/.MainActivity`.
2. Record startup counters on the workspace screen. Open the existing workspace
   and first Pi conversation, then reset `gfxinfo` counters.
3. Repeat six times: tap the model chip, wait one second, tap Cancel, wait one
   second. Record frame and memory counters with the sheet closed.
4. Reset frame counters. Repeat six times: focus the empty composer, wait one
   second, press Android Back, wait one second. Record the same counters.

On the final Release build, verified model selection opens; earlier instrumented
validation also confirmed open index 0 and closed index -1 across cancel/reopen
and Android Back. Verified the chat tools sheet (fixed snap points), the new
workspace form (dynamic size and footer), and swipe-close/reopen of that form.
No workspace was created, user data cleared, or prompt sent.

Validation: TypeScript check, all 160 unit tests, Android Release build, and web
export pass. The emulator had cached conversations but no connected backend, so
this does not measure long conversation rendering, live agent streaming, or
network latency. Tablet workbench state retention and iOS have not been tested
in a native runtime in this pass.
