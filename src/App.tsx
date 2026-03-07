import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import './App.css';
import {
  advanceGame,
  createInitialState,
  findPathToPosition,
  formatPosition,
  generateLevel,
  getAllChipsMask,
  getBoardSize,
  getCollectedChipCount,
  getDiamonds,
  getNextPosition,
  getPolygonPoints,
  getPositionCenter,
  getSquares,
  getWalkableMoves,
  isChipCollected,
  isFloor,
  isSamePosition,
  positionKey,
  type BoardSpec,
  type Direction,
  type LevelSpec,
  type Position,
} from './game';

const BOARD: BoardSpec = {
  cols: 35,
  rows: 29,
};

const SPACING = 60;
const CORNER_CUT = 12;
const BOARD_PADDING = 30;
const VIEWPORT_SIZE = SPACING * 9.25;
const TICK_RATE_HZ = 10;

const KEY_TO_DIRECTION: Record<string, Direction> = {
  w: 'N',
  arrowup: 'N',
  a: 'W',
  arrowleft: 'W',
  s: 'S',
  arrowdown: 'S',
  d: 'E',
  arrowright: 'E',
  q: 'NW',
  e: 'NE',
  z: 'SW',
  c: 'SE',
};

const DIRECTION_TO_OVERLAY_LABEL: Record<Direction, string> = {
  N: '↑',
  W: '←',
  S: '↓',
  E: '→',
  NW: 'Q',
  NE: 'E',
  SW: 'Z',
  SE: 'C',
};

const CONTROL_METADATA: Record<
  Direction,
  {
    keys: string;
    label: string;
  }
> = {
  N: { keys: 'W / ↑', label: 'north' },
  W: { keys: 'A / ←', label: 'west' },
  S: { keys: 'S / ↓', label: 'south' },
  E: { keys: 'D / →', label: 'east' },
  NW: { keys: 'Q', label: 'north-west' },
  NE: { keys: 'E', label: 'north-east' },
  SW: { keys: 'Z', label: 'south-west' },
  SE: { keys: 'C', label: 'south-east' },
};

const CONTROL_PAD_LAYOUT: Array<Array<Direction | 'CENTER'>> = [
  ['NW', 'N', 'NE'],
  ['W', 'CENTER', 'E'],
  ['SW', 'S', 'SE'],
];

const SQUARES = getSquares(BOARD);
const DIAMONDS = getDiamonds(BOARD);
const BOARD_SIZE = getBoardSize(BOARD, SPACING);

type HeldInput = {
  direction: Direction;
  key: string;
};

type StatusChipProps = {
  children: ReactNode;
  label: string;
};

type TileProps = {
  allChipsCollected: boolean;
  doorOpened: boolean;
  level: LevelSpec;
  position: Position;
};

type DoorGlyphProps = {
  center: {
    x: number;
    y: number;
  };
  ready: boolean;
};

type ExitGlyphProps = {
  center: {
    x: number;
    y: number;
  };
  open: boolean;
  won: boolean;
};

function App() {
  const [level, setLevel] = useState<LevelSpec>(() => generateLevel(BOARD));
  const [gameState, setGameState] = useState(() => createInitialState(level));
  const [heldInputs, setHeldInputs] = useState<HeldInput[]>([]);
  const [plannedRoute, setPlannedRoute] = useState<Direction[]>([]);
  const heldInputsRef = useRef<HeldInput[]>([]);
  const gameStateRef = useRef(gameState);
  const plannedRouteRef = useRef<Direction[]>([]);

  const syncHeldInputs = useEffectEvent((nextInputs: HeldInput[]) => {
    heldInputsRef.current = nextInputs;
    setHeldInputs(nextInputs);
  });

  const syncPlannedRoute = useEffectEvent((nextRoute: Direction[]) => {
    plannedRouteRef.current = nextRoute;
    setPlannedRoute(nextRoute);
  });

  const clearPlannedMovement = useEffectEvent(() => {
    syncPlannedRoute([]);
  });

  const issuePadMove = useEffectEvent((direction: Direction) => {
    if (gameStateRef.current.won) {
      return;
    }

    syncHeldInputs([]);
    syncPlannedRoute([direction]);
  });

  const navigateToPosition = useEffectEvent((target: Position) => {
    const currentState = gameStateRef.current;

    if (currentState.won || isSamePosition(target, currentState.player)) {
      return;
    }

    const route = findPathToPosition(level, currentState, target);

    if (!route || route.length === 0) {
      return;
    }

    syncHeldInputs([]);
    syncPlannedRoute(route);
  });

  const tickGame = useEffectEvent(() => {
    const currentState = gameStateRef.current;
    const heldDirection = heldInputsRef.current.at(-1)?.direction ?? null;
    const plannedDirection = plannedRouteRef.current[0] ?? null;
    const direction = heldDirection ?? plannedDirection;
    const wasCooling = currentState.cooldownTicks > 0;
    const nextState = advanceGame(level, currentState, direction);
    const moved = !isSamePosition(currentState.player, nextState.player);

    if (!heldDirection && plannedDirection && !wasCooling) {
      syncPlannedRoute(moved ? plannedRouteRef.current.slice(1) : []);
    }

    gameStateRef.current = nextState;
    setGameState(nextState);
  });

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      tickGame();
    }, 1000 / TICK_RATE_HZ);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const direction = KEY_TO_DIRECTION[key];

      if (!direction) {
        return;
      }

      event.preventDefault();

      if (heldInputsRef.current.some((entry) => entry.key === key)) {
        return;
      }

      syncPlannedRoute([]);
      syncHeldInputs([...heldInputsRef.current, { direction, key }]);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (!KEY_TO_DIRECTION[key]) {
        return;
      }

      const nextInputs = heldInputsRef.current.filter((entry) => entry.key !== key);

      syncHeldInputs(nextInputs);
    };

    const clearInputs = () => {
      syncHeldInputs([]);
      clearPlannedMovement();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearInputs);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearInputs);
    };
  }, []);

  const resetRun = () => {
    syncHeldInputs([]);
    clearPlannedMovement();

    const nextState = createInitialState(level);

    gameStateRef.current = nextState;
    setGameState(nextState);
  };

  const regenerateMaze = () => {
    const nextLevel = generateLevel(BOARD);
    const nextState = createInitialState(nextLevel);

    syncHeldInputs([]);
    clearPlannedMovement();
    gameStateRef.current = nextState;
    setLevel(nextLevel);
    setGameState(nextState);
  };

  const reachableTargets = getWalkableMoves(
    level,
    gameState.player,
    gameState.collectedChipMask,
    gameState.doorOpened,
  )
    .map((direction) => {
      const position = getNextPosition(level.board, gameState.player, direction);

      if (!position) {
        return null;
      }

      return {
        direction,
        position,
      };
    })
    .filter((entry): entry is { direction: Direction; position: Position } => entry !== null);

  const playerCenter = getPositionCenter(gameState.player, SPACING);
  const viewBoxMetrics = {
    minX: playerCenter.x - VIEWPORT_SIZE / 2 - BOARD_PADDING,
    minY: playerCenter.y - VIEWPORT_SIZE / 2 - BOARD_PADDING,
    width: VIEWPORT_SIZE + BOARD_PADDING * 2,
    height: VIEWPORT_SIZE + BOARD_PADDING * 2,
  };
  const viewBox = `${viewBoxMetrics.minX} ${viewBoxMetrics.minY} ${viewBoxMetrics.width} ${viewBoxMetrics.height}`;
  const activeKeyboardInput = heldInputs.at(-1) ?? null;
  const activeDirection = activeKeyboardInput?.direction ?? plannedRoute[0] ?? null;
  const activeInputLabel =
    activeKeyboardInput
      ? `${formatKey(activeKeyboardInput.key)} / ${activeKeyboardInput.direction}`
      : plannedRoute.length > 0
        ? `route / ${plannedRoute[0]} (${plannedRoute.length})`
        : 'idle';
  const navigationStatus =
    activeKeyboardInput
      ? `keyboard ${activeKeyboardInput.direction}`
      : plannedRoute.length > 1
        ? `${plannedRoute.length} queued steps`
        : plannedRoute.length === 1
          ? `single click step ${plannedRoute[0]}`
          : 'idle';
  const onDiamond = gameState.player.kind === 'diamond';
  const highlightedTile = getPolygonPoints(gameState.player, SPACING, CORNER_CUT);
  const collectedChipCount = getCollectedChipCount(level, gameState);
  const allChipsCollected = gameState.collectedChipMask === getAllChipsMask(level);
  const objectiveStatus = gameState.won
    ? 'Yowzer! Nice one!'
    : gameState.doorOpened
      ? 'bright blue exit live'
      : allChipsCollected
        ? 'unlock the door'
        : `${level.chips.length - collectedChipCount} chips remaining`;

  return (
    <div className="app-shell">
      <main className="layout">
        <section className="hero">
          <p className="eyebrow">Graph-built labyrinth</p>
          <h1>Octocc</h1>
          <p className="lede">
            The maze now grows as a branching lattice graph with side passages, dead ends,
            room pockets, and loopbacks. Collect every amber chip, collapse the door into
            floor, and then head for the bright blue exit.
          </p>
          {gameState.won ? <p className="win-callout">Yowzer! Nice one!</p> : null}
          <div className="status-row">
            <StatusChip label="Tick">{gameState.tick}</StatusChip>
            <StatusChip label="Cooldown">
              {gameState.cooldownTicks === 0 ? 'ready' : `${gameState.cooldownTicks} tick`}
            </StatusChip>
            <StatusChip label="Objective">{objectiveStatus}</StatusChip>
            <StatusChip label="Active input">{activeInputLabel}</StatusChip>
          </div>
        </section>

        <section className="board-panel">
          <div className="board-frame">
            <svg
              aria-label="A scrolling square-and-diamond maze with chips, a locked door, and a blue exit."
              onClick={(event) => {
                const target = resolveBoardSelection(event, level, viewBoxMetrics);

                if (target) {
                  navigateToPosition(target);
                }
              }}
              role="img"
              viewBox={viewBox}
            >
              <defs>
                <linearGradient id="board-surface" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#eee2cf" />
                  <stop offset="100%" stopColor="#cab393" />
                </linearGradient>
                <linearGradient id="chip-fill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffe08a" />
                  <stop offset="100%" stopColor="#f08b37" />
                </linearGradient>
                <linearGradient id="exit-fill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a8f4ff" />
                  <stop offset="45%" stopColor="#49b6ff" />
                  <stop offset="100%" stopColor="#004dff" />
                </linearGradient>
              </defs>

              <rect
                x={-BOARD_PADDING}
                y={-BOARD_PADDING}
                width={BOARD_SIZE.x + BOARD_PADDING * 2}
                height={BOARD_SIZE.y + BOARD_PADDING * 2}
                rx={32}
                className="board-backdrop"
                fill="url(#board-surface)"
              />

              <g className="tile-layer">
                {SQUARES.map((square) => (
                  <Tile
                    key={positionKey(square)}
                    allChipsCollected={allChipsCollected}
                    doorOpened={gameState.doorOpened}
                    level={level}
                    position={square}
                  />
                ))}
                {DIAMONDS.map((diamond) => (
                  <Tile
                    key={positionKey(diamond)}
                    allChipsCollected={allChipsCollected}
                    doorOpened={gameState.doorOpened}
                    level={level}
                    position={diamond}
                  />
                ))}
              </g>

              {level.chips.map((chip, chipIndex) => {
                if (isChipCollected(gameState, chipIndex)) {
                  return null;
                }

                const center = getPositionCenter(chip, SPACING);

                return (
                  <g key={positionKey(chip)} className="chip-layer">
                    <polygon className="chip-shell" points={getOctagonPoints(center.x, center.y, 10)} />
                    <polygon
                      className="chip-core"
                      fill="url(#chip-fill)"
                      points={getDiamondPoints(center.x, center.y, 6)}
                    />
                  </g>
                );
              })}

              {!gameState.doorOpened ? (
                <g className="door-layer">
                  <DoorGlyph
                    center={getPositionCenter(level.door, SPACING)}
                    ready={allChipsCollected}
                  />
                </g>
              ) : null}

              <g className="exit-layer">
                <ExitGlyph
                  center={getPositionCenter(level.exit, SPACING)}
                  open={gameState.doorOpened}
                  won={gameState.won}
                />
              </g>

              <polygon className="tile-highlight" points={highlightedTile} />

              <g className="reachable-layer">
                {reachableTargets.map(({ direction, position }) => {
                  const center = getPositionCenter(position, SPACING);

                  return (
                    <g key={`${direction}-${positionKey(position)}`}>
                      <circle className="reachable-marker" cx={center.x} cy={center.y} r={11} />
                      <text className="reachable-label" x={center.x} y={center.y + 0.5}>
                        {DIRECTION_TO_OVERLAY_LABEL[direction]}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g className="player-layer">
                <circle className="player-shadow" cx={playerCenter.x} cy={playerCenter.y} r={15} />
                <circle
                  className={`player-core${gameState.cooldownTicks > 0 ? ' player-core--cooling' : ''}${gameState.won ? ' player-core--won' : ''}`}
                  cx={playerCenter.x}
                  cy={playerCenter.y}
                  r={12}
                />
                <circle className="player-center" cx={playerCenter.x} cy={playerCenter.y} r={4} />
              </g>
            </svg>
          </div>
          <p className="board-note">
            Click any floor square or diamond to route there. Adjacent clicks queue a single
            move; longer clicks run a BFS path and feed one step per legal tick until you
            interrupt it with new input.
          </p>
        </section>

        <aside className="sidebar">
          <section className="panel">
            <h2>Controls</h2>
            <div className="control-pad">
              {CONTROL_PAD_LAYOUT.flatMap((row, rowIndex) =>
                row.map((cell, columnIndex) => {
                  if (cell === 'CENTER') {
                    return (
                      <div
                        key={`center-${rowIndex}-${columnIndex}`}
                        aria-hidden="true"
                        className="control-pad__center"
                      >
                        *
                      </div>
                    );
                  }

                  const metadata = CONTROL_METADATA[cell];

                  return (
                    <button
                      key={cell}
                      aria-label={`${metadata.label}, ${metadata.keys}`}
                      className={`control-pad__button${activeDirection === cell ? ' control-pad__button--active' : ''}`}
                      onClick={() => {
                        issuePadMove(cell);
                      }}
                      type="button"
                    >
                      <span className="control-pad__dir">{cell}</span>
                      <span className="control-pad__keys">{metadata.keys}</span>
                    </button>
                  );
                }),
              )}
            </div>
            <p className="control-note">
              Cardinals use WASD or the arrow keys. Diagonals use QEZC. Clicking the board
              routes with BFS and any later click or key press overrides that route.
            </p>
          </section>

          <section className="panel">
            <h2>State</h2>
            <dl className="detail-list">
              <div className="detail-item">
                <dt>Node</dt>
                <dd>{formatPosition(gameState.player)}</dd>
              </div>
              <div className="detail-item">
                <dt>Surface</dt>
                <dd>{onDiamond ? 'diamond floor' : 'square floor'}</dd>
              </div>
              <div className="detail-item">
                <dt>Chips</dt>
                <dd>
                  {collectedChipCount} / {level.chips.length}
                </dd>
              </div>
              <div className="detail-item">
                <dt>Door</dt>
                <dd>
                  {gameState.doorOpened
                    ? 'opened into floor'
                    : allChipsCollected
                      ? 'ready to unlock'
                      : 'sealed'}
                </dd>
              </div>
              <div className="detail-item">
                <dt>Exit</dt>
                <dd>{gameState.doorOpened ? 'bright blue and open' : 'guarded'}</dd>
              </div>
              <div className="detail-item">
                <dt>Navigation</dt>
                <dd>{navigationStatus}</dd>
              </div>
              <div className="detail-item">
                <dt>Verified route</dt>
                <dd>{level.solutionLength} BFS steps</dd>
              </div>
            </dl>
            <p className="mini-note">
              {gameState.won
                ? 'Maze complete. Yowzer! Nice one!'
                : onDiamond
                  ? 'Diamond vertices still reject the cardinal moves, so BFS only chains diagonals out of them.'
                  : 'Squares still allow both the cardinals and the diagonals when the destination node is floor.'}
            </p>
            <div className="button-row">
              <button className="reset-button" onClick={resetRun} type="button">
                Reset run
              </button>
              <button
                className="reset-button reset-button--secondary"
                onClick={regenerateMaze}
                type="button"
              >
                New maze
              </button>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function Tile({
  allChipsCollected,
  doorOpened,
  level,
  position,
}: TileProps) {
  const classes = ['tile', position.kind === 'square' ? 'tile--square' : 'tile--diamond'];
  const walkable = isFloor(level, position);

  classes.push(walkable ? 'tile--floor' : 'tile--wall');

  if (!doorOpened && isSamePosition(position, level.door)) {
    classes.push('tile--door');

    if (allChipsCollected) {
      classes.push('tile--door-ready');
    }
  }

  if (isSamePosition(position, level.exit)) {
    classes.push(doorOpened ? 'tile--exit-open' : 'tile--exit-locked');
  }

  if (walkable) {
    classes.push('tile--interactive');
  }

  return <polygon className={classes.join(' ')} points={getPolygonPoints(position, SPACING, CORNER_CUT)} />;
}

function DoorGlyph({ center, ready }: DoorGlyphProps) {
  return (
    <g className={`door-glyph${ready ? ' door-glyph--ready' : ''}`}>
      <rect className="door-slab" x={center.x - 10} y={center.y - 13} width={20} height={26} rx={4} />
      <line className="door-bar" x1={center.x - 7} y1={center.y} x2={center.x + 7} y2={center.y} />
      <circle className="door-pin" cx={center.x + 4.5} cy={center.y + 2} r={1.8} />
    </g>
  );
}

function ExitGlyph({ center, open, won }: ExitGlyphProps) {
  return (
    <g className={`exit-glyph${open ? ' exit-glyph--open' : ''}${won ? ' exit-glyph--won' : ''}`}>
      <circle className="exit-halo" cx={center.x} cy={center.y} r={18} />
      <circle className="exit-ring" cx={center.x} cy={center.y} r={11} />
      <circle className="exit-core" cx={center.x} cy={center.y} r={5} fill="url(#exit-fill)" />
    </g>
  );
}

function StatusChip({ children, label }: StatusChipProps) {
  return (
    <div className="status-chip">
      <span className="status-chip__label">{label}</span>
      <span className="status-chip__value">{children}</span>
    </div>
  );
}

function formatKey(key: string): string {
  switch (key) {
    case 'arrowup':
      return '↑';
    case 'arrowleft':
      return '←';
    case 'arrowdown':
      return '↓';
    case 'arrowright':
      return '→';
    default:
      return key.toUpperCase();
  }
}

function getOctagonPoints(x: number, y: number, radius: number): string {
  const inset = radius * 0.42;

  return [
    `${x - inset},${y - radius}`,
    `${x + inset},${y - radius}`,
    `${x + radius},${y - inset}`,
    `${x + radius},${y + inset}`,
    `${x + inset},${y + radius}`,
    `${x - inset},${y + radius}`,
    `${x - radius},${y + inset}`,
    `${x - radius},${y - inset}`,
  ].join(' ');
}

function getDiamondPoints(x: number, y: number, radius: number): string {
  return [
    `${x},${y - radius}`,
    `${x + radius},${y}`,
    `${x},${y + radius}`,
    `${x - radius},${y}`,
  ].join(' ');
}

function resolveBoardSelection(
  event: ReactMouseEvent<SVGSVGElement>,
  level: LevelSpec,
  viewBox: { height: number; minX: number; minY: number; width: number },
): Position | null {
  const boardPoint = getBoardPoint(event, viewBox);
  const candidates = getClickCandidates(level.board, boardPoint);
  const exactHits = candidates.filter((position) => {
    return isPointInPolygon(boardPoint, getPolygonVertices(position));
  });

  if (exactHits.length > 0) {
    return chooseNearestPosition(boardPoint, exactHits);
  }

  const fuzzyHits = candidates.filter((position) => {
    if (!isFloor(level, position)) {
      return false;
    }

    const center = getPositionCenter(position, SPACING);
    const radius = position.kind === 'diamond' ? CORNER_CUT + 10 : SPACING * 0.42;

    return getDistance(boardPoint, center) <= radius;
  });

  if (fuzzyHits.length > 0) {
    return chooseNearestPosition(boardPoint, fuzzyHits);
  }

  return null;
}

function getBoardPoint(
  event: ReactMouseEvent<SVGSVGElement>,
  viewBox: { height: number; minX: number; minY: number; width: number },
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = viewBox.minX + ((event.clientX - rect.left) / rect.width) * viewBox.width;
  const y = viewBox.minY + ((event.clientY - rect.top) / rect.height) * viewBox.height;

  return { x, y };
}

function getClickCandidates(
  board: BoardSpec,
  point: { x: number; y: number },
): Position[] {
  const candidates = new Map<string, Position>();
  const squareBaseCol = Math.round(point.x / SPACING - 0.5);
  const squareBaseRow = Math.round(point.y / SPACING - 0.5);
  const diamondBaseCol = Math.round(point.x / SPACING);
  const diamondBaseRow = Math.round(point.y / SPACING);

  for (let row = squareBaseRow - 1; row <= squareBaseRow + 1; row += 1) {
    for (let col = squareBaseCol - 1; col <= squareBaseCol + 1; col += 1) {
      if (col < 0 || col >= board.cols || row < 0 || row >= board.rows) {
        continue;
      }

      const position: Position = { kind: 'square', col, row };

      candidates.set(positionKey(position), position);
    }
  }

  for (let row = diamondBaseRow - 1; row <= diamondBaseRow + 1; row += 1) {
    for (let col = diamondBaseCol - 1; col <= diamondBaseCol + 1; col += 1) {
      if (col < 0 || col > board.cols || row < 0 || row > board.rows) {
        continue;
      }

      const position: Position = { kind: 'diamond', col, row };

      candidates.set(positionKey(position), position);
    }
  }

  return [...candidates.values()];
}

function chooseNearestPosition(
  point: { x: number; y: number },
  positions: Position[],
): Position | null {
  let bestPosition: Position | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const position of positions) {
    const distance = getDistance(point, getPositionCenter(position, SPACING));

    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = position;
    }
  }

  return bestPosition;
}

function getPolygonVertices(position: Position): Array<{ x: number; y: number }> {
  return getPolygonPoints(position, SPACING, CORNER_CUT)
    .split(' ')
    .map((point) => {
      const [x, y] = point.split(',').map(Number);

      return { x, y };
    });
}

function isPointInPolygon(
  point: { x: number; y: number },
  vertices: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;

  for (let index = 0, previousIndex = vertices.length - 1; index < vertices.length; previousIndex = index, index += 1) {
    const current = vertices[index];
    const previous = vertices[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) +
          current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function getDistance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export default App;
