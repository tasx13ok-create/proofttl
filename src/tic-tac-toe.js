const GAME_PATTERN = /\btic[\s-]*tac[\s-]*toe\b/i;
const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const STATE_PATTERN = /TIC-TAC-TOE STATE\s*·\s*BOARD=([XO.]{9})\s*·\s*YOU=([XO])\s*·\s*LOVE=([XO])(?:\s*·\s*STATUS=([a-z_]+))?/i;
const LEGACY_ROLE_PATTERN = /TIC-TAC-TOE STATE\s*·\s*YOU=([XO])\s*·\s*LOVE=([XO])/i;

export function handleTicTacToe(message, history = []) {
  const cleanMessage = String(message || '').trim();
  const previous = latestState(history);
  const active = Boolean(previous) || GAME_PATTERN.test(cleanMessage) || history.some((item) => GAME_PATTERN.test(item?.content || '') || /TIC-TAC-TOE STATE/i.test(item?.content || ''));
  if (!active) return null;

  const restart = /\b(play again|new game|restart|reset(?: the)? game)\b/i.test(cleanMessage);
  const startRequested = restart || (GAME_PATTERN.test(cleanMessage) && !/^\s*[1-9]\s*$/.test(cleanMessage));
  const symbols = previous ? { user: previous.user, assistant: previous.assistant } : inferSymbols(cleanMessage, history);

  if (startRequested) return startGame(symbols.user, symbols.assistant, cleanMessage);
  if (!/^\s*[1-9]\s*$/.test(cleanMessage)) return null;

  const recovered = previous || recoverLegacyState(history, symbols);
  const board = recovered ? [...recovered.board] : Array(9).fill(null);
  const userSymbol = recovered?.user || symbols.user;
  const aiSymbol = recovered?.assistant || symbols.assistant;
  const priorWinner = winner(board);
  if (priorWinner || board.every(Boolean)) {
    const status = priorWinner === userSymbol ? 'user_won' : priorWinner === aiSymbol ? 'assistant_won' : 'draw';
    return result(board, userSymbol, aiSymbol, status, `That round is already over. Say “play again” to start a new board.`);
  }

  const square = Number(cleanMessage) - 1;
  if (board[square]) return result(board, userSymbol, aiSymbol, 'active', 'That square is already taken. Pick an open number.');

  board[square] = userSymbol;
  if (winner(board) === userSymbol) return result(board, userSymbol, aiSymbol, 'user_won', 'You got it. You win.');
  if (board.every(Boolean)) return result(board, userSymbol, aiSymbol, 'draw', 'Draw.');

  const aiMove = bestMove(board, aiSymbol, userSymbol);
  if (aiMove >= 0) board[aiMove] = aiSymbol;
  const boardWinner = winner(board);
  const status = boardWinner === aiSymbol ? 'assistant_won' : board.every(Boolean) ? 'draw' : 'active';
  const lead = status === 'assistant_won' ? 'I win this one.' : status === 'draw' ? 'Draw.' : `I played ${aiMove + 1}. Your move.`;
  return result(board, userSymbol, aiSymbol, status, lead);
}

function startGame(userSymbol, aiSymbol, message) {
  const board = Array(9).fill(null);
  const wantsAssistantFirst = /\b(you|love|l\.o\.v\.e\.)\s+(?:go|play)\s+first\b/i.test(message) || aiSymbol === 'X';
  let lead = `Tic-Tac-Toe. You're ${userSymbol}; I'm ${aiSymbol}.`;
  if (wantsAssistantFirst) {
    const opening = bestMove(board, aiSymbol, userSymbol);
    if (opening >= 0) board[opening] = aiSymbol;
    lead += ` I played ${opening + 1}. Your move.`;
  } else {
    lead += ' Your move.';
  }
  return result(board, userSymbol, aiSymbol, 'active', lead);
}

function result(board, userSymbol, aiSymbol, status, lead) {
  return {
    state: { board: [...board], user: userSymbol, assistant: aiSymbol, status },
    response: [
      lead,
      '',
      renderBoard(board),
      '',
      stateMarker(board, userSymbol, aiSymbol, status),
      ...(status === 'active' ? ['Send an open square number.'] : ['Say “play again” if you want another round.'])
    ].join('\n')
  };
}

function latestState(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role !== 'assistant') continue;
    const match = String(history[index]?.content || '').match(STATE_PATTERN);
    if (!match) continue;
    const board = [...match[1].toUpperCase()].map((cell) => cell === 'X' || cell === 'O' ? cell : null);
    const user = match[2].toUpperCase();
    const assistant = match[3].toUpperCase();
    if (user === assistant) continue;
    return { board, user, assistant, status: match[4] || inferStatus(board, user, assistant) };
  }
  return null;
}

function recoverLegacyState(history, symbols) {
  const board = parseLatestBoard(history) || inferBoardFromMoveNarration(history, symbols);
  if (!board) return null;
  return { board, user: symbols.user, assistant: symbols.assistant, status: inferStatus(board, symbols.user, symbols.assistant) };
}

function inferSymbols(message, history) {
  const userCurrent = roleSymbols(message, 'user');
  if (userCurrent) return userCurrent;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const legacy = String(item?.content || '').match(LEGACY_ROLE_PATTERN);
    if (legacy) return { user: legacy[1].toUpperCase(), assistant: legacy[2].toUpperCase() };
    const inferred = roleSymbols(item?.content || '', item?.role);
    if (inferred) return inferred;
  }
  return { user: 'X', assistant: 'O' };
}

function roleSymbols(text, role) {
  const value = String(text || '');
  const self = value.match(/\bI(?:'ll| will|'m| am)?\s+(?:be\s+|play(?:ing)?\s+(?:as\s+)?)?([XO])\b/i);
  const other = value.match(/\byou(?:'ll| will|'re| are)?\s+(?:be\s+|play(?:ing)?\s+(?:as\s+)?)?([XO])\b/i);
  if (!self && !other) return null;

  if (role === 'assistant') {
    const assistant = self?.[1]?.toUpperCase() || opposite(other?.[1]);
    const user = other?.[1]?.toUpperCase() || opposite(assistant);
    return validSymbols(user, assistant) ? { user, assistant } : null;
  }

  const user = self?.[1]?.toUpperCase() || opposite(other?.[1]);
  const assistant = other?.[1]?.toUpperCase() || opposite(user);
  return validSymbols(user, assistant) ? { user, assistant } : null;
}

function opposite(symbol) {
  const value = String(symbol || '').toUpperCase();
  return value === 'X' ? 'O' : value === 'O' ? 'X' : '';
}

function validSymbols(user, assistant) {
  return (user === 'X' || user === 'O') && (assistant === 'X' || assistant === 'O') && user !== assistant;
}

function parseLatestBoard(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role !== 'assistant') continue;
    const parsed = parseBoard(history[index]?.content || '');
    if (parsed) return parsed;
  }
  return null;
}

function parseBoard(text) {
  const value = String(text || '');
  const marker = value.match(STATE_PATTERN);
  if (marker) return [...marker[1].toUpperCase()].map((cell) => cell === 'X' || cell === 'O' ? cell : null);

  const rows = [];
  const rowPattern = /([XO1-9]?)[ \t]*\|[ \t]*([XO1-9]?)[ \t]*\|[ \t]*([XO1-9]?)/gi;
  let match;
  while ((match = rowPattern.exec(value)) !== null) {
    rows.push(match.slice(1, 4).map((cell) => /^[XO]$/i.test(cell) ? cell.toUpperCase() : null));
  }
  if (rows.length >= 3) return rows.slice(-3).flat();
  return null;
}

function inferBoardFromMoveNarration(history, symbols) {
  const board = Array(9).fill(null);
  let found = false;
  for (const item of history) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const symbol = role === 'assistant' ? symbols.assistant : symbols.user;
    const text = String(item?.content || '');
    const patterns = [
      /\b(?:position|square|spot)\s*\(?([1-9])\)?/gi,
      /\b(?:in|at|on)\s+(?:the\s+)?(?:center|centre)\b/gi,
    ];
    let match;
    while ((match = patterns[0].exec(text)) !== null) {
      const index = Number(match[1]) - 1;
      if (!board[index]) { board[index] = symbol; found = true; }
    }
    if (patterns[1].test(text) && !board[4]) { board[4] = symbol; found = true; }
  }
  return found ? board : null;
}

function stateMarker(board, user, assistant, status) {
  const encoded = board.map((cell) => cell || '.').join('');
  return `TIC-TAC-TOE STATE · BOARD=${encoded} · YOU=${user} · LOVE=${assistant} · STATUS=${status}`;
}

function renderBoard(board) {
  const cell = (index) => board[index] || String(index + 1);
  return `${cell(0)} | ${cell(1)} | ${cell(2)}\n--+---+--\n${cell(3)} | ${cell(4)} | ${cell(5)}\n--+---+--\n${cell(6)} | ${cell(7)} | ${cell(8)}`;
}

function inferStatus(board, user, assistant) {
  const boardWinner = winner(board);
  if (boardWinner === user) return 'user_won';
  if (boardWinner === assistant) return 'assistant_won';
  return board.every(Boolean) ? 'draw' : 'active';
}

function winner(board) {
  for (const [a, b, c] of WINS) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}

function bestMove(board, aiSymbol, userSymbol) {
  if (board.every((cell) => !cell)) return 4;
  let bestScore = -Infinity;
  let best = -1;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index]) continue;
    board[index] = aiSymbol;
    const score = minimax(board, false, aiSymbol, userSymbol, 0);
    board[index] = null;
    if (score > bestScore) { bestScore = score; best = index; }
  }
  return best;
}

function minimax(board, maximizing, aiSymbol, userSymbol, depth) {
  const boardWinner = winner(board);
  if (boardWinner === aiSymbol) return 10 - depth;
  if (boardWinner === userSymbol) return depth - 10;
  if (board.every(Boolean)) return 0;

  if (maximizing) {
    let best = -Infinity;
    for (let index = 0; index < board.length; index += 1) {
      if (board[index]) continue;
      board[index] = aiSymbol;
      best = Math.max(best, minimax(board, false, aiSymbol, userSymbol, depth + 1));
      board[index] = null;
    }
    return best;
  }

  let best = Infinity;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index]) continue;
    board[index] = userSymbol;
    best = Math.min(best, minimax(board, true, aiSymbol, userSymbol, depth + 1));
    board[index] = null;
  }
  return best;
}
