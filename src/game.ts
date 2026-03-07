export type CardinalDirection = 'N' | 'W' | 'S' | 'E';
export type DiagonalDirection = 'NW' | 'NE' | 'SW' | 'SE';
export type Direction = CardinalDirection | DiagonalDirection;

export type SquarePosition = {
  kind: 'square';
  col: number;
  row: number;
};

export type DiamondPosition = {
  kind: 'diamond';
  col: number;
  row: number;
};

export type Position = SquarePosition | DiamondPosition;

export type BoardSpec = {
  cols: number;
  rows: number;
};

export type LevelSpec = {
  board: BoardSpec;
  start: Position;
  exit: Position;
  door: Position;
  chips: Position[];
  floorKeys: ReadonlySet<string>;
  chipIndexByKey: ReadonlyMap<string, number>;
  solutionLength: number;
};

export type GameState = {
  tick: number;
  cooldownTicks: number;
  player: Position;
  successfulMoves: number;
  lastMove: Direction | null;
  collectedChipMask: number;
  doorOpened: boolean;
  won: boolean;
};

export type Point = {
  x: number;
  y: number;
};

type ObjectiveLayout = {
  chips: Position[];
  door: Position;
  exit: Position;
};

type TraversalState = {
  chipMask: number;
  doorOpened: boolean;
  position: Position;
};

type SolveState = {
  chipMask: number;
  doorOpened: boolean;
  position: Position;
  steps: number;
};

type PathParent = {
  direction: Direction | null;
  previousKey: string | null;
};

type GraphEdge = {
  direction: Direction;
  key: string;
};

type GraphNode = {
  edges: GraphEdge[];
  position: Position;
};

type MovementGraph = Map<string, GraphNode>;

type DistanceData = {
  distances: Map<string, number>;
  parents: Map<string, string | null>;
};

type DoorPlan = {
  distanceFromStart: Map<string, number>;
  door: Position;
  startSideKeys: Set<string>;
};

type GenerationBuild = {
  branchCount: number;
  chipZoneKeys: Set<string>;
  connectorCount: number;
  door: Position | null;
  exit: Position | null;
  floorKeys: Set<string>;
  roomCount: number;
  roomKeys: Set<string>;
};

const CHIP_COUNT = 5;
const LEVEL_ATTEMPTS = 420;
const TARGET_FLOOR_RATIO = 0.245;
const MIN_FLOOR_RATIO = 0.205;
const TRUNK_COUNT = 3;
const TRUNK_MIN_LENGTH = 12;
const TRUNK_MAX_LENGTH = 24;
const MIN_BRANCH_COUNT = 14;
const MIN_CONNECTOR_COUNT = 0;
const MIN_DEAD_END_COUNT = 12;
const MIN_JUNCTION_COUNT = 14;
const ROOM_TARGET_COUNT = 4;
const MIN_ROOM_NODE_COUNT = 18;

export const ALL_DIRECTIONS: Direction[] = ['N', 'W', 'S', 'E', 'NW', 'NE', 'SW', 'SE'];

export function createInitialState(level: LevelSpec): GameState {
  return {
    tick: 0,
    cooldownTicks: 0,
    player: level.start,
    successfulMoves: 0,
    lastMove: null,
    collectedChipMask: 0,
    doorOpened: false,
    won: false,
  };
}

export function generateLevel(board: BoardSpec): LevelSpec {
  const graph = buildMovementGraph(board);
  const start: SquarePosition = {
    kind: 'square',
    col: Math.floor(board.cols / 2),
    row: Math.floor(board.rows / 2),
  };
  const startKey = positionKey(start);
  const targetFloorCount = Math.max(CHIP_COUNT + 96, Math.floor(graph.size * TARGET_FLOOR_RATIO));
  const minimumFloorCount = Math.max(CHIP_COUNT + 72, Math.floor(graph.size * MIN_FLOOR_RATIO));

  for (let attempt = 0; attempt < LEVEL_ATTEMPTS; attempt += 1) {
    const build = buildInterestingMaze(graph, board, startKey, targetFloorCount);

    if (
      build.floorKeys.size < minimumFloorCount ||
      build.door === null ||
      build.exit === null ||
      build.chipZoneKeys.size < CHIP_COUNT + 12 ||
      !isInterestingGeneration(graph, build, startKey)
    ) {
      continue;
    }

    const distanceFromStart = getDistanceData(graph, build.chipZoneKeys, startKey).distances;
    const chipPool = getChipPool(
      graph,
      build.chipZoneKeys,
      startKey,
      positionKey(build.door),
      distanceFromStart,
    );
    const chips = pickSpreadPositions(
      graph,
      build.chipZoneKeys,
      chipPool,
      CHIP_COUNT,
      [start],
      positionKey(build.door),
      distanceFromStart,
    );

    if (!chips) {
      continue;
    }

    const chipIndexByKey = new Map<string, number>();

    chips.forEach((chip, index) => {
      chipIndexByKey.set(positionKey(chip), index);
    });

    const levelWithoutProof = {
      board,
      start,
      exit: build.exit,
      door: build.door,
      chips,
      floorKeys: build.floorKeys,
      chipIndexByKey,
    };
    const solutionLength = findSolutionLength(levelWithoutProof);

    if (solutionLength === null) {
      continue;
    }

    return {
      ...levelWithoutProof,
      solutionLength,
    };
  }

  throw new Error('Failed to generate a solvable graph maze.');
}

export function getSquares(board: BoardSpec): SquarePosition[] {
  const squares: SquarePosition[] = [];

  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      squares.push({ kind: 'square', col, row });
    }
  }

  return squares;
}

export function getDiamonds(board: BoardSpec): DiamondPosition[] {
  const diamonds: DiamondPosition[] = [];

  for (let row = 0; row <= board.rows; row += 1) {
    for (let col = 0; col <= board.cols; col += 1) {
      diamonds.push({ kind: 'diamond', col, row });
    }
  }

  return diamonds;
}

export function getLegalMoves(board: BoardSpec, position: Position): Direction[] {
  return ALL_DIRECTIONS.filter((direction) => getNextPosition(board, position, direction) !== null);
}

export function getWalkableMoves(
  level: LevelSpec,
  position: Position,
  collectedChipMask: number,
  doorOpened: boolean,
): Direction[] {
  return getLegalMoves(level.board, position).filter((direction) => {
    const nextPosition = getNextPosition(level.board, position, direction);

    return (
      nextPosition !== null &&
      canEnterPosition(level, nextPosition, collectedChipMask, doorOpened)
    );
  });
}

export function findPathToPosition(
  level: LevelSpec,
  state: Pick<GameState, 'collectedChipMask' | 'doorOpened' | 'player'>,
  target: Position,
): Direction[] | null {
  if (isSamePosition(state.player, target)) {
    return [];
  }

  if (!isFloor(level, target)) {
    return null;
  }

  const start: TraversalState = {
    chipMask: state.collectedChipMask,
    doorOpened: state.doorOpened,
    position: state.player,
  };
  const startKey = serializeSolveState(start.position, start.chipMask, start.doorOpened);
  const parents = new Map<string, PathParent>([
    [
      startKey,
      {
        direction: null,
        previousKey: null,
      },
    ],
  ]);
  const queue: TraversalState[] = [start];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentKey = serializeSolveState(
      current.position,
      current.chipMask,
      current.doorOpened,
    );

    for (const direction of getWalkableMoves(
      level,
      current.position,
      current.chipMask,
      current.doorOpened,
    )) {
      const nextPosition = getNextPosition(level.board, current.position, direction);

      if (!nextPosition) {
        continue;
      }

      const next = resolveTraversal(
        level,
        nextPosition,
        current.chipMask,
        current.doorOpened,
      );
      const nextKey = serializeSolveState(next.position, next.chipMask, next.doorOpened);

      if (parents.has(nextKey)) {
        continue;
      }

      parents.set(nextKey, {
        direction,
        previousKey: currentKey,
      });

      if (isSamePosition(next.position, target)) {
        return reconstructDirections(parents, nextKey);
      }

      queue.push(next);
    }
  }

  return null;
}

export function getNextPosition(
  board: BoardSpec,
  position: Position,
  direction: Direction,
): Position | null {
  if (position.kind === 'square') {
    switch (direction) {
      case 'N':
        return position.row > 0
          ? { kind: 'square', col: position.col, row: position.row - 1 }
          : null;
      case 'W':
        return position.col > 0
          ? { kind: 'square', col: position.col - 1, row: position.row }
          : null;
      case 'S':
        return position.row < board.rows - 1
          ? { kind: 'square', col: position.col, row: position.row + 1 }
          : null;
      case 'E':
        return position.col < board.cols - 1
          ? { kind: 'square', col: position.col + 1, row: position.row }
          : null;
      case 'NW':
        return { kind: 'diamond', col: position.col, row: position.row };
      case 'NE':
        return { kind: 'diamond', col: position.col + 1, row: position.row };
      case 'SW':
        return { kind: 'diamond', col: position.col, row: position.row + 1 };
      case 'SE':
        return { kind: 'diamond', col: position.col + 1, row: position.row + 1 };
    }
  }

  switch (direction) {
    case 'N':
    case 'W':
    case 'S':
    case 'E':
      return null;
    case 'NW':
      return position.col > 0 && position.row > 0
        ? { kind: 'square', col: position.col - 1, row: position.row - 1 }
        : null;
    case 'NE':
      return position.col < board.cols && position.row > 0
        ? { kind: 'square', col: position.col, row: position.row - 1 }
        : null;
    case 'SW':
      return position.col > 0 && position.row < board.rows
        ? { kind: 'square', col: position.col - 1, row: position.row }
        : null;
    case 'SE':
      return position.col < board.cols && position.row < board.rows
        ? { kind: 'square', col: position.col, row: position.row }
        : null;
  }
}

export function advanceGame(
  level: LevelSpec,
  state: GameState,
  direction: Direction | null,
): GameState {
  const tick = state.tick + 1;

  if (state.won) {
    return {
      ...state,
      tick,
    };
  }

  if (state.cooldownTicks > 0) {
    return {
      ...state,
      tick,
      cooldownTicks: state.cooldownTicks - 1,
    };
  }

  if (!direction) {
    return {
      ...state,
      tick,
    };
  }

  const nextPosition = getNextPosition(level.board, state.player, direction);

  if (
    !nextPosition ||
    !canEnterPosition(level, nextPosition, state.collectedChipMask, state.doorOpened)
  ) {
    return {
      ...state,
      tick,
    };
  }

  const nextTraversal = resolveTraversal(
    level,
    nextPosition,
    state.collectedChipMask,
    state.doorOpened,
  );

  return {
    ...state,
    tick,
    cooldownTicks: 1,
    player: nextTraversal.position,
    successfulMoves: state.successfulMoves + 1,
    lastMove: direction,
    collectedChipMask: nextTraversal.chipMask,
    doorOpened: nextTraversal.doorOpened,
    won: nextTraversal.doorOpened && isSamePosition(nextTraversal.position, level.exit),
  };
}

export function getAllChipsMask(level: LevelSpec): number {
  return (1 << level.chips.length) - 1;
}

export function getCollectedChipCount(level: LevelSpec, state: GameState): number {
  let count = 0;

  for (let index = 0; index < level.chips.length; index += 1) {
    if ((state.collectedChipMask & (1 << index)) !== 0) {
      count += 1;
    }
  }

  return count;
}

export function isFloor(level: LevelSpec, position: Position): boolean {
  return level.floorKeys.has(positionKey(position));
}

export function isChipCollected(state: GameState, chipIndex: number): boolean {
  return (state.collectedChipMask & (1 << chipIndex)) !== 0;
}

export function isSamePosition(left: Position, right: Position): boolean {
  return left.kind === right.kind && left.col === right.col && left.row === right.row;
}

export function getBoardSize(board: BoardSpec, spacing: number): Point {
  return {
    x: board.cols * spacing,
    y: board.rows * spacing,
  };
}

export function getPositionCenter(position: Position, spacing: number): Point {
  if (position.kind === 'square') {
    return {
      x: (position.col + 0.5) * spacing,
      y: (position.row + 0.5) * spacing,
    };
  }

  return {
    x: position.col * spacing,
    y: position.row * spacing,
  };
}

export function getPolygonPoints(
  position: Position,
  spacing: number,
  cornerCut: number,
): string {
  const center = getPositionCenter(position, spacing);

  if (position.kind === 'diamond') {
    return [
      `${center.x},${center.y - cornerCut}`,
      `${center.x + cornerCut},${center.y}`,
      `${center.x},${center.y + cornerCut}`,
      `${center.x - cornerCut},${center.y}`,
    ].join(' ');
  }

  const half = spacing / 2;

  return [
    `${center.x - half + cornerCut},${center.y - half}`,
    `${center.x + half - cornerCut},${center.y - half}`,
    `${center.x + half},${center.y - half + cornerCut}`,
    `${center.x + half},${center.y + half - cornerCut}`,
    `${center.x + half - cornerCut},${center.y + half}`,
    `${center.x - half + cornerCut},${center.y + half}`,
    `${center.x - half},${center.y + half - cornerCut}`,
    `${center.x - half},${center.y - half + cornerCut}`,
  ].join(' ');
}

export function positionKey(position: Position): string {
  return `${position.kind}:${position.col}:${position.row}`;
}

export function formatPosition(position: Position): string {
  if (position.kind === 'square') {
    return `Square ${position.col + 1}, ${position.row + 1}`;
  }

  return `Diamond ${position.col + 1}, ${position.row + 1}`;
}

function resolveTraversal(
  level: LevelSpec,
  position: Position,
  chipMask: number,
  doorOpened: boolean,
): TraversalState {
  let nextChipMask = chipMask;
  const chipIndex = level.chipIndexByKey.get(positionKey(position));

  if (chipIndex !== undefined) {
    nextChipMask |= 1 << chipIndex;
  }

  let nextDoorOpened = doorOpened;

  if (
    !nextDoorOpened &&
    nextChipMask === getAllChipsMask(level) &&
    isSamePosition(position, level.door)
  ) {
    nextDoorOpened = true;
  }

  return {
    chipMask: nextChipMask,
    doorOpened: nextDoorOpened,
    position,
  };
}

function canEnterPosition(
  level: LevelSpec,
  position: Position,
  collectedChipMask: number,
  doorOpened: boolean,
): boolean {
  if (!isFloor(level, position)) {
    return false;
  }

  if (!isSamePosition(position, level.door)) {
    return true;
  }

  return doorOpened || collectedChipMask === getAllChipsMask(level);
}

function buildMovementGraph(board: BoardSpec): MovementGraph {
  const graph: MovementGraph = new Map();
  const allPositions = getAllPositions(board);

  for (const position of allPositions) {
    graph.set(positionKey(position), {
      edges: [],
      position,
    });
  }

  for (const position of allPositions) {
    const key = positionKey(position);
    const node = graph.get(key);

    if (!node) {
      continue;
    }

    node.edges = getLegalMoves(board, position).flatMap((direction) => {
      const nextPosition = getNextPosition(board, position, direction);

      if (!nextPosition) {
        return [];
      }

      return [
        {
          direction,
          key: positionKey(nextPosition),
        },
      ];
    });
  }

  return graph;
}

function buildInterestingMaze(
  graph: MovementGraph,
  board: BoardSpec,
  startKey: string,
  targetFloorCount: number,
): GenerationBuild {
  const floorKeys = new Set<string>([startKey]);
  const roomKeys = new Set<string>();
  const trunkKeys = new Set<string>([startKey]);
  const trunkStarts = chooseInitialTrunkEdges(graph, floorKeys, startKey, TRUNK_COUNT);
  let branchCount = Math.max(0, trunkStarts.length - 1);
  let roomCount = 0;
  let branchAttempts = 0;

  for (const edge of trunkStarts) {
    if (floorKeys.has(edge.key)) {
      continue;
    }

    floorKeys.add(edge.key);
    trunkKeys.add(edge.key);

    const trunk = carvePath(
      graph,
      floorKeys,
      edge.key,
      randomBetween(TRUNK_MIN_LENGTH, TRUNK_MAX_LENGTH),
      'backbone',
    );

    trunk.forEach((key) => {
      trunkKeys.add(key);
    });

    const trunkTail = trunk[trunk.length - 1] ?? edge.key;

    if (Math.random() < 0.45) {
      const roomAnchorKey = chooseRoomAnchorKey(graph, floorKeys, trunkTail);

      if (roomAnchorKey) {
        const added = carveRoom(board, floorKeys, roomKeys, roomAnchorKey);

        if (added >= 6) {
          roomCount += 1;
        }
      }
    }
  }

  while (
    (
      floorKeys.size < Math.floor(targetFloorCount * 0.82) ||
      branchCount < MIN_BRANCH_COUNT ||
      roomCount < ROOM_TARGET_COUNT
    ) &&
    branchAttempts < 920
  ) {
    const anchorKey = chooseBranchAnchor(graph, floorKeys, trunkKeys);

    if (!anchorKey) {
      break;
    }

    const branch = carvePath(
      graph,
      floorKeys,
      anchorKey,
      randomBetween(4, 18),
      'branch',
    );

    if (branch.length >= 2) {
      branchCount += 1;

      const branchTail = branch[branch.length - 1] ?? anchorKey;

      if (Math.random() < 0.36) {
        const roomAnchorKey = chooseRoomAnchorKey(graph, floorKeys, branchTail);

        if (roomAnchorKey) {
          const added = carveRoom(board, floorKeys, roomKeys, roomAnchorKey);

          if (added >= 6) {
            roomCount += 1;
          }
        }
      }

      if (Math.random() < 0.22) {
        const spurAnchorKey = branch[Math.max(0, branch.length - randomBetween(1, Math.min(4, branch.length)))] ?? branchTail;
        const spur = carvePath(
          graph,
          floorKeys,
          spurAnchorKey,
          randomBetween(2, 8),
          'branch',
        );

        if (spur.length >= 2) {
          branchCount += 1;
        }
      }
    }

    branchAttempts += 1;
  }

  for (let roomAttempt = 0; roomAttempt < 56; roomAttempt += 1) {
    if (roomCount >= ROOM_TARGET_COUNT && roomKeys.size >= MIN_ROOM_NODE_COUNT) {
      break;
    }

    const roomAnchorKey = chooseRoomAnchorKey(graph, floorKeys);

    if (!roomAnchorKey) {
      break;
    }

    const added = carveRoom(board, floorKeys, roomKeys, roomAnchorKey);

    if (added >= 6) {
      roomCount += 1;
    }
  }

  const connectorCount = carveConnectors(
    graph,
    floorKeys,
    randomBetween(1, 3),
  );

  const explorationTarget = Math.max(
    Math.floor(targetFloorCount * 0.84),
    targetFloorCount - 28,
  );

  while (floorKeys.size < explorationTarget && branchAttempts < 1280) {
    const anchorKey = chooseBranchAnchor(graph, floorKeys, trunkKeys);

    if (!anchorKey) {
      break;
    }

    const branch = carvePath(
      graph,
      floorKeys,
      anchorKey,
      randomBetween(3, 14),
      'branch',
    );

    if (branch.length >= 2) {
      branchCount += 1;
    }

    if (Math.random() < 0.24) {
      const roomAnchorKey = chooseRoomAnchorKey(graph, floorKeys, branch[branch.length - 1] ?? anchorKey);

      if (roomAnchorKey) {
        const added = carveRoom(board, floorKeys, roomKeys, roomAnchorKey);

        if (added >= 6) {
          roomCount += 1;
        }
      }
    }

    branchAttempts += 1;
  }

  const chipZoneKeys = new Set<string>(floorKeys);
  const exitPlan = carveExitBranch(graph, floorKeys, startKey);

  return {
    branchCount,
    chipZoneKeys,
    connectorCount,
    door: exitPlan?.door ?? null,
    exit: exitPlan?.exit ?? null,
    floorKeys,
    roomCount,
    roomKeys,
  };
}

function carveExitBranch(
  graph: MovementGraph,
  floorKeys: Set<string>,
  startKey: string,
): { door: Position; exit: Position } | null {
  const distancesFromStart = getDistanceData(graph, floorKeys, startKey).distances;
  const anchors = [...floorKeys]
    .filter((key) => {
      return (
        (distancesFromStart.get(key) ?? 0) > 11 &&
        countFutureExpansionOptions(graph, key, floorKeys) >= 1 &&
        countNeighborsInSet(graph, key, floorKeys) <= 2
      );
    })
    .sort(
      (left, right) =>
        (distancesFromStart.get(right) ?? 0) -
        (distancesFromStart.get(left) ?? 0),
    );

  for (const anchorKey of anchors) {
    const branch = carvePath(
      graph,
      floorKeys,
      anchorKey,
      randomBetween(7, 15),
      'backbone',
    );

    if (branch.length < 5) {
      branch.forEach((key) => {
        floorKeys.delete(key);
      });
      continue;
    }

    const doorKey = branch[0];
    const exitKey = branch[branch.length - 1];

    const door = graph.get(doorKey)?.position;
    const exit = graph.get(exitKey)?.position;

    if (door && exit) {
      return {
        door,
        exit,
      };
    }

    branch.forEach((key) => {
      floorKeys.delete(key);
    });
  }

  return null;
}

function chooseInitialTrunkEdges(
  graph: MovementGraph,
  floorKeys: ReadonlySet<string>,
  startKey: string,
  count: number,
): GraphEdge[] {
  const node = graph.get(startKey);

  if (!node) {
    return [];
  }

  return [...node.edges]
    .map((edge) => {
      return {
        edge,
        score:
          countFutureExpansionOptions(graph, edge.key, floorKeys) +
          (isDiagonal(edge.direction) ? 0.28 : 0) +
          Math.random(),
      };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ edge }) => edge)
    .slice(0, Math.min(count, node.edges.length));
}

function carvePath(
  graph: MovementGraph,
  floorKeys: Set<string>,
  startKey: string,
  maxLength: number,
  mode: 'backbone' | 'branch',
): string[] {
  const added: string[] = [];
  let currentKey = startKey;
  let previousDirection: Direction | null = null;

  for (let step = 0; step < maxLength; step += 1) {
    const node = graph.get(currentKey);

    if (!node) {
      break;
    }

    const candidates = node.edges.filter((edge) => {
      const existingNeighbors = countNeighborsInSet(graph, edge.key, floorKeys);

      return (
        !floorKeys.has(edge.key) &&
        existingNeighbors >= 1 &&
        existingNeighbors <= (mode === 'branch' ? 2 : 1)
      );
    });

    if (candidates.length === 0) {
      break;
    }

    const nextEdge = choosePathEdge(graph, floorKeys, candidates, mode, previousDirection, step, maxLength);

    floorKeys.add(nextEdge.key);
    added.push(nextEdge.key);
    currentKey = nextEdge.key;
    previousDirection = nextEdge.direction;
  }

  return added;
}

function choosePathEdge(
  graph: MovementGraph,
  floorKeys: ReadonlySet<string>,
  candidates: GraphEdge[],
  mode: 'backbone' | 'branch',
  previousDirection: Direction | null,
  step: number,
  maxLength: number,
): GraphEdge {
  let bestEdge = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const futureOptions = countFutureExpansionOptions(graph, candidate.key, floorKeys);
    let score = Math.random();

    if (previousDirection) {
      score += candidate.direction === previousDirection ? 0.12 : 1.18;

      if (isDiagonal(candidate.direction) !== isDiagonal(previousDirection)) {
        score += 0.26;
      }
    } else {
      score += Math.random();
    }

    score += futureOptions * (mode === 'backbone' ? 0.54 : 0.2);

    if (futureOptions === 0) {
      score -= mode === 'backbone' && step < Math.floor(maxLength * 0.6) ? 1.5 : 0.24;
      score += mode === 'branch' ? 0.28 : 0;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEdge = candidate;
    }
  }

  return bestEdge;
}

function chooseBranchAnchor(
  graph: MovementGraph,
  floorKeys: Set<string>,
  backboneKeys: ReadonlySet<string>,
): string | null {
  let bestKey: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const key of floorKeys) {
    const degree = countNeighborsInSet(graph, key, floorKeys);
    const futureOptions = countFutureExpansionOptions(graph, key, floorKeys);

    if (futureOptions === 0) {
      continue;
    }

    let score = Math.random();

    score +=
      degree === 1
        ? 1.3
        : degree === 2
          ? 1.08
          : degree === 3
            ? 0.68
            : degree === 4
              ? 0.18
              : -0.18;
    score += futureOptions * 1.08;
    score += backboneKeys.has(key) ? 0.54 : 0.18;

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

function chooseRoomAnchorKey(
  graph: MovementGraph,
  floorKeys: Set<string>,
  preferredKey?: string,
): string | null {
  if (preferredKey) {
    const preferredNode = graph.get(preferredKey);

    if (preferredNode?.position.kind === 'square') {
      return preferredKey;
    }
  }

  let bestKey: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const key of floorKeys) {
    const node = graph.get(key);

    if (node?.position.kind !== 'square') {
      continue;
    }

    const degree = countNeighborsInSet(graph, key, floorKeys);
    let score = Math.random();

    score += degree === 1 ? 1.15 : degree === 2 ? 0.9 : degree === 3 ? 0.32 : -0.18;
    score += key === preferredKey ? 2.4 : 0;

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

function carveRoom(
  board: BoardSpec,
  floorKeys: Set<string>,
  roomKeys: Set<string>,
  anchorKey: string,
): number {
  const [kind, colText, rowText] = anchorKey.split(':');

  if (kind !== 'square') {
    return 0;
  }

  const anchorCol = Number(colText);
  const anchorRow = Number(rowText);
  const width = randomBetween(2, 4);
  const height = randomBetween(2, 3);
  const originCol = Math.max(0, Math.min(anchorCol - randomBetween(0, width - 1), board.cols - width));
  const originRow = Math.max(0, Math.min(anchorRow - randomBetween(0, height - 1), board.rows - height));
  const candidateKeys = new Set<string>();

  for (let row = originRow; row < originRow + height; row += 1) {
    for (let col = originCol; col < originCol + width; col += 1) {
      candidateKeys.add(getSquareKey(col, row));
    }
  }

  for (let row = originRow; row <= originRow + height; row += 1) {
    for (let col = originCol; col <= originCol + width; col += 1) {
      candidateKeys.add(getDiamondKey(col, row));
    }
  }

  let added = 0;

  for (const key of candidateKeys) {
    if (!floorKeys.has(key)) {
      floorKeys.add(key);
      roomKeys.add(key);
      added += 1;
    }
  }

  return added;
}

function countFutureExpansionOptions(
  graph: MovementGraph,
  key: string,
  floorKeys: ReadonlySet<string>,
): number {
  const node = graph.get(key);

  if (!node) {
    return 0;
  }

  return node.edges.filter((edge) => {
    const existingNeighbors = countNeighborsInSet(graph, edge.key, floorKeys);

    return (
      !floorKeys.has(edge.key) &&
      existingNeighbors <= 1
    );
  }).length;
}

function carveConnectors(
  graph: MovementGraph,
  floorKeys: Set<string>,
  targetCount: number,
): number {
  let connectorCount = 0;

  for (let attempt = 0; attempt < targetCount * 16 && connectorCount < targetCount; attempt += 1) {
    const connectorKey = chooseConnectorKey(graph, floorKeys);

    if (!connectorKey) {
      break;
    }

    floorKeys.add(connectorKey);
    connectorCount += 1;
  }

  return connectorCount;
}

function chooseConnectorKey(
  graph: MovementGraph,
  floorKeys: ReadonlySet<string>,
): string | null {
  let bestKey: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [key, node] of graph) {
    if (floorKeys.has(key)) {
      continue;
    }

    const neighborCount = countNeighborsInSet(graph, key, floorKeys);

    if (neighborCount < 2 || neighborCount > 4) {
      continue;
    }

    let score = Math.random();

    score += neighborCount * 1.45;
    score += node.position.kind === 'diamond' ? 0.42 : 0.14;
    score += countFutureExpansionOptions(graph, key, floorKeys) * 0.16;

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

function isInterestingGeneration(
  graph: MovementGraph,
  build: GenerationBuild,
  startKey: string,
): boolean {
  let deadEnds = 0;
  let junctions = 0;
  const startDegree = countNeighborsInSet(graph, startKey, build.floorKeys);

  for (const key of build.floorKeys) {
    if (key === startKey) {
      continue;
    }

    const degree = countNeighborsInSet(graph, key, build.floorKeys);

    if (degree === 1) {
      deadEnds += 1;
    } else if (degree >= 3) {
      junctions += 1;
    }
  }

  return (
    build.branchCount >= MIN_BRANCH_COUNT &&
    build.connectorCount >= MIN_CONNECTOR_COUNT &&
    deadEnds >= MIN_DEAD_END_COUNT &&
    junctions >= MIN_JUNCTION_COUNT &&
    build.roomCount >= ROOM_TARGET_COUNT &&
    startDegree >= 3 &&
    build.roomKeys.size >= MIN_ROOM_NODE_COUNT
  );
}

function chooseObjectives(
  graph: MovementGraph,
  floorKeys: Set<string>,
  start: Position,
): ObjectiveLayout | null {
  const startKey = positionKey(start);
  const distanceData = getDistanceData(graph, floorKeys, startKey);
  const leaves = [...floorKeys]
    .filter((key) => key !== startKey && countNeighborsInSet(graph, key, floorKeys) === 1)
    .sort(
      (left, right) =>
        (distanceData.distances.get(right) ?? -1) -
        (distanceData.distances.get(left) ?? -1),
    );

  if (leaves.length < CHIP_COUNT + 1) {
    return null;
  }

  const exitKey = leaves[0];
  const pathToExit = buildPath(graph, distanceData.parents, exitKey);

  if (pathToExit.length < 16) {
    return null;
  }

  const doorPlan = chooseDoorPlan(graph, floorKeys, startKey, exitKey, pathToExit);

  if (!doorPlan) {
    return null;
  }

  const chipPool = getChipPool(
    graph,
    doorPlan.startSideKeys,
    startKey,
    positionKey(doorPlan.door),
    doorPlan.distanceFromStart,
  );
  const chips = pickSpreadPositions(
    graph,
    floorKeys,
    chipPool,
    CHIP_COUNT,
    [start, doorPlan.door],
    positionKey(doorPlan.door),
    doorPlan.distanceFromStart,
  );

  if (!chips) {
    return null;
  }

  return {
    chips,
    door: doorPlan.door,
    exit: graph.get(exitKey)?.position ?? pathToExit[pathToExit.length - 1],
  };
}

function chooseDoorPlan(
  graph: MovementGraph,
  floorKeys: Set<string>,
  startKey: string,
  exitKey: string,
  pathToExit: Position[],
): DoorPlan | null {
  const minimumDoorIndex = Math.max(5, Math.floor(pathToExit.length * 0.55));
  const maximumDoorIndex = pathToExit.length - 3;

  for (let index = maximumDoorIndex; index >= minimumDoorIndex; index -= 1) {
    const door = pathToExit[index];
    const doorKey = positionKey(door);
    const startSideKeys = getComponentKeys(graph, floorKeys, startKey, doorKey);

    if (startSideKeys.has(exitKey)) {
      continue;
    }

    const exitSideKeys = getComponentKeys(graph, floorKeys, exitKey, doorKey);

    if (exitSideKeys.size < 2) {
      continue;
    }

    const distanceFromStart = getDistanceData(graph, floorKeys, startKey, doorKey).distances;
    const chipPool = getChipPool(graph, startSideKeys, startKey, doorKey, distanceFromStart);

    if (chipPool.length < CHIP_COUNT) {
      continue;
    }

    return {
      distanceFromStart,
      door,
      startSideKeys,
    };
  }

  return null;
}

function getChipPool(
  graph: MovementGraph,
  accessibleKeys: Set<string>,
  startKey: string,
  doorKey: string,
  distanceFromStart: Map<string, number>,
): Position[] {
  const positions = [...accessibleKeys]
    .filter((key) => key !== startKey && key !== doorKey)
    .map((key) => graph.get(key)?.position)
    .filter((position): position is Position => position !== undefined);
  const leaves = positions.filter((position) => {
    return countNeighborsInSet(graph, positionKey(position), accessibleKeys) === 1;
  });
  const primary = leaves
    .filter((position) => (distanceFromStart.get(positionKey(position)) ?? 0) > 8)
    .sort(
      (left, right) =>
        (distanceFromStart.get(positionKey(right)) ?? 0) -
        (distanceFromStart.get(positionKey(left)) ?? 0),
    );

  if (primary.length >= CHIP_COUNT) {
    return primary;
  }

  return positions
    .filter((position) => (distanceFromStart.get(positionKey(position)) ?? 0) > 5)
    .sort(
      (left, right) =>
        (distanceFromStart.get(positionKey(right)) ?? 0) -
        (distanceFromStart.get(positionKey(left)) ?? 0),
    );
}

function pickSpreadPositions(
  graph: MovementGraph,
  floorKeys: Set<string>,
  pool: Position[],
  count: number,
  anchors: Position[],
  blockedKey: string,
  distanceFromStart: Map<string, number>,
): Position[] | null {
  const chosen: Position[] = [];
  const reserved = new Set<string>(anchors.map(positionKey));
  const distanceCache = new Map<string, Map<string, number>>();

  const getDistancesFrom = (key: string) => {
    const cached = distanceCache.get(key);

    if (cached) {
      return cached;
    }

    const distances = getDistanceData(graph, floorKeys, key, blockedKey).distances;

    distanceCache.set(key, distances);
    return distances;
  };

  while (chosen.length < count) {
    let bestCandidate: Position | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of pool) {
      const candidateKey = positionKey(candidate);

      if (reserved.has(candidateKey)) {
        continue;
      }

      const distances = getDistancesFrom(candidateKey);
      let minimumSpacing = Number.POSITIVE_INFINITY;

      for (const anchor of [...anchors, ...chosen]) {
        minimumSpacing = Math.min(
          minimumSpacing,
          distances.get(positionKey(anchor)) ?? Number.POSITIVE_INFINITY,
        );
      }

      if (!Number.isFinite(minimumSpacing)) {
        continue;
      }

      const score =
        minimumSpacing * 1.3 +
        (distanceFromStart.get(candidateKey) ?? 0) * 0.32 +
        Math.random();

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      return null;
    }

    chosen.push(bestCandidate);
    reserved.add(positionKey(bestCandidate));
  }

  return chosen;
}

function getDistanceData(
  graph: MovementGraph,
  floorKeys: ReadonlySet<string>,
  startKey: string,
  blockedKey?: string,
): DistanceData {
  if (startKey === blockedKey) {
    return {
      distances: new Map(),
      parents: new Map(),
    };
  }

  const distances = new Map<string, number>([[startKey, 0]]);
  const parents = new Map<string, string | null>([[startKey, null]]);
  const queue: string[] = [startKey];

  for (let index = 0; index < queue.length; index += 1) {
    const key = queue[index];
    const node = graph.get(key);
    const currentDistance = distances.get(key) ?? 0;

    if (!node) {
      continue;
    }

    for (const edge of node.edges) {
      if (
        edge.key === blockedKey ||
        !floorKeys.has(edge.key) ||
        distances.has(edge.key)
      ) {
        continue;
      }

      distances.set(edge.key, currentDistance + 1);
      parents.set(edge.key, key);
      queue.push(edge.key);
    }
  }

  return {
    distances,
    parents,
  };
}

function getComponentKeys(
  graph: MovementGraph,
  floorKeys: ReadonlySet<string>,
  startKey: string,
  blockedKey?: string,
): Set<string> {
  const distances = getDistanceData(graph, floorKeys, startKey, blockedKey).distances;

  return new Set(distances.keys());
}

function buildPath(
  graph: MovementGraph,
  parents: Map<string, string | null>,
  endKey: string,
): Position[] {
  const path: Position[] = [];
  let currentKey: string | null = endKey;

  while (currentKey !== null) {
    const node = graph.get(currentKey);

    if (!node) {
      break;
    }

    path.push(node.position);
    currentKey = parents.get(currentKey) ?? null;
  }

  path.reverse();
  return path;
}

function countNeighborsInSet(
  graph: MovementGraph,
  key: string,
  allowedKeys: ReadonlySet<string>,
): number {
  const node = graph.get(key);

  if (!node) {
    return 0;
  }

  return node.edges.filter((edge) => allowedKeys.has(edge.key)).length;
}

function findSolutionLength(level: Omit<LevelSpec, 'solutionLength'>): number | null {
  const solverLevel: LevelSpec = {
    ...level,
    solutionLength: 0,
  };
  const queue: SolveState[] = [
    {
      chipMask: 0,
      doorOpened: false,
      position: level.start,
      steps: 0,
    },
  ];
  const visited = new Set<string>([
    serializeSolveState(level.start, 0, false),
  ]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    if (current.doorOpened && isSamePosition(current.position, level.exit)) {
      return current.steps;
    }

    for (const direction of getWalkableMoves(
      solverLevel,
      current.position,
      current.chipMask,
      current.doorOpened,
    )) {
      const nextPosition = getNextPosition(level.board, current.position, direction);

      if (!nextPosition) {
        continue;
      }

      const next = resolveTraversal(
        solverLevel,
        nextPosition,
        current.chipMask,
        current.doorOpened,
      );

      const solveStateKey = serializeSolveState(
        next.position,
        next.chipMask,
        next.doorOpened,
      );

      if (visited.has(solveStateKey)) {
        continue;
      }

      visited.add(solveStateKey);
      queue.push({
        chipMask: next.chipMask,
        doorOpened: next.doorOpened,
        position: next.position,
        steps: current.steps + 1,
      });
    }
  }

  return null;
}

function serializeSolveState(
  position: Position,
  chipMask: number,
  doorOpened: boolean,
): string {
  return `${positionKey(position)}|${chipMask}|${doorOpened ? 1 : 0}`;
}

function reconstructDirections(
  parents: ReadonlyMap<string, PathParent>,
  endKey: string,
): Direction[] {
  const directions: Direction[] = [];
  let currentKey: string | null = endKey;

  while (currentKey !== null) {
    const parent = parents.get(currentKey);

    if (!parent?.previousKey || !parent.direction) {
      break;
    }

    directions.push(parent.direction);
    currentKey = parent.previousKey;
  }

  directions.reverse();
  return directions;
}

function getAllPositions(board: BoardSpec): Position[] {
  return [...getSquares(board), ...getDiamonds(board)];
}

function getSquareKey(col: number, row: number): string {
  return `square:${col}:${row}`;
}

function getDiamondKey(col: number, row: number): string {
  return `diamond:${col}:${row}`;
}

function isDiagonal(direction: Direction): direction is DiagonalDirection {
  return direction.length === 2;
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
