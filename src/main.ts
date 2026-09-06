import "./style.css";
import {
  DEFAULT_SETTINGS,
  STRATEGIES,
  decodeSettings,
  duelCSV,
  encodeSettings,
  getDuel,
  runSingleMistake,
  runTournament,
  type Settings,
  type SingleErrorStrategy,
  type StrategyId,
} from "./game";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const strategy = (id: StrategyId) => STRATEGIES.find((item) => item.id === id)!;
const restored = decodeSettings(location.hash);
let settings: Settings = restored ?? { ...DEFAULT_SETTINGS };
let tournament = runTournament(settings);
let duel = getDuel(tournament, settings.left, settings.right);
let inspected = 1;
const chart = $<HTMLCanvasElement>("score-chart");
const context = chart.getContext("2d")!;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const report = (text: string) => {
  $("status").textContent = text;
};

for (const id of ["left-strategy", "right-strategy"]) {
  const select = $<HTMLSelectElement>(id);
  for (const item of STRATEGIES) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
}
$("strategy-rules").replaceChildren(
  ...STRATEGIES.map((item) => {
    const article = document.createElement("article");
    article.className = "rule";
    const code = document.createElement("span");
    code.className = "rule-code";
    code.textContent = item.short;
    const name = document.createElement("h3");
    name.textContent = item.name;
    const description = document.createElement("p");
    description.textContent = item.description;
    article.append(code, name, description);
    return article;
  }),
);

function writeControls() {
  $<HTMLInputElement>("rounds").value = String(settings.rounds);
  $<HTMLInputElement>("noise").value = String(settings.noise * 100);
  $<HTMLInputElement>("seed").value = String(settings.seed);
  $("round-value").textContent = `${settings.rounds} 轮`;
  $("noise-value").textContent = percent(settings.noise);
  $<HTMLSelectElement>("left-strategy").value = settings.left;
  $<HTMLSelectElement>("right-strategy").value = settings.right;
  document
    .querySelectorAll<HTMLButtonElement>("[data-noise]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(
          Math.abs(Number(button.dataset.noise) / 100 - settings.noise) < 1e-12,
        ),
      ),
    );
}

function readControls(): Settings {
  const seed = Number($<HTMLInputElement>("seed").value);
  return {
    rounds: Math.max(
      20,
      Math.min(
        300,
        Math.round(Number($<HTMLInputElement>("rounds").value) || 120),
      ),
    ),
    noise: Math.max(
      0,
      Math.min(0.2, Number($<HTMLInputElement>("noise").value) / 100 || 0),
    ),
    seed: Number.isFinite(seed)
      ? Math.max(0, Math.min(0xffffffff, Math.floor(seed)))
      : 42,
    left: settings.left,
    right: settings.right,
  };
}

function renderRanking() {
  $("ranking").replaceChildren(
    ...tournament.ranking.map((standing, index) => {
      const item = strategy(standing.id);
      const button = document.createElement("button");
      button.className = "ranking-row";
      button.dataset.strategy = item.id;
      button.setAttribute(
        "aria-label",
        `${item.name}，平均每轮 ${standing.average.toFixed(3)} 分，合作率 ${percent(standing.cooperation)}。点击选为左方策略。`,
      );
      button.innerHTML = `<span class="rank-number">${String(index + 1).padStart(2, "0")}</span><span class="rank-name">${item.name}<small>${item.short} · 合作 ${percent(standing.cooperation)}</small></span><span class="bar-wrap"><span class="score-track"><span style="width:${(standing.average / 5) * 100}%"></span></span><strong>${standing.average.toFixed(3)}</strong></span>`;
      button.onclick = () => selectDuel(item.id, settings.right);
      return button;
    }),
  );
  $("overall-cooperation").textContent = percent(
    tournament.ranking.reduce((sum, row) => sum + row.cooperation, 0) /
      STRATEGIES.length,
  );
}

function renderMatrix() {
  const table = $<HTMLTableElement>("matrix");
  while (table.children.length > 1) table.lastElementChild!.remove();
  const head = document.createElement("thead"),
    heading = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "行 / 列";
  heading.append(corner);
  for (const item of STRATEGIES) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.title = item.name;
    cell.textContent = item.short;
    heading.append(cell);
  }
  head.append(heading);
  table.append(head);
  const body = document.createElement("tbody");
  STRATEGIES.forEach((left, i) => {
    const row = document.createElement("tr"),
      label = document.createElement("th");
    label.scope = "row";
    label.title = left.name;
    label.textContent = left.short;
    row.append(label);
    STRATEGIES.forEach((right, j) => {
      const score = tournament.matrix[i][j];
      const cell = document.createElement("td"),
        button = document.createElement("button");
      button.dataset.left = left.id;
      button.dataset.right = right.id;
      button.style.background = `rgba(62, 119, 76, ${0.06 + (0.62 * score) / 5})`;
      button.style.color = score > 3.5 ? "#f4f7ec" : "#2f573a";
      button.textContent = score.toFixed(3);
      button.setAttribute(
        "aria-label",
        `${left.name} 对 ${right.name}，平均每轮 ${score.toFixed(3)} 分${i === j ? "，自局双方平均" : ""}`,
      );
      button.onclick = () => selectDuel(left.id, right.id);
      cell.append(button);
      row.append(cell);
    });
    body.append(row);
  });
  table.append(body);
}

function selectDuel(left: StrategyId, right: StrategyId) {
  settings = { ...settings, left, right };
  writeControls();
  renderDuel();
}

function renderDuel() {
  duel = getDuel(tournament, settings.left, settings.right);
  $("name-a").textContent = strategy(settings.left).name;
  $("name-b").textContent = strategy(settings.right).name;
  $("track-name-a").textContent = strategy(settings.left).name;
  $("track-name-b").textContent = strategy(settings.right).name;
  $("score-a").textContent = String(duel.totalA);
  $("score-b").textContent = String(duel.totalB);
  $("coop-a").textContent = percent(duel.cooperationA);
  $("coop-b").textContent = percent(duel.cooperationB);
  $("last-round").textContent = `第 ${settings.rounds} 轮`;
  $<HTMLInputElement>("inspect-round").max = String(settings.rounds);
  document.querySelector<HTMLElement>(".tracks")!.style.minWidth =
    `${Math.max(300, settings.rounds * 3)}px`;
  for (const side of ["a", "b"] as const) {
    const track = $("track-" + side);
    track.style.gridTemplateColumns = `repeat(${settings.rounds}, minmax(2px, 1fr))`;
    track.setAttribute(
      "aria-label",
      `${side === "a" ? strategy(settings.left).name : strategy(settings.right).name}的实际动作，共 ${settings.rounds} 轮。使用查看轮次滑块读取明细。`,
    );
    track.replaceChildren(
      ...duel.rounds.map((round) => {
        const action = side === "a" ? round.actionA : round.actionB,
          flipped = side === "a" ? round.noiseA : round.noiseB;
        const span = document.createElement("span");
        span.className = `action ${action.toLowerCase()}${flipped ? " flipped" : ""}`;
        span.dataset.round = String(round.number);
        span.title = `第 ${round.number} 轮：${action === "C" ? "合作" : "不合作"}${flipped ? "（执行翻转）" : ""}`;
        return span;
      }),
    );
  }
  document
    .querySelectorAll<HTMLButtonElement>("#matrix button")
    .forEach((button) => {
      const selected =
        button.dataset.left === settings.left &&
        button.dataset.right === settings.right;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  const flips = duel.rounds.reduce(
    (sum, round) => sum + Number(round.noiseA) + Number(round.noiseB),
    0,
  );
  $("duel-note").textContent =
    `来自同一次全体比较；${settings.rounds * 2} 个实际动作中有 ${flips} 次执行翻转。${settings.left === settings.right ? "自我对局的矩阵得分取两席平均。" : "双方累计分数分别对应矩阵的两个方向。"}`;
  inspect(inspected);
}

function inspect(round: number) {
  inspected = Math.max(1, Math.min(settings.rounds, Math.round(round) || 1));
  $<HTMLInputElement>("inspect-round").value = String(inspected);
  $("inspect-value").textContent = `第 ${inspected} 轮`;
  const value = duel.rounds[inspected - 1];
  $("round-detail").innerHTML =
    `<p><strong class="a-label">左方 · ${strategy(settings.left).name}</strong>：原意 ${value.intendedA} → 实际 <strong>${value.actionA}</strong>${value.noiseA ? "（执行翻转）" : ""} · 本轮 ${value.scoreA}，累计 ${value.totalA}</p><p><strong class="b-label">右方 · ${strategy(settings.right).name}</strong>：原意 ${value.intendedB} → 实际 <strong>${value.actionB}</strong>${value.noiseB ? "（执行翻转）" : ""} · 本轮 ${value.scoreB}，累计 ${value.totalB}</p>`;
  $<HTMLInputElement>("inspect-round").setAttribute(
    "aria-valuetext",
    `第 ${inspected} 轮，左方实际 ${value.actionA} 得 ${value.scoreA} 分，右方实际 ${value.actionB} 得 ${value.scoreB} 分`,
  );
  for (const track of [$("track-a"), $("track-b")]) {
    track.querySelector(".chosen")?.classList.remove("chosen");
    track.children[inspected - 1]?.classList.add("chosen");
  }
  drawChart();
}

function drawChart() {
  const rect = chart.getBoundingClientRect(),
    ratio = Math.min(devicePixelRatio || 1, 2);
  const width = rect.width,
    height = rect.height;
  if (width <= 0 || height <= 0) return;
  chart.width = Math.round(width * ratio);
  chart.height = Math.round(height * ratio);
  const ctx = context;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const left = 40,
    right = width - 12,
    top = 15,
    bottom = height - 27;
  const ceiling = Math.max(
    10,
    Math.ceil(Math.max(duel.totalA, duel.totalB) / 20) * 20,
  );
  const x = (round: number) =>
    left + (round / settings.rounds) * (right - left);
  const y = (score: number) => bottom - (score / ceiling) * (bottom - top);
  ctx.font = "9px Consolas, monospace";
  for (let tick = 0; tick <= 4; tick++) {
    const value = (ceiling * tick) / 4;
    ctx.strokeStyle = "#e8ecdf";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillStyle = "#97a28b";
    ctx.textAlign = "right";
    ctx.fillText(String(value), left - 8, y(value) + 3);
  }
  ctx.textAlign = "center";
  for (const round of [0, Math.floor(settings.rounds / 2), settings.rounds]) {
    ctx.fillText(String(round), x(round), bottom + 17);
  }
  ctx.strokeStyle = "#82907980";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x(inspected), top);
  ctx.lineTo(x(inspected), bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const side of ["a", "b"] as const) {
    ctx.strokeStyle = side === "a" ? "#476eb5" : "#b17742";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.setLineDash(side === "b" ? [5, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    for (const round of duel.rounds)
      ctx.lineTo(
        x(round.number),
        y(side === "a" ? round.totalA : round.totalB),
      );
    ctx.stroke();
    ctx.setLineDash([]);
    const current = duel.rounds[inspected - 1];
    ctx.beginPath();
    ctx.arc(
      x(inspected),
      y(side === "a" ? current.totalA : current.totalB),
      3.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  chart.setAttribute(
    "aria-label",
    `左方 ${strategy(settings.left).name}累计 ${duel.totalA} 分；右方 ${strategy(settings.right).name}累计 ${duel.totalB} 分。共 ${settings.rounds} 轮。轮次滑块和明细显示具体动作与得分。`,
  );
}

function runExperiment(next: Settings, message?: string) {
  settings = next;
  tournament = runTournament(settings);
  writeControls();
  renderRanking();
  renderMatrix();
  renderDuel();
  report(
    message ??
      `已完成 21 组配对，每组 ${settings.rounds} 轮，种子 ${settings.seed}。这是本次样本的排序，不是普遍最优或真人行为建议。`,
  );
}

$("rounds").addEventListener("input", () => runExperiment(readControls()));
$("noise").addEventListener("input", () => runExperiment(readControls()));
$("seed").addEventListener("change", () => runExperiment(readControls()));
$("seed").addEventListener("keydown", (event) => {
  if ((event as KeyboardEvent).key === "Enter") {
    event.preventDefault();
    runExperiment(readControls());
  }
});
$("rerun").onclick = () => runExperiment(readControls());
$("new-seed").onclick = () => {
  $<HTMLInputElement>("seed").value = String(
    crypto.getRandomValues(new Uint32Array(1))[0],
  );
  runExperiment(readControls());
};
document.querySelectorAll<HTMLButtonElement>("[data-noise]").forEach(
  (button) =>
    (button.onclick = () => {
      $<HTMLInputElement>("noise").value = button.dataset.noise!;
      runExperiment(readControls());
    }),
);
$("left-strategy").onchange = () =>
  selectDuel(
    $<HTMLSelectElement>("left-strategy").value as StrategyId,
    settings.right,
  );
$("right-strategy").onchange = () =>
  selectDuel(
    settings.left,
    $<HTMLSelectElement>("right-strategy").value as StrategyId,
  );
$("inspect-round").addEventListener("input", () =>
  inspect(Number($<HTMLInputElement>("inspect-round").value)),
);
for (const track of [$("track-a"), $("track-b")])
  track.onclick = (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-round]",
    );
    if (target) inspect(Number(target.dataset.round));
  };
new ResizeObserver(drawChart).observe(chart);

$("share").onclick = async () => {
  const url = new URL(location.href);
  url.hash = encodeSettings(settings).slice(1);
  window.history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url.href);
    report("实验链接已复制，包含轮次、噪声、种子与选中的两种策略。");
  } catch {
    report("完整实验已保存到地址栏，请复制浏览器地址分享。");
  }
};
$("export-csv").onclick = () => {
  const blob = new Blob([duelCSV(duel)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `cooperation-${settings.seed}-${settings.left}-vs-${settings.right}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  report(
    `已导出 ${settings.rounds} 轮对局，含双方原意、实际动作、翻转标记、得分与累计分。`,
  );
};
window.addEventListener("hashchange", () => {
  if (!location.hash || ["#rules", "#limits"].includes(location.hash)) return;
  const parsed = decodeSettings(location.hash);
  if (parsed)
    runExperiment(parsed, "已载入分享实验，并根据同一组设置重新计算全部对局。");
  else report("分享链接无效，当前实验保持不变。");
});
runExperiment(
  settings,
  restored
    ? "已载入分享实验：相同设置、种子与对局，结果可复现。"
    : location.hash && !["#rules", "#limits"].includes(location.hash)
      ? "分享链接无效，已载入默认实验。"
      : undefined,
);

function renderSingleMistake() {
  const form = $<HTMLFormElement>("mistake-form");
  if (!form.reportValidity()) return;
  const count = Number($<HTMLInputElement>("mistake-rounds").value);
  const at = Number($<HTMLInputElement>("mistake-at").value);
  const pair = $<HTMLSelectElement>("mistake-pair")
    .value as SingleErrorStrategy;
  const comparison = runSingleMistake(pair, count, at);
  $("mistake-baseline-count").textContent = String(
    comparison.baseline.mutualCooperation,
  );
  $("mistake-intervention-count").textContent = String(
    comparison.intervention.mutualCooperation,
  );
  for (const name of ["baseline", "intervention"] as const) {
    const trace = comparison[name];
    for (const side of ["a", "b"] as const) {
      const track = $("mistake-" + name + "-" + side);
      track.style.gridTemplateColumns = `repeat(${count}, minmax(2px, 1fr))`;
      track.parentElement!.style.minWidth = `${Math.max(240, count * 3)}px`;
      track.replaceChildren(
        ...trace.rounds.map((round) => {
          const action = side === "a" ? round.actionA : round.actionB;
          const forced =
            name === "intervention" && side === "a" && round.forcedA;
          const cell = document.createElement("span");
          cell.className = `mistake-action ${action.toLowerCase()}${forced ? " forced" : ""}`;
          cell.dataset.round = String(round.number);
          cell.title = `第 ${round.number} 轮：${action}${forced ? "（强制翻转，仅此一次）" : ""}`;
          return cell;
        }),
      );
      track.setAttribute(
        "aria-label",
        `${name === "baseline" ? "无干预" : "单次失误"}，${side === "a" ? "左方" : "右方"}，第 1 至 ${count} 轮实际动作：${trace.rounds.map((round) => (side === "a" ? round.actionA : round.actionB)).join(" ")}`,
      );
    }
  }
  const recovery = comparison.intervention.recoveryStart;
  $("mistake-recovery").textContent =
    recovery === null ? "观察窗口内未恢复" : `第 ${recovery} 轮`;
  const outcome =
    recovery === null
      ? "没有观测到完整的连续 10 轮共同合作。"
      : `第 ${recovery} 至 ${recovery + 9} 轮构成首个完整区段。`;
  $("mistake-window").textContent =
    `在 ${count} 轮中仅第 ${at} 轮翻转左方动作；干预后剩余 ${count - at} 轮。${outcome}`;
}
$("mistake-rounds").addEventListener("input", () => {
  const value = Number($<HTMLInputElement>("mistake-rounds").value);
  if (Number.isInteger(value) && value >= 20 && value <= 300) {
    $<HTMLInputElement>("mistake-at").max = String(value);
  }
});
$("mistake-form").addEventListener("submit", (event) => {
  event.preventDefault();
  renderSingleMistake();
});
renderSingleMistake();
