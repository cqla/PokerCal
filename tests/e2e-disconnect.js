/**
 * E2E test: Disconnect/reconnect behavior during a hand.
 *
 * Scenario:
 * 1. Create a room with Player1 (host)
 * 2. Player2 joins
 * 3. Both sit down and start a hand
 * 4. Player1 refreshes mid-hand
 * 5. Verify: Player1 is back in the hand (not folded, not new user)
 * 6. Verify: hand is still in progress (not ended)
 */

var { chromium } = require('playwright');
var { spawn } = require('child_process');
var path = require('path');

var SERVER_PORT = 3031; // Use different port to avoid conflicts
var BASE_URL = 'http://localhost:' + SERVER_PORT;

async function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function startServer() {
  return new Promise(function(resolve, reject) {
    var env = Object.assign({}, process.env, { PORT: SERVER_PORT });
    var serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    var output = '';
    serverProcess.stdout.on('data', function(data) {
      output += data.toString();
      process.stdout.write('[SERVER] ' + data.toString());
      if (output.includes('running on')) {
        resolve(serverProcess);
      }
    });
    serverProcess.stderr.on('data', function(data) {
      process.stderr.write('[SERVER ERR] ' + data.toString());
    });
    serverProcess.on('error', reject);

    setTimeout(function() {
      if (!output.includes('running on')) {
        reject(new Error('Server did not start in time'));
      }
    }, 10000);
  });
}

async function runTest() {
  var server = null;
  var browser = null;
  var passed = 0;
  var failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  PASS: ' + message);
      passed++;
    } else {
      console.log('  FAIL: ' + message);
      failed++;
    }
  }

  try {
    // Start server
    console.log('Starting server...');
    server = await startServer();
    await sleep(1000);

    // Launch browser
    console.log('Launching browser...');
    browser = await chromium.launch({ headless: true });
    var context1 = await browser.newContext();
    var context2 = await browser.newContext();

    // ============ Player 1 creates room ============
    console.log('\n--- Player 1 creates room ---');
    var page1 = await context1.newPage();

    // Set localStorage name before navigating
    await page1.goto(BASE_URL);
    await page1.fill('#create-name', 'Alice');
    await page1.click('#create-btn');

    // Wait for navigation to game page
    await page1.waitForURL(/\/game\//);
    var gameUrl = page1.url();
    var roomCode = gameUrl.split('/game/')[1];
    console.log('Room created: ' + roomCode);

    // Set player name in localStorage for future page loads
    await page1.evaluate(function() { localStorage.setItem('playerName', 'Alice'); });

    await sleep(500);

    // ============ Player 2 joins ============
    console.log('\n--- Player 2 joins ---');
    var page2 = await context2.newPage();
    await page2.goto(BASE_URL);
    await page2.fill('#join-name', 'Bob');
    await page2.fill('#room-code', roomCode);
    await page2.click('#join-btn');

    // Wait for either approval or join
    await sleep(2000);

    // Check if waiting for approval
    var waitingVisible = await page2.evaluate(function() {
      var el = document.getElementById('waiting-approval');
      return el && el.style.display !== 'none';
    });

    if (waitingVisible) {
      console.log('Bob waiting for approval...');
      // Player 1 approves
      await sleep(500);
      var approved = await page1.evaluate(function() {
        var btns = document.querySelectorAll('.approve-btn');
        if (btns.length > 0) { btns[0].click(); return true; }
        return false;
      });
      console.log('Approved: ' + approved);
      await sleep(1000);
    }

    // Set localStorage for Player 2
    await page2.evaluate(function() { localStorage.setItem('playerName', 'Bob'); });

    // ============ Both players sit down ============
    console.log('\n--- Sitting players down ---');

    // Player 1 sits at seat 0
    var p1Seated = await page1.evaluate(function() {
      var seats = document.querySelectorAll('.seat-empty');
      if (seats.length > 0) { seats[0].click(); return true; }
      return false;
    });
    console.log('P1 clicked empty seat: ' + p1Seated);
    await sleep(500);

    // Handle buy-in modal if it appears
    await page1.evaluate(function() {
      var buyInBtn = document.querySelector('.buy-in-btn, #buy-in-confirm, .modal .btn-primary');
      if (buyInBtn) buyInBtn.click();
    });
    await sleep(500);

    // Player 2 sits at seat 4
    var p2Seated = await page2.evaluate(function() {
      var seats = document.querySelectorAll('.seat-empty');
      if (seats.length > 0) {
        // Click the last empty seat to get a different one
        seats[seats.length > 1 ? 1 : 0].click();
        return true;
      }
      return false;
    });
    console.log('P2 clicked empty seat: ' + p2Seated);
    await sleep(500);

    await page2.evaluate(function() {
      var buyInBtn = document.querySelector('.buy-in-btn, #buy-in-confirm, .modal .btn-primary');
      if (buyInBtn) buyInBtn.click();
    });
    await sleep(1000);

    // ============ Start the hand ============
    console.log('\n--- Starting hand ---');

    // Click "Deal Cards" button
    var dealClicked = await page1.evaluate(function() {
      var btns = document.querySelectorAll('.btn');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === 'Deal Cards') {
          btns[i].click();
          return true;
        }
      }
      return false;
    });
    console.log('Deal clicked: ' + dealClicked);
    await sleep(2000);

    // Check game state before refresh
    var preRefreshState = await page1.evaluate(function() {
      var state = window.__lastState || null;
      // Try to get phase from the UI
      var cards = document.querySelectorAll('.my-cards .card');
      var actionBtns = document.querySelectorAll('.action-btn');
      var blindInfo = document.getElementById('blind-info');
      return {
        hasCards: cards.length > 0,
        actionButtons: actionBtns.length,
        blindInfo: blindInfo ? blindInfo.textContent : '',
        bodyText: document.body.innerText.substring(0, 500)
      };
    });
    console.log('Pre-refresh state:', JSON.stringify(preRefreshState, null, 2));

    // Get server-side state through the socket
    var serverPhase1 = await page1.evaluate(function() {
      return new Promise(function(resolve) {
        // Listen for next game-state to check phase
        var socket = window.__socket || io();
        // Just check current UI for phase indicators
        var hasMyCards = document.querySelectorAll('.my-cards .card').length > 0;
        var hasCommunity = document.querySelectorAll('.community-cards .card').length > 0;
        var waitingControls = document.querySelector('.waiting-controls');
        var isWaiting = waitingControls && waitingControls.style.display !== 'none';
        var turnTimer = document.querySelector('.turn-timer-bar');
        resolve({
          hasMyCards: hasMyCards,
          hasCommunity: hasCommunity,
          isWaiting: isWaiting,
          hasTurnTimer: turnTimer !== null
        });
      });
    });
    console.log('Phase indicators before refresh:', JSON.stringify(serverPhase1));

    assert(preRefreshState.hasCards, 'Player1 has hole cards before refresh');

    // ============ REFRESH Player 1 ============
    console.log('\n--- Refreshing Player 1 page ---');

    // Capture server output during refresh
    await page1.reload({ waitUntil: 'networkidle' });
    await sleep(3000);

    // ============ Check post-refresh state ============
    console.log('\n--- Checking post-refresh state ---');

    var postRefreshState = await page1.evaluate(function() {
      var cards = document.querySelectorAll('.my-cards .card');
      var actionBtns = document.querySelectorAll('.action-btn');
      var dealBtn = null;
      var btns = document.querySelectorAll('.btn');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === 'Deal Cards') {
          dealBtn = btns[i];
          break;
        }
      }
      var players = document.querySelectorAll('.seat-info');
      var playerNames = [];
      for (var i = 0; i < players.length; i++) {
        var nameEl = players[i].querySelector('.seat-name');
        if (nameEl) playerNames.push(nameEl.textContent);
      }

      // Check if name was changed (deduplication bug)
      var nameChanged = document.body.innerText.includes('Alice2') || document.body.innerText.includes('Alice3');

      return {
        hasCards: cards.length > 0,
        cardCount: cards.length,
        actionButtons: actionBtns.length,
        hasDealButton: dealBtn !== null && dealBtn.offsetParent !== null,
        playerNames: playerNames,
        nameWasChanged: nameChanged,
        bodySnippet: document.body.innerText.substring(0, 800)
      };
    });
    console.log('Post-refresh state:', JSON.stringify(postRefreshState, null, 2));

    // Also check Player 2's view
    var p2State = await page2.evaluate(function() {
      var cards = document.querySelectorAll('.my-cards .card');
      var players = document.querySelectorAll('.seat-info');
      var playerNames = [];
      for (var i = 0; i < players.length; i++) {
        var nameEl = players[i].querySelector('.seat-name');
        if (nameEl) playerNames.push(nameEl.textContent);
      }
      var communityCards = document.querySelectorAll('.community-cards .card');
      return {
        hasCards: cards.length > 0,
        playerNames: playerNames,
        communityCardCount: communityCards.length,
        bodySnippet: document.body.innerText.substring(0, 500)
      };
    });
    console.log('Player 2 state:', JSON.stringify(p2State, null, 2));

    // ============ Assertions ============
    console.log('\n--- Results ---');
    assert(!postRefreshState.nameWasChanged, 'Player1 name was NOT changed (no deduplication)');
    assert(postRefreshState.hasCards, 'Player1 still has hole cards after refresh');
    assert(!postRefreshState.hasDealButton, 'Deal button is NOT visible (hand still in progress)');
    assert(postRefreshState.actionButtons > 0 || postRefreshState.hasCards, 'Player1 can still play (has cards or action buttons)');

    // Check P2 doesn't see "Alice2"
    var p2SeesOrigName = p2State.playerNames.some(function(n) { return n.includes('Alice') && !n.includes('Alice2'); });
    assert(p2SeesOrigName, 'Player2 sees original "Alice" name (not deduplicated)');

    console.log('\n===================');
    console.log('Passed: ' + passed + '/' + (passed + failed));
    console.log('Failed: ' + failed + '/' + (passed + failed));
    if (failed > 0) console.log('STATUS: SOME TESTS FAILED');
    else console.log('STATUS: ALL TESTS PASSED');

  } catch(err) {
    console.error('Test error:', err);
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill();
      await sleep(500);
    }
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTest();
