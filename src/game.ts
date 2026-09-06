export type Action = "C" | "D";
export type StrategyId =
  "cooperate" | "defect" | "tft" | "generous" | "grim" | "wsls";
export type Config = { rounds: number; noise: number; seed: number };
export type Settings = Config & { left: StrategyId; right: StrategyId };
export const STRATEGIES: {
  id: StrategyId;
  name: string;
  short: string;
  description: string;
}[] = [
  {
    id: "cooperate",
    name: "始终合作",
    short: "ALL C",
    description: "每轮都打算合作，不回应对方历史。执行噪声仍可能把动作翻转。",
  },
  {
    id: "defect",
    name: "始终不合作",
    short: "ALL D",
    description: "每轮都打算不合作，不回应对方历史。",
  },
  {
    id: "tft",
    name: "以牙还牙",
    short: "TFT",
    description: "首轮合作；随后模仿对方上一轮的实际动作。",
  },
  {
    id: "generous",
    name: "宽容以牙还牙",
    short: "GTFT",
    description:
      "首轮合作；对方上一轮合作就合作，若不合作则有 10% 概率宽恕并合作。",
  },
  {
    id: "grim",
    name: "冷酷触发",
    short: "GRIM",
    description:
      "先合作；一旦观察到对方任何一次实际不合作，此后永远打算不合作。",
  },
  {
    id: "wsls",
    name: "赢留输换",
    short: "WSLS",
    description:
      "首轮合作；上一轮得到 3 或 5 分就重复自己实际执行的动作，得到 0 或 1 分就切换。",
  },
];
export type Round = {
  number: number;
  intendedA: Action;
  intendedB: Action;
  actionA: Action;
  actionB: Action;
  noiseA: boolean;
  noiseB: boolean;
  scoreA: number;
  scoreB: number;
  totalA: number;
  totalB: number;
};
export type Duel = {
  left: StrategyId;
  right: StrategyId;
  rounds: Round[];
  totalA: number;
  totalB: number;
  cooperationA: number;
  cooperationB: number;
};
export type Standing = { id: StrategyId; average: number; cooperation: number };
export type Tournament = {
  matrix: number[][];
  cooperation: number[][];
  ranking: Standing[];
  duels: Duel[];
};
export const DEFAULT_SETTINGS: Settings = {
  rounds: 120,
  noise: 0.05,
  seed: 42,
  left: "tft",
  right: "generous",
};

function isStrategy(value: unknown): value is StrategyId {
  return STRATEGIES.some(({ id }) => id === value);
}
function validateConfig(config: Config) {
  if (
    !config ||
    !Number.isInteger(config.rounds) ||
    config.rounds < 20 ||
    config.rounds > 300 ||
    !Number.isFinite(config.noise) ||
    config.noise < 0 ||
    config.noise > 0.2 ||
    !Number.isInteger(config.seed) ||
    config.seed < 0 ||
    config.seed > 0xffffffff
  )
    throw new TypeError("Invalid experiment settings.");
}

/** Mulberry32, local streams only: no Math.random and no external mutable state. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function payoff(a: Action, b: Action): [number, number] {
  if ((a !== "C" && a !== "D") || (b !== "C" && b !== "D"))
    throw new TypeError("Unknown action.");
  if (a === "C" && b === "C") return [3, 3];
  if (a === "D" && b === "D") return [1, 1];
  return a === "D" ? [5, 0] : [0, 5];
}

/** Histories contain observed, executed actions, never the hidden intention. */
export function decide(
  strategy: StrategyId,
  own: Action[],
  opponent: Action[],
  random: () => number,
): Action {
  if (!isStrategy(strategy)) throw new TypeError("Unknown strategy.");
  if (strategy === "cooperate") return "C";
  if (strategy === "defect") return "D";
  if (own.length === 0) return "C";
  const theirs = opponent[opponent.length - 1],
    mine = own[own.length - 1];
  if (strategy === "tft") return theirs;
  if (strategy === "generous")
    return theirs === "C" || random() < 0.1 ? "C" : "D";
  if (strategy === "grim") return opponent.includes("D") ? "D" : "C";
  const [score] = payoff(mine, theirs);
  return score >= 3 ? mine : mine === "C" ? "D" : "C";
}

export function runDuel(
  left: StrategyId,
  right: StrategyId,
  config: Config,
): Duel {
  validateConfig(config);
  if (!isStrategy(left) || !isStrategy(right))
    throw new TypeError("Unknown strategy.");
  // Execution-noise streams are independent of whether a policy needs a random draw.
  const policyA = seeded(config.seed ^ 0x243f6a88),
    policyB = seeded(config.seed ^ 0x85a308d3);
  const executionA = seeded(config.seed ^ 0x13198a2e),
    executionB = seeded(config.seed ^ 0x03707344);
  const historyA: Action[] = [],
    historyB: Action[] = [];
  const rounds: Round[] = [];
  let totalA = 0,
    totalB = 0,
    cooperationA = 0,
    cooperationB = 0;
  for (let number = 1; number <= config.rounds; number++) {
    const intendedA = decide(left, historyA, historyB, policyA),
      intendedB = decide(right, historyB, historyA, policyB);
    const noiseA = executionA() < config.noise,
      noiseB = executionB() < config.noise;
    const actionA = noiseA ? (intendedA === "C" ? "D" : "C") : intendedA;
    const actionB = noiseB ? (intendedB === "C" ? "D" : "C") : intendedB;
    const [scoreA, scoreB] = payoff(actionA, actionB);
    totalA += scoreA;
    totalB += scoreB;
    if (actionA === "C") cooperationA++;
    if (actionB === "C") cooperationB++;
    rounds.push({
      number,
      intendedA,
      intendedB,
      actionA,
      actionB,
      noiseA,
      noiseB,
      scoreA,
      scoreB,
      totalA,
      totalB,
    });
    historyA.push(actionA);
    historyB.push(actionB);
  }
  return {
    left,
    right,
    rounds,
    totalA,
    totalB,
    cooperationA: cooperationA / config.rounds,
    cooperationB: cooperationB / config.rounds,
  };
}

export function runTournament(config: Config): Tournament {
  validateConfig(config);
  const matrix = STRATEGIES.map(() => Array<number>(STRATEGIES.length).fill(0));
  const cooperation = STRATEGIES.map(() =>
    Array<number>(STRATEGIES.length).fill(0),
  );
  const duels: Duel[] = [];
  for (let i = 0; i < STRATEGIES.length; i++) {
    for (let j = i; j < STRATEGIES.length; j++) {
      const seed =
        (config.seed ^ Math.imul(i * STRATEGIES.length + j + 1, 0x9e3779b1)) >>>
        0;
      const duel = runDuel(STRATEGIES[i].id, STRATEGIES[j].id, {
        ...config,
        seed,
      });
      duels.push(duel);
      if (i === j) {
        matrix[i][i] = (duel.totalA + duel.totalB) / (2 * config.rounds);
        cooperation[i][i] = (duel.cooperationA + duel.cooperationB) / 2;
      } else {
        matrix[i][j] = duel.totalA / config.rounds;
        matrix[j][i] = duel.totalB / config.rounds;
        cooperation[i][j] = duel.cooperationA;
        cooperation[j][i] = duel.cooperationB;
      }
    }
  }
  const ranking = STRATEGIES.map(({ id }, index) => ({
    id,
    average:
      matrix[index].reduce((sum, score) => sum + score, 0) / STRATEGIES.length,
    cooperation:
      cooperation[index].reduce((sum, rate) => sum + rate, 0) /
      STRATEGIES.length,
  })).sort((a, b) => b.average - a.average);
  return { matrix, cooperation, ranking, duels };
}

export function getDuel(
  tournament: Tournament,
  left: StrategyId,
  right: StrategyId,
): Duel {
  const direct = tournament.duels.find(
    (duel) => duel.left === left && duel.right === right,
  );
  if (direct) return direct;
  const reverse = tournament.duels.find(
    (duel) => duel.left === right && duel.right === left,
  );
  if (!reverse) throw new TypeError("Duel is not in this tournament.");
  return {
    left,
    right,
    totalA: reverse.totalB,
    totalB: reverse.totalA,
    cooperationA: reverse.cooperationB,
    cooperationB: reverse.cooperationA,
    rounds: reverse.rounds.map((round) => ({
      number: round.number,
      intendedA: round.intendedB,
      intendedB: round.intendedA,
      actionA: round.actionB,
      actionB: round.actionA,
      noiseA: round.noiseB,
      noiseB: round.noiseA,
      scoreA: round.scoreB,
      scoreB: round.scoreA,
      totalA: round.totalB,
      totalB: round.totalA,
    })),
  };
}

export function encodeSettings(settings: Settings): string {
  validateConfig(settings);
  if (!isStrategy(settings.left) || !isStrategy(settings.right))
    throw new TypeError("Unknown strategy.");
  const json = JSON.stringify({
    v: 1,
    rounds: settings.rounds,
    noise: settings.noise,
    seed: settings.seed,
    left: settings.left,
    right: settings.right,
  });
  return (
    "#v1." +
    btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  );
}

export function decodeSettings(hash: string): Settings | null {
  if (
    typeof hash !== "string" ||
    hash.length > 1000 ||
    !/^#v1\.[A-Za-z0-9_-]+$/.test(hash)
  )
    return null;
  try {
    const base64 = hash.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    const value = JSON.parse(
      atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    );
    if (!value || value.v !== 1) return null;
    const settings: Settings = {
      rounds: value.rounds,
      noise: value.noise,
      seed: value.seed,
      left: value.left,
      right: value.right,
    };
    return encodeSettings(settings) === hash ? settings : null;
  } catch {
    return null;
  }
}

export function duelCSV(duel: Duel): string {
  const header =
    "round,left_strategy,right_strategy,intended_left,actual_left,noise_left,score_left,total_left,intended_right,actual_right,noise_right,score_right,total_right";
  return (
    "\ufeff" +
    [
      header,
      ...duel.rounds.map((r) =>
        [
          r.number,
          duel.left,
          duel.right,
          r.intendedA,
          r.actionA,
          Number(r.noiseA),
          r.scoreA,
          r.totalA,
          r.intendedB,
          r.actionB,
          Number(r.noiseB),
          r.scoreB,
          r.totalB,
        ].join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
