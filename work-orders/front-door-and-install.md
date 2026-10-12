# WORK ORDER — Front door & install (items 1–2 of the Oct 12 brainstorm)

Branch: `block-front-door` (assign the next block number in your report)
Read CLAUDE.md first. Standing rules apply: vocabulary, the four save words, gesture rules, suite tiers, blast-radius list, read-only probes, report format.

Two parts, three rulings. Part A ships first. Part B starts only after Part A merges.

---

## RULINGS (PK, Oct 12 2026)

**R1 — Public data is public. Ranch data is private. Ask for sign-in only on save.**
Signed-out people can open every tab. The only time they see the sign-in sheet is when they try to write or save something: Record, Save, Watch, Count, Edit, or Delete.

**R2 — Signed-out Today and Ranch show the example ranch, not a wall.**
Render the Dry Creek example from a STATIC FIXTURE committed to the repo.
- Signed-out sessions make ZERO database reads of ranch tables.
- NO new anon RLS policies. No policy changes of any kind.
- If the build seems to need a policy change, STOP and report. Don't make the change.

**R3 — The installed app opens where the person works, and the install is asked for after something useful happens.**
Never ask on the first page load. Never ask inside the installed app.

---

## PART A — Install

### Recon (read-only, short)
1. Print the current manifest, the icon files present (including `apple-touch-icon`), and the service-worker scope from Block 15.
2. List the existing deep links for record-feed and count-cattle, if any.
3. Check whether any analytics event fires on `appinstalled` or for standalone sessions.

### Build
1. **Start route.** Add a `/start` route.
   - Signed in → `/today`.
   - Signed out → `/markets`.
   - Set manifest `start_url` to `/start?source=pwa`.
   - Add `"id": "/"` and `"scope": "/"`.
2. **Shortcuts.** Add three manifest shortcuts:
   - Record feed
   - Count cattle
   - Markets

   Point them at real routes. If a deep link doesn't exist, use the nearest real screen and note that in the report. Don't build new deep-link plumbing.
3. **Maskable icon.** Add a 512px maskable icon with the mark inside the 80% safe zone. Keep the `any` icons.
4. **Screenshots.** Add two `narrow` screenshots for Android's install sheet:
   - Today (Test Ranch)
   - Markets
5. **Icon candidates. STOP for PK's pick before the manifest switches icons.**
   - Produce 3 bold variants: solid forest `#1B4332` tile, thick cream `#FDFBF7` rope mark, no fine detail.
   - Add a preview page at `/dev/icons` showing each variant at 180, 120, 60 and 29 px, next to fake Messages and Weather icons.
   - iOS caches home-screen icons until the app is re-added, so we pick once.
6. **`InstallNudge` component.** A bottom sheet, 56px buttons, plain words.
   - **Never shows when:**
     - the app is already standalone (`display-mode: standalone` or `navigator.standalone`);
     - it was dismissed within the last 14 days (localStorage, wrapped in try/catch).
   - **Shows after** one of these value moments:
     - signed in: the 2nd successful save, OR a visit on a 2nd distinct ranch day;
     - signed out: a visit on a 2nd distinct day, OR a 2nd county or market check.
   - **Android / Chrome:** capture `beforeinstallprompt` and call `prompt()` from our own button.
   - **iPhone Safari:** a steps sheet with the Share icon drawn: Share → Add to Home Screen.
   - **iPhone in-app browsers** (Facebook, Messenger, Instagram and similar user agents): "Open this in Safari to add it to your home screen", plus a Copy link button.
   - **Copy must be true today.** Use: "Put Dryline on your home screen. Opens like an app, works with no signal." Do NOT mention alerts; they aren't built.
7. **Measure installs.** Add Vercel custom events: `install_prompt_shown`, `install_accepted`, `install_dismissed`, `appinstalled`, `standalone_session`.

### Checks
Add these to the fast tier:
- The manifest validates and `start_url` resolves correctly both signed in and signed out.
- The nudge does not render in standalone or on first load.
- The iPhone in-app-browser copy renders for an FBAN user agent.

Suite tier: UI only → fast tier, then merge after PK looks at dryline.farm on his phone. The icon switch waits for PK's pick.

---

## PART B — Public / gated

### Recon (read-only)
1. **Route table.** One row per route with these columns:
   - signed-out behavior today (redirect / blank / gate / renders);
   - what data it reads;
   - whether it writes.
2. **Observed Oct 12.** Signed out, `/markets` and `/weather` return only the page shell with no content. Find out why and say so plainly.

### Target matrix

**PUBLIC** (renders fully signed out):
- `/`
- `/markets` — regional reference report data plus sample lots per region
- `/weather` — a county from the picker or geo, remembered on the phone; no ranch places
- `/dashboard?fips=`
- news
- terms and privacy

**PRIVATE** (example ranch when signed out):
- `/today`
- `/ranch/*`
- activity
- places
- bunches
- the record sheets
- settings

Settings can go straight to the sign-in sheet; the example ranch makes no sense there.

### Build
1. **`ExampleRanch` fixture.**
   - Generate a JSON snapshot once, from the Test Ranch, with a committed script.
   - Scrub it: no real names, no emails, no PK ground coordinates. Use Dry Creek naming.
   - Store dates as offsets from today, so it always reads as "yesterday, 4 bales".
   - Private pages render from the fixture when there is no session.
2. **Example banner.** A slim banner at the top of example pages: "Example ranch · Make it yours →", which opens sign-up. Add `noindex` to these pages.
3. **`SignInSheet`.** Every write control in signed-out mode opens it.
   - Use the existing OTP flow.
   - Keep `returnTo` so that after sign-in the person lands back on the exact action they tapped.
4. **`LockedTeaser`.** One component, used on public pages wherever a personal piece would go:
   - "Your bunches priced here"
   - "Weather at your places"

   Each shows a lock icon and opens the sign-in sheet. Use one component everywhere, not one-offs.
5. **Nav.** Signed-out users see the same four tabs as signed-in users. Don't hide anything; consistency beats cleverness.
6. **Metadata.** Public pages keep their existing SEO and OG metadata untouched.

### Checks
- Signed out, every private route returns 200, shows the example banner, and makes zero Supabase requests to ranch tables. Assert this on the network log, not on the source code.
- Signed out, tapping Record shows the sign-in sheet and creates no outbox entry.
- Signed-in behavior is byte-for-byte unchanged on Today, Ranch and Markets.
- `/markets` and `/weather` render real content signed out at 320px and 390px.

Suite tier: touches middleware and who-sees-what → run ALL THREE suites. Isolation must be green at the standing baseline count with no checks removed. That suite is the proof that no ranch data reached anon. If isolation changes in any way, STOP and report; don't merge.

---

## Out of scope (do not build)
- watch lots
- the Markets redesign
- sheep
- the landing-page cut
- the "This week on my ground" visual
- alerts or push

## Report
Use the CLAUDE.md format. End every report with "live on dryline.farm: <what changed>" plus the open list, including the icon pick waiting on PK.
