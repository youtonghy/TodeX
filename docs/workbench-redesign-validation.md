# Tool panel redesign validation

Validated on 2026-09-08 with HeroUI Native 1.0.8, Android Studio's Pixel 10 Pro
API 37 emulator, and Chromium at a 390 px viewport.

## Delivered behavior

- Terminal: one compact toolbar, a full-width xterm canvas, and a narrow shortcut
  row. Input goes directly through xterm's `onData`; the separate command field
  and send button are removed. The keyboard shortcut focuses both the Android
  WebView and xterm. Session settings, copy/clear output and stop controls live in
  bottom sheets. Existing automatic startup/reconnect behavior remains in place.
- Web terminal: uses xterm and FitAddon as well, replacing the text-log fallback.
  Hidden or disabled terminals cannot send input; output replay still avoids
  duplicating the PTY's echo of local input.
- Browser: one address bar, open/refresh and page information controls, followed
  by the full available preview area. The element-inspection control floats over
  the preview. Existing loopback validation and navigation restrictions remain.
- Git Diff: full-width code with monospace text, full-row change backgrounds,
  compact change counts and horizontal scrolling. The vertical list has an
  explicit viewport height so horizontal nesting does not disable vertical
  scrolling on Android. Rendering/retention limits are unchanged.

## Checks

- `npm run typecheck`: passed.
- `npm run test:unit`: 160 passed.
- Android `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a`: passed.
- `npm run build:web`: passed.
- Android real app: opened terminal and its action/settings sheets, checked the
  disconnected state and absence of the old command input; checked browser
  toolbar and invalid-address feedback.
- Temporary isolated Android fixture: rendered ANSI output; focusing through the
  terminal area and through the keyboard button both delivered `abc\r` using
  paced native key events. The fixture echoed data locally without opening a PTY.
  A 100-line diff verified full-row backgrounds, long-line display and vertical
  scrolling to later lines (18–50 visible after a swipe).
- Chromium: the same native terminal HTML delivered characters, Enter, arrow
  escape sequences, Ctrl-C and Unicode text; resizing changed the reported
  columns, and disabling input blocked further data. The actual web terminal
  component also accepted direct input in an isolated screen fixture.
- Mobile-width web fixture: inspected populated Git Diff layout and long-line
  horizontal overflow. HeroUI emitted colorKit color-conversion warnings in this
  isolated fixture; it did not block the input/scroll checks.

The temporary fixtures and entry-point changes were removed. The final Release
build restores the real app and preserves its stored data. No test input was
sent to a real backend. A connected backend session, full IME composition across
different Android keyboards, and native iOS remain outside this validation.
