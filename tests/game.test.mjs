import test from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGIES,
  payoff,
  decide,
  seeded,
  runDuel,
  runTournament,
  getDuel,
  encodeSettings,
  decodeSettings,
  duelCSV,
  runSingleMistake,
} from "../.test-build/game.js";

const ids = ["cooperate", "defect", "tft", "generous", "grim", "wsls"];
const config = { rounds: 40, noise: 0, seed: 12345 };

function closeTo(actual, expected, message) {
  assert.ok(Number.isFinite(actual), `${message}: expected a finite number`);
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("all six strategies expose nonempty presentation metadata", () => {
  assert.deepEqual(STRATEGIES.map(({ id }) => id).sort(), [...ids].sort());
  for (const strategy of STRATEGIES) {
    for (const field of ["name", "short", "description"]) {
      assert.equal(typeof strategy[field], "string");
      assert.ok(strategy[field].trim().length > 0);
    }
  }
});

test("payoffs implement all four prisoner dilemma outcomes", () => {
  assert.deepEqual(payoff("C", "C"), [3, 3]);
  assert.deepEqual(payoff("C", "D"), [0, 5]);
  assert.deepEqual(payoff("D", "C"), [5, 0]);
  assert.deepEqual(payoff("D", "D"), [1, 1]);
});

test("unconditional strategies ignore history", () => {
  for (const history of [[], ["C"], ["D", "C", "D"]]) {
    assert.equal(
      decide("cooperate", history, history, () => 0.5),
      "C",
    );
    assert.equal(
      decide("defect", history, history, () => 0.5),
      "D",
    );
  }
});

test("tit for tat starts cooperatively and copies the last actual opponent move", () => {
  assert.equal(
    decide("tft", [], [], () => 0.5),
    "C",
  );
  assert.equal(
    decide("tft", ["C", "D"], ["D", "C"], () => 0.5),
    "C",
  );
  assert.equal(
    decide("tft", ["D", "C"], ["C", "D"], () => 0.5),
    "D",
  );
});

test("grim permanently defects after any actual opponent defection", () => {
  assert.equal(
    decide("grim", [], [], () => 0.5),
    "C",
  );
  assert.equal(
    decide("grim", ["C", "C"], ["C", "C"], () => 0.5),
    "C",
  );
  assert.equal(
    decide("grim", ["C", "D", "D"], ["D", "C", "C"], () => 0),
    "D",
  );
});

test("generous tit for tat forgives defection with probability exactly 0.1", () => {
  assert.equal(
    decide("generous", [], [], () => 0.99),
    "C",
  );
  assert.equal(
    decide("generous", ["D"], ["C"], () => 0.99),
    "C",
  );
  assert.equal(
    decide("generous", ["C"], ["D"], () => 0),
    "C",
  );
  assert.equal(
    decide("generous", ["C"], ["D"], () => 0.099999),
    "C",
  );
  assert.equal(
    decide("generous", ["C"], ["D"], () => 0.1),
    "D",
  );
  assert.equal(
    decide("generous", ["C"], ["D"], () => 0.999999),
    "D",
  );
});

test("win-stay lose-shift applies the previous actual payoff in all four cases", () => {
  assert.equal(
    decide("wsls", [], [], () => 0.5),
    "C",
  );
  for (const [own, opponent, next] of [
    ["C", "C", "C"], // Reward 3: stay cooperative.
    ["D", "C", "D"], // Temptation 5: stay defecting.
    ["C", "D", "D"], // Sucker 0: switch to defection.
    ["D", "D", "C"], // Punishment 1: switch to cooperation.
  ]) {
    assert.equal(
      decide("wsls", [own], [opponent], () => 0.5),
      next,
      `previous actual actions ${own}/${opponent}`,
    );
  }
});

test("mutual cooperation earns three per round and full cooperation", () => {
  const duel = runDuel("cooperate", "cooperate", config);
  assert.equal(duel.left, "cooperate");
  assert.equal(duel.right, "cooperate");
  assert.equal(duel.rounds.length, config.rounds);
  assert.equal(duel.totalA, 3 * config.rounds);
  assert.equal(duel.totalB, 3 * config.rounds);
  assert.equal(duel.cooperationA, 1);
  assert.equal(duel.cooperationB, 1);
  for (const round of duel.rounds) {
    assert.equal(round.actionA, "C");
    assert.equal(round.actionB, "C");
    assert.equal(round.noiseA, false);
    assert.equal(round.noiseB, false);
  }
});

test("mutual defection earns one per round and zero cooperation", () => {
  const duel = runDuel("defect", "defect", config);
  assert.equal(duel.totalA, config.rounds);
  assert.equal(duel.totalB, config.rounds);
  assert.equal(duel.cooperationA, 0);
  assert.equal(duel.cooperationB, 0);
  assert.ok(
    duel.rounds.every(
      (round) => round.actionA === "D" && round.actionB === "D",
    ),
  );
});

test("tit for tat against defection loses the first round then retaliates", () => {
  const duel = runDuel("tft", "defect", config);
  assert.equal(duel.rounds[0].scoreA, 0);
  assert.equal(duel.rounds[0].scoreB, 5);
  assert.ok(
    duel.rounds
      .slice(1)
      .every((round) => round.scoreA === 1 && round.scoreB === 1),
  );
  assert.equal(duel.totalA, config.rounds - 1);
  assert.equal(duel.totalB, config.rounds + 4);
  assert.equal(duel.cooperationA, 1 / config.rounds);
  assert.equal(duel.cooperationB, 0);
});

test("seeded random streams repeat, distinguish seeds, and remain in [0, 1)", () => {
  const streams = [];
  for (const seed of [0, 1, 2, 0xffffffff]) {
    const first = seeded(seed);
    const second = seeded(seed);
    const samples = Array.from({ length: 1000 }, () => first());
    assert.deepEqual(
      samples,
      Array.from({ length: 1000 }, () => second()),
    );
    assert.ok(
      samples.every(
        (value) => Number.isFinite(value) && value >= 0 && value < 1,
      ),
    );
    assert.ok(new Set(samples).size > 1, "random stream must not be constant");
    streams.push(samples);
  }
  assert.notDeepEqual(streams[1], streams[2]);
});

test("duel runs are reproducible with both forgiveness and execution noise", () => {
  const settings = { rounds: 100, noise: 0.17, seed: 20260907 };
  const first = runDuel("generous", "wsls", settings);
  assert.deepEqual(runDuel("generous", "wsls", settings), first);
  assert.notDeepEqual(
    runDuel("generous", "wsls", { ...settings, seed: 20260908 }),
    first,
  );
});

test("execution noise flips actual actions and scoring uses those actions", () => {
  const duel = runDuel("tft", "defect", {
    rounds: 300,
    noise: 0.2,
    seed: 20260907,
  });
  let totalA = 0;
  let totalB = 0;
  let cooperationA = 0;
  let cooperationB = 0;
  let flipsA = 0;
  let flipsB = 0;
  let asymmetricFlips = 0;
  for (const [index, round] of duel.rounds.entries()) {
    assert.equal(round.number, index + 1);
    assert.equal(
      round.intendedA,
      index === 0 ? "C" : duel.rounds[index - 1].actionB,
    );
    assert.equal(round.intendedB, "D");
    for (const seat of ["A", "B"]) {
      assert.equal(typeof round[`noise${seat}`], "boolean");
      const intended = round[`intended${seat}`];
      const expected = round[`noise${seat}`]
        ? intended === "C"
          ? "D"
          : "C"
        : intended;
      assert.equal(round[`action${seat}`], expected);
    }
    const [scoreA, scoreB] = payoff(round.actionA, round.actionB);
    assert.equal(round.scoreA, scoreA);
    assert.equal(round.scoreB, scoreB);
    totalA += scoreA;
    totalB += scoreB;
    assert.equal(round.totalA, totalA);
    assert.equal(round.totalB, totalB);
    cooperationA += Number(round.actionA === "C");
    cooperationB += Number(round.actionB === "C");
    flipsA += Number(round.noiseA);
    flipsB += Number(round.noiseB);
    asymmetricFlips += Number(round.noiseA !== round.noiseB);
  }
  assert.ok(
    flipsA > 0 && flipsB > 0,
    "fixture must exercise noise on both seats",
  );
  assert.ok(asymmetricFlips > 0, "seats must not share a single noise draw");
  assert.equal(duel.totalA, totalA);
  assert.equal(duel.totalB, totalB);
  closeTo(
    duel.cooperationA,
    cooperationA / duel.rounds.length,
    "actual cooperation A",
  );
  closeTo(
    duel.cooperationB,
    cooperationB / duel.rounds.length,
    "actual cooperation B",
  );
});

test("valid configuration endpoints retain the requested round count", () => {
  for (const settings of [
    { rounds: 20, noise: 0, seed: 0 },
    { rounds: 300, noise: 0.2, seed: 0xffffffff },
  ]) {
    const duel = runDuel("grim", "wsls", settings);
    assert.equal(duel.rounds.length, settings.rounds);
  }
});

test("tournament contains all 21 unordered pairs and aggregates each seat correctly", () => {
  const tournament = runTournament({ rounds: 60, noise: 0.15, seed: 402 });
  const order = STRATEGIES.map(({ id }) => id);
  assert.equal(tournament.duels.length, 21);
  assert.equal(tournament.matrix.length, order.length);
  assert.equal(tournament.cooperation.length, order.length);
  for (const row of [...tournament.matrix, ...tournament.cooperation]) {
    assert.equal(row.length, order.length);
  }
  assert.ok(
    tournament.duels.some(
      (duel) => duel.left === duel.right && duel.totalA !== duel.totalB,
    ),
    "fixture must distinguish self-duel seats so a one-seat diagonal cannot pass",
  );
  const pairs = new Set();
  for (const duel of tournament.duels) {
    const i = order.indexOf(duel.left);
    const j = order.indexOf(duel.right);
    assert.ok(i >= 0 && j >= 0);
    pairs.add([i, j].sort((a, b) => a - b).join(":"));
    const rounds = duel.rounds.length;
    if (i === j) {
      closeTo(
        tournament.matrix[i][i],
        (duel.totalA + duel.totalB) / (2 * rounds),
        `${duel.left} self score`,
      );
      closeTo(
        tournament.cooperation[i][i],
        (duel.cooperationA + duel.cooperationB) / 2,
        `${duel.left} self cooperation`,
      );
    } else {
      closeTo(
        tournament.matrix[i][j],
        duel.totalA / rounds,
        `${duel.left} versus ${duel.right}`,
      );
      closeTo(
        tournament.matrix[j][i],
        duel.totalB / rounds,
        `${duel.right} versus ${duel.left}`,
      );
      closeTo(
        tournament.cooperation[i][j],
        duel.cooperationA,
        "left cooperation cell",
      );
      closeTo(
        tournament.cooperation[j][i],
        duel.cooperationB,
        "right cooperation cell",
      );
    }
  }
  assert.equal(pairs.size, 21, "each unordered pair must appear exactly once");
  for (let i = 0; i < order.length; i++) {
    for (let j = i; j < order.length; j++) assert.ok(pairs.has(`${i}:${j}`));
  }
  assert.deepEqual(
    tournament.ranking.map(({ id }) => id).sort(),
    [...ids].sort(),
  );
  for (const entry of tournament.ranking) {
    const i = order.indexOf(entry.id);
    closeTo(
      entry.average,
      tournament.matrix[i].reduce((a, b) => a + b, 0) / order.length,
      `${entry.id} average`,
    );
    closeTo(
      entry.cooperation,
      tournament.cooperation[i].reduce((a, b) => a + b, 0) / order.length,
      `${entry.id} cooperation`,
    );
  }
});

test("reversing a duel exchanges every seat field without changing stored results", () => {
  const tournament = runTournament({ rounds: 30, noise: 0.2, seed: 921 });
  const before = structuredClone(tournament);
  const direct = getDuel(tournament, "cooperate", "defect");
  const reverse = getDuel(tournament, "defect", "cooperate");
  assert.equal(direct.left, "cooperate");
  assert.equal(direct.right, "defect");
  assert.equal(reverse.left, direct.right);
  assert.equal(reverse.right, direct.left);
  assert.equal(reverse.totalA, direct.totalB);
  assert.equal(reverse.totalB, direct.totalA);
  assert.equal(reverse.cooperationA, direct.cooperationB);
  assert.equal(reverse.cooperationB, direct.cooperationA);
  assert.equal(reverse.rounds.length, direct.rounds.length);
  for (const [index, round] of reverse.rounds.entries()) {
    const original = direct.rounds[index];
    assert.equal(round.number, original.number);
    for (const field of ["intended", "action", "noise", "score", "total"]) {
      assert.equal(round[`${field}A`], original[`${field}B`]);
      assert.equal(round[`${field}B`], original[`${field}A`]);
    }
  }
  assert.deepEqual(tournament, before, "getDuel must not mutate stored seats");
});

test("CSV exports one header and every noisy round with the original duel values", () => {
  const duel = runDuel("tft", "defect", {
    rounds: 20,
    noise: 0.2,
    seed: 20260907,
  });
  assert.ok(
    duel.rounds.some((round) => round.noiseA || round.noiseB),
    "fixture must exercise an actual execution flip",
  );
  const csv = duelCSV(duel);
  assert.equal(
    csv.charCodeAt(0),
    0xfeff,
    "CSV must start with a UTF-8 BOM marker",
  );
  const lines = csv.slice(1).split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  assert.equal(
    lines.length,
    duel.rounds.length + 1,
    "no missing or extra data rows",
  );
  assert.deepEqual(lines[0].split(","), [
    "round",
    "left_strategy",
    "right_strategy",
    "intended_left",
    "actual_left",
    "noise_left",
    "score_left",
    "total_left",
    "intended_right",
    "actual_right",
    "noise_right",
    "score_right",
    "total_right",
  ]);
  for (const [index, round] of duel.rounds.entries()) {
    assert.deepEqual(
      lines[index + 1].split(","),
      [
        round.number,
        duel.left,
        duel.right,
        round.intendedA,
        round.actionA,
        Number(round.noiseA),
        round.scoreA,
        round.totalA,
        round.intendedB,
        round.actionB,
        Number(round.noiseB),
        round.scoreB,
        round.totalB,
      ].map(String),
      `CSV row ${index + 1} must preserve both seats and their running totals`,
    );
  }
});

test("share settings round-trip completely and encode deterministically", () => {
  for (const settings of [
    { rounds: 20, noise: 0, seed: 0, left: "cooperate", right: "defect" },
    { rounds: 300, noise: 0.2, seed: 0xffffffff, left: "grim", right: "wsls" },
    {
      rounds: 137,
      noise: 0.073,
      seed: 20260907,
      left: "generous",
      right: "tft",
    },
  ]) {
    const hash = encodeSettings(settings);
    assert.equal(typeof hash, "string");
    assert.ok(hash.length > 0);
    assert.equal(encodeSettings({ ...settings }), hash);
    assert.deepEqual(decodeSettings(hash), settings);
  }
});

test("malformed share strings return null instead of crashing", () => {
  for (const hash of [
    null,
    undefined,
    123,
    "",
    "#",
    "not-a-share",
    "#v1.",
    "#v1.%%%invalid%%%",
    "#v999.e30",
    "#v1.e30",
    "#v1." + "a".repeat(1000),
    '{"rounds":20}',
  ]) {
    assert.equal(
      decodeSettings(hash),
      null,
      `invalid hash ${JSON.stringify(hash)}`,
    );
  }
});

test("share decoder rejects out-of-range, mistyped, missing, and noncanonical settings", () => {
  const valid = {
    rounds: 120,
    noise: 0.05,
    seed: 42,
    left: "tft",
    right: "generous",
  };
  const encoded = encodeSettings(valid);
  const separator = encoded.indexOf(".");
  const prefix = encoded.slice(0, separator + 1);
  const payload = JSON.parse(
    Buffer.from(encoded.slice(separator + 1), "base64url").toString("utf8"),
  );
  const hashOf = (value) =>
    prefix + Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  assert.equal(
    hashOf(payload),
    encoded,
    "mutation fixture must preserve the accepted wire format",
  );

  for (const [field, badValues] of Object.entries({
    rounds: [19, 301, 20.5, "120", null],
    noise: [-0.01, 0.201, "0.05", null],
    seed: [-1, 0x100000000, 1.5, "42", null],
    left: ["unknown", "", null],
    right: ["unknown", "", null],
    v: [0, 2, "1", null],
  })) {
    for (const value of badValues) {
      assert.equal(
        decodeSettings(hashOf({ ...payload, [field]: value })),
        null,
        `reject ${field}=${JSON.stringify(value)}`,
      );
    }
    const missing = { ...payload };
    delete missing[field];
    assert.equal(
      decodeSettings(hashOf(missing)),
      null,
      `reject missing ${field}`,
    );
  }
  assert.equal(decodeSettings(hashOf({ ...payload, extra: true })), null);
  assert.equal(
    decodeSettings(encoded + "="),
    null,
    "padded encodings are not canonical",
  );
  assert.equal(
    encodeSettings({
      right: valid.right,
      seed: valid.seed,
      left: valid.left,
      noise: valid.noise,
      rounds: valid.rounds,
    }),
    encoded,
    "object property order must not affect a share link",
  );
});

test("single mistake preserves a cooperative baseline and scores actual actions", () => {
  for (const strategy of ["tft", "grim", "wsls"]) {
    const experiment = runSingleMistake(strategy, 40, 5);
    assert.equal(experiment.strategy, strategy);
    assert.equal(experiment.rounds, 40);
    assert.equal(experiment.errorRound, 5);
    assert.equal(experiment.baseline.mutualCooperation, 40);
    assert.equal(experiment.baseline.recoveryStart, 6);
    for (const [name, trace] of Object.entries({
      baseline: experiment.baseline,
      intervention: experiment.intervention,
    })) {
      assert.equal(trace.rounds.length, 40);
      const historyA = [];
      const historyB = [];
      let totalA = 0;
      let totalB = 0;
      let mutual = 0;
      for (const [index, round] of trace.rounds.entries()) {
        const forced = name === "intervention" && index === 4;
        assert.equal(round.number, index + 1);
        assert.equal(round.forcedA, forced);
        assert.equal(round.intendedA, decide(strategy, historyA, historyB, () => 0));
        assert.equal(round.intendedB, decide(strategy, historyB, historyA, () => 0));
        assert.equal(round.actionA, forced
          ? (round.intendedA === "C" ? "D" : "C")
          : round.intendedA);
        assert.equal(round.actionB, round.intendedB, "right seat has no execution noise");
        if (name === "baseline") {
          assert.equal(round.actionA, "C");
          assert.equal(round.actionB, "C");
        }
        const [scoreA, scoreB] = payoff(round.actionA, round.actionB);
        assert.equal(round.scoreA, scoreA);
        assert.equal(round.scoreB, scoreB);
        totalA += scoreA;
        totalB += scoreB;
        assert.equal(round.totalA, totalA);
        assert.equal(round.totalB, totalB);
        mutual += Number(round.actionA === "C" && round.actionB === "C");
        historyA.push(round.actionA);
        historyB.push(round.actionB);
      }
      assert.equal(trace.mutualCooperation, mutual);
      assert.equal(trace.rounds.filter((round) => round.forcedA).length,
        name === "intervention" ? 1 : 0);
    }
  }
});

test("one fifth-round mistake produces distinct TFT, grim, and WSLS trajectories", () => {
  const cases = [
    {
      strategy: "tft",
      expected: [...Array(4).fill("CC"), ...Array.from({ length: 36 }, (_, i) => i % 2 === 0 ? "DC" : "CD")],
      mutual: 4,
      recovery: null,
    },
    {
      strategy: "grim",
      expected: [...Array(4).fill("CC"), "DC", "CD", ...Array(34).fill("DD")],
      mutual: 4,
      recovery: null,
    },
    {
      strategy: "wsls",
      expected: [...Array(4).fill("CC"), "DC", "DD", ...Array(34).fill("CC")],
      mutual: 38,
      recovery: 7,
    },
  ];
  for (const { strategy, expected, mutual, recovery } of cases) {
    const { intervention } = runSingleMistake(strategy, 40, 5);
    assert.deepEqual(intervention.rounds.map((round) => round.actionA + round.actionB), expected, strategy);
    assert.equal(intervention.mutualCooperation, mutual, strategy);
    assert.equal(intervention.recoveryStart, recovery, strategy);
  }
});

test("recovery requires ten complete mutual cooperation rounds strictly after the mistake", () => {
  const ten = runSingleMistake("wsls", 40, 29);
  assert.equal(ten.intervention.recoveryStart, 31);
  assert.equal(ten.intervention.rounds.slice(30).length, 10);
  assert.ok(ten.intervention.rounds.slice(30).every((round) => round.actionA === "C" && round.actionB === "C"));
  const nine = runSingleMistake("wsls", 40, 30);
  assert.equal(nine.intervention.recoveryStart, null);
  assert.equal(nine.intervention.rounds.slice(31).length, 9);
  assert.ok(nine.intervention.rounds.slice(31).every((round) => round.actionA === "C" && round.actionB === "C"));
  assert.equal(nine.baseline.recoveryStart, 31, "baseline has exactly ten rounds after the intervention time");
  assert.equal(runSingleMistake("wsls", 40, 31).baseline.recoveryStart, null);
});

test("single mistake supports first and final rounds at valid duration endpoints", () => {
  for (const rounds of [20, 300]) {
    const first = runSingleMistake("wsls", rounds, 1);
    assert.equal(first.intervention.rounds.length, rounds);
    assert.equal(first.intervention.rounds[0].forcedA, true);
    assert.equal(first.intervention.mutualCooperation, rounds - 2);
    assert.equal(first.intervention.recoveryStart, 3);
    assert.equal(first.baseline.recoveryStart, 2);
  }
  for (const strategy of ["tft", "grim", "wsls"]) {
    const last = runSingleMistake(strategy, 40, 40);
    assert.equal(last.intervention.mutualCooperation, 39);
    assert.equal(last.intervention.recoveryStart, null);
    assert.equal(last.baseline.recoveryStart, null);
    assert.ok(last.intervention.rounds.slice(0, -1).every((round) =>
      !round.forcedA && round.actionA === "C" && round.actionB === "C"));
    assert.equal(last.intervention.rounds.at(-1).forcedA, true);
    assert.equal(last.intervention.rounds.at(-1).actionA, "D");
    assert.equal(last.intervention.rounds.at(-1).actionB, "C");
  }
});

test("single mistake rejects unsupported strategies and invalid round bounds", () => {
  for (const strategy of ["generous", "cooperate", "defect", "unknown", null, undefined]) {
    assert.throws(() => runSingleMistake(strategy, 40, 5), `unsupported strategy ${strategy}`);
  }
  for (const rounds of [0, 19, 301, 40.5, NaN, Infinity, "40", null, undefined]) {
    assert.throws(() => runSingleMistake("tft", rounds, 5), `invalid duration ${rounds}`);
  }
  for (const errorRound of [-1, 0, 41, 5.5, NaN, Infinity, "5", null, undefined]) {
    assert.throws(() => runSingleMistake("tft", 40, errorRound), `invalid mistake round ${errorRound}`);
  }
});

test("single mistake is repeatable and does not alter tournament state", () => {
  const settings = { rounds: 40, noise: 0.17, seed: 20260907 };
  const before = runTournament(settings);
  const snapshot = structuredClone(before);
  for (const strategy of ["tft", "grim", "wsls"]) {
    assert.deepEqual(runSingleMistake(strategy, 40, 5), runSingleMistake(strategy, 40, 5));
  }
  assert.deepEqual(before, snapshot, "existing tournament data remains unchanged");
  assert.deepEqual(runTournament(settings), snapshot, "subsequent tournament draws remain unchanged");
});
