# PokerCal — Context Prompt for New Claude Session

Copy everything below this line into a new Claude Code chat:

---

I'm building **PokerCal**, a PokerNow clone with custom features. It's a real-time multiplayer browser poker game using Node.js, Express, Socket.IO 2.x, and vanilla HTML/CSS/JS. No database — all state is in-memory. The server runs on port 3030.

## What's Already Built (fully functional)

**Core poker:**
- No Limit Hold'em and Pot Limit Omaha 5 (PLO5)
- Full betting rounds (preflop → flop → turn → river → showdown)
- Side pots, all-in detection, proper blind posting
- Mersenne Twister RNG + Fisher-Yates shuffle
- Custom hand evaluator (Hold'em + Omaha best-hand selection)

**Special features:**
- Bomb Pots (all ante, flop immediately; manual or auto every N hands)
- Run It Twice (all-in players vote to deal board twice, split pot)
- Rabbit Hunting (show what cards would've come after fold-out)
- 7-2 Bounty (win with 7-2 offsuit, everyone pays you)
- Pre-action queue (Check/Fold, Call, Fold buttons when not your turn; call clears if someone raises)
- Sound effects via Web Audio API (check, call, raise, fold, all-in, deal, your turn, win, timer warning)
- Mute toggle in top bar, persists in localStorage

**Host controls:**
- Create rooms (6-char code), approve/deny join requests
- Pause/resume/stop game, trigger bomb pots
- Adjust blinds, chips, timer, time bank, game mode, all special features
- Set individual player chip counts, kick players
- Give time bank to all players (+15s/+30s/+60s in settings modal)

**Player features:**
- Time bank (activates at ≤10s remaining on turn timer)
- Rebuy, cash out, sit out/in, show cards after hand
- Keyboard shortcuts: F=fold, C=check/call, R=raise, A=all-in

**Disconnect/Reconnect (battle-tested, 34 unit tests):**
- Disconnected players stay in hand (NOT auto-folded)
- 15s grace period before auto-check/fold
- Reconnect restores seat, chips, cards, time bank, host status
- After hand ends, disconnected players auto-sit-out
- Room destroyed 5 min after all players disconnect

**Other:** In-game chat, game log, ledger (buy-in/buy-out tracking), auto-deal next hand after 8s

## File Structure

```
server.js                    — Express + Socket.IO server
src/game/Game.js             — Core game engine (~1300 lines)
src/game/Deck.js             — MT19937 PRNG + deck
src/game/HandEvaluator.js    — Hand ranking
src/game/PotManager.js       — Side pot math
src/game/constants.js        — Phases, actions, ranks
src/player/Player.js         — Player state object
src/socket/socketHandler.js  — All socket events (~780 lines)
src/lobby/LobbyManager.js   — Room creation/management
public/index.html            — Lobby page
public/game.html             — Game table page
public/js/game.js            — Main game controller + pre-action queue + sounds
public/js/table-renderer.js  — DOM rendering (seats, cards, pot, dealer, log, ledger)
public/js/controls.js        — Action buttons, bet slider, presets
public/js/sounds.js          — Web Audio API sound effects
public/js/chat.js            — Chat module
public/js/card-renderer.js   — Card SVG rendering
public/css/main.css          — Theme variables & global styles
public/css/table.css         — Game table layout + responsive (~2000 lines)
public/css/cards.css          — Card styles
public/css/lobby.css         — Lobby styles
tests/disconnect-reconnect.test.js  — 34 Jest unit tests
tests/e2e-disconnect.js      — Playwright E2E test
```

## Known Issues / What Needs Work

**UI/UX (the main gap vs PokerNow):**
- Mobile layout is rough — 9 absolute-positioned seats overlap on small screens, chat panel takes 75% of mobile width
- No smooth animations for dealing cards, chip movements, or dealer button transitions
- Bet slider is hard to use on touch devices (small thumb)
- Settings modal requires scrolling on mobile
- No visual distinction for PLO5's 5 cards vs Hold'em's 2 cards in the "my cards" area
- Seat cards and chip stacks get cramped; the table felt doesn't scale gracefully
- No loading states or transition animations
- Generally looks "functional but not polished" compared to PokerNow's clean design

**Missing features (compared to PokerNow):**
- Hand history viewer (replay past hands)
- Player avatars / profile customization
- Straddle option
- Per-hand ante (not just bomb pots)
- Spectator/waiting list mode
- Ledger export / settle-up
- Table theme customization
- BB-denominated bet presets (1BB, 2BB, etc.)

**Technical debt:**
- Socket.IO 2.x (outdated; 4.x is current)
- No TypeScript, no JSDoc
- No error boundaries around socket handlers
- No rate limiting on socket events
- Some hardcoded magic numbers (15000ms grace, 200 log entries, etc.)
- No structured server logging

## How To Run

```bash
npm install
npm start          # Starts on PORT=3030 (or set PORT env var)
npm test           # Runs 34 Jest unit tests
node tests/e2e-disconnect.js  # Playwright E2E (needs Node 18+)
```

## What I Want To Work On

I want this to be mainly a mobile-first web app. First update my technical tools and dependencies like socket.io and node etc. My current computer is 6 years old and I just started working on projects with this computer recently. First fix the issue of the show hand not working after a hand finishes. The interface must be functional, strictly locked to the viewport (no scrolling), and optimized for portrait mode on mobile devices.

- Polish the UI/UX to be closer to PokerNow's quality
- Improve mobile responsiveness
- Add smooth animations for dealing/betting
- Add hand history viewer
- The table should be an implicit oval or clean dark green/gray rounded rectangle.
- Community Cards: Dead center. Make the cards highly legible with large, clear suit icons. Use a white background for cards with slightly rounded corners.
- Main Pot: Displayed directly above the community cards in a highly visible badge (e.g., yellow/gold text).
- Player Nodes: Arranged in a ring around the edge of the screen. 
  - Each player node needs: A circular avatar, player name, current chip stack, and a small badge showing their current bet in front of them.
  - Active Player Indicator: A highly visible colored ring (e.g., neon green or blue) around the avatar of the person whose turn it is, functioning as a shrinking time-bank progress bar.
  - Folded players should have their avatars dimmed/grayed out.

Feel free to open up instances of the current web app and of pokernow to compare the functionality and UI. Make sure to focus on mobile views first.
