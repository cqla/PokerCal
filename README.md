# PokerCal

A real-time multiplayer poker game built with Node.js, Express, and Socket.IO. Host private poker nights with friends from any browser — no accounts, no downloads, no rake.

## Features

### Game Modes
- **No Limit Hold'em (NLH)** — Standard 2 hole cards, bet any amount
- **Pot Limit Omaha 5 (PLO5)** — 5 hole cards, must use exactly 2 hole + 3 community

### Special Game Options
- **Bomb Pots** — All players ante, flop dealt immediately. Trigger manually or set automatic frequency (every N hands)
- **Run It Twice** — When all-in, players vote to deal remaining community cards twice and split the pot by board
- **Rabbit Hunting** — After a fold-out, reveal what community cards would have come
- **7-2 Bounty** — Win a hand with 7-2 offsuit and collect a bounty from every player at the table

### Lobby & Room Management
- Create a room and share the 6-character code with friends
- Host approval required for new players to join
- Up to 9 seats per table
- Configurable blinds, starting chips, turn timer, and time bank

### Host Controls
- Pause / Resume the game mid-hand
- Stop the game and return to waiting state
- Adjust game settings on the fly (blinds, timer, features)
- Set any player's chip count directly
- Give additional time bank to all players (+15s / +30s / +60s)
- Kick players from the table
- Trigger manual bomb pots

### Player Features
- Time bank — extra seconds you can use when your turn timer is running low (activates at ≤10 seconds)
- Rebuy when out of chips
- Cash out and record your results in the ledger
- Show cards after a hand ends
- Sit out / sit back in between hands

### Disconnect & Reconnect
- Refreshing the page or losing connection puts you in a **disconnected** state — you are NOT removed from the hand
- Disconnected players get a 15-second grace period to return before being auto-acted (check if possible, otherwise fold)
- Reconnecting restores your seat, chips, hole cards, and time bank exactly as they were
- After a hand ends, disconnected players are marked as sitting out until they return
- Host privileges are preserved on reconnect

### Other
- In-game chat
- Game log with hand history
- Ledger tracking buy-ins, buy-outs, and net profit per player
- Responsive mobile layout — works on phones and tablets
- Fair deck shuffling using Mersenne Twister PRNG with Fisher-Yates algorithm

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Real-time | Socket.IO 2.x |
| Frontend | Vanilla HTML/CSS/JS |
| Testing | Jest (unit), Playwright (E2E) |
| RNG | Mersenne Twister (MT19937) |

No database — all game state lives in memory. Rooms are cleaned up 5 minutes after all players disconnect.

## Getting Started

### Prerequisites
- Node.js 12+ (Node 18+ recommended for running Playwright tests)

### Install & Run

```bash
# Clone the repo
git clone <your-repo-url>
cd PokerCal

# Install dependencies
npm install

# Start the server
npm start
```

The server runs on `http://localhost:3030` by default. Set the `PORT` environment variable to change it:

```bash
PORT=8080 npm start
```

### How to Play

1. Open `http://localhost:3030` in your browser
2. Enter your name, configure blinds/chips, and click **Create Room**
3. Share the 6-character room code with your friends
4. Friends go to `http://localhost:3030`, enter the code, and click **Join Room**
5. The host approves join requests
6. Everyone clicks an empty seat to sit down
7. Click **Deal Cards** to start the first hand — subsequent hands auto-deal after 8 seconds

## Project Structure

```
PokerCal/
├── server.js                    # Express server + Socket.IO setup
├── package.json
├── public/
│   ├── index.html               # Lobby page
│   ├── game.html                # Game table page
│   ├── js/
│   │   ├── lobby.js             # Create/join room logic
│   │   ├── game.js              # Main game controller
│   │   ├── table-renderer.js    # Table, seats, cards, pot rendering
│   │   ├── controls.js          # Action buttons, bet slider, presets
│   │   ├── chat.js              # Chat panel
│   │   └── card-renderer.js     # Card face rendering
│   └── css/
│       ├── main.css             # Theme variables & global styles
│       ├── lobby.css            # Lobby layout
│       ├── table.css            # Game table & responsive breakpoints
│       └── cards.css            # Card sprites
├── src/
│   ├── game/
│   │   ├── Game.js              # Core game engine
│   │   ├── Deck.js              # Mersenne Twister deck
│   │   ├── HandEvaluator.js     # Hand ranking (Hold'em + Omaha)
│   │   ├── PotManager.js        # Side pot calculation
│   │   └── constants.js         # Phases, actions, hand ranks
│   ├── lobby/
│   │   └── LobbyManager.js     # Room code generation & storage
│   ├── player/
│   │   └── Player.js            # Player state
│   └── socket/
│       └── socketHandler.js     # All Socket.IO event handlers
└── tests/
    ├── disconnect-reconnect.test.js   # 34 unit tests
    └── e2e-disconnect.js              # Playwright E2E test
```

## Game Settings

All settings are configurable by the host in the Settings modal during a game.

| Setting | Default | Range |
|---------|---------|-------|
| Small Blind | 10 | 1+ |
| Big Blind | 20 | 2+ |
| Starting Chips | 1,000 | 100+ |
| Turn Timer | 60s | 10–300s |
| Time Bank | 120s per player | 0–600s |
| Game Mode | No Limit Hold'em | NLH / PLO5 |
| Rabbit Hunting | Off | On/Off |
| Run It Twice | Off | On/Off |
| 7-2 Bounty | Off | On/Off + amount |
| Bomb Pots | Off | On/Off + ante + frequency |

## Running Tests

```bash
# Unit tests (Jest)
npm test

# E2E disconnect/reconnect test (Playwright — requires Node 18+)
node tests/e2e-disconnect.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3030` | Server port |

## License

MIT
