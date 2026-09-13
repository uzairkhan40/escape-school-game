import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type GameState = "menu" | "start" | "playing" | "paused" | "gameover";
type Lane = 0 | 1 | 2;
type ObstacleKind = "teacher" | "desk" | "prefect" | "banana";
type PuzzleType = "math" | "attendance" | "bag";

type Player = {
  lane: Lane;
  targetLane: Lane;
  y: number;
  vy: number;
  jumping: boolean;
  ducking: number;
  invuln: number;
  blink: number;
};

type Obstacle = {
  id: number;
  lane: Lane;
  z: number;
  kind: ObstacleKind;
  height: number;
  width: number;
  hue: string;
};

type Particle = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type Puzzle = {
  type: PuzzleType;
  prompt: string;
  answer: string;
  options?: string[];
  hint: string;
  timer: number;
  reward: number;
};

type HighScoreEntry = {
  name: string;
  score: number;
  stamp: number;
};

const LANES_X = [0.2, 0.5, 0.8] as const;
const HIGH_SCORE_KEY = "escape-school-highscores-v1";
const PLAYER_NAME = "Topper";
const INITIAL_SPEED = 0.52;
const SPEED_GAIN = 0.03;
const SCHOOL_MESSAGES = [
  "Teacher aa raha hai!",
  "Bell baj gayi — bhaag!",
  "Principal patrol spotted!",
  "Canteen ki smell = turbo mode",
  "Homework se bach ke niklo!",
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function laneDelta(from: Lane, dir: -1 | 1): Lane {
  return clamp((from + dir) as number, 0, 2) as Lane;
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function createPuzzle(): Puzzle {
  const roll = Math.random();
  if (roll < 0.34) {
    const a = Math.floor(rand(3, 10));
    const b = Math.floor(rand(2, 8));
    return {
      type: "math",
      prompt: `${a} × ${b} = ?`,
      answer: String(a * b),
      hint: "Type answer fast",
      timer: 6,
      reward: 120,
    };
  }
  if (roll < 0.67) {
    const word = pick(["proxy", "mass bunk", "library", "canteen", "holiday"]);
    const scrambled = word
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
    return {
      type: "attendance",
      prompt: `Unscramble: ${scrambled.toUpperCase()}`,
      answer: word,
      hint: "Lowercase or uppercase both okay",
      timer: 7,
      reward: 150,
    };
  }

  const answer = pick(["left", "right", "jump", "duck"]);
  return {
    type: "bag",
    prompt: `Bag check! Type: ${answer.toUpperCase()}`,
    answer,
    options: ["left", "right", "jump", "duck"],
    hint: "One word only",
    timer: 5,
    reward: 100,
  };
}

function loadHighScores(): HighScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HighScoreEntry[];
    return parsed.sort((a, b) => b.score - a.score).slice(0, 5);
  } catch {
    return [];
  }
}

function saveHighScore(score: number) {
  if (typeof window === "undefined") return loadHighScores();
  const next = [...loadHighScores(), { name: PLAYER_NAME, score, stamp: Date.now() }]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  window.localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(next));
  return next;
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>("menu");
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [combo, setCombo] = useState(0);
  const [message, setMessage] = useState("Steal freedom before assembly starts.");
  const [highScores, setHighScores] = useState<HighScoreEntry[]>([]);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [puzzleInput, setPuzzleInput] = useState("");
  const [flash, setFlash] = useState(0);

  const playerRef = useRef<Player>({
    lane: 1,
    targetLane: 1,
    y: 0,
    vy: 0,
    jumping: false,
    ducking: 0,
    invuln: 0,
    blink: 0,
  });
  const obstaclesRef = useRef<Obstacle[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const speedRef = useRef(INITIAL_SPEED);
  const spawnTimerRef = useRef(0.8);
  const puzzleTimerRef = useRef(7);
  const puzzleCooldownRef = useRef(5);
  const nextIdRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const shakeRef = useRef(0);

  const [, forceRender] = useState(0);

  const laneGuide = useMemo(() => ["Window side", "Main aisle", "Trophy side"], []);

  useEffect(() => {
    setHighScores(loadHighScores());
  }, []);

  const sync = () => forceRender((v) => v + 1);

  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    const burst: Particle[] = [];
    for (let i = 0; i < count; i += 1) {
      burst.push({
        id: nextIdRef.current++,
        x,
        y,
        vx: rand(-0.35, 0.35),
        vy: rand(-0.45, 0.15),
        life: rand(0.4, 0.8),
        maxLife: rand(0.4, 0.8),
        size: rand(5, 12),
        color,
      });
    }
    particlesRef.current.push(...burst);
  };

  const resetRun = () => {
    playerRef.current = {
      lane: 1,
      targetLane: 1,
      y: 0,
      vy: 0,
      jumping: false,
      ducking: 0,
      invuln: 0,
      blink: 0,
    };
    obstaclesRef.current = [];
    particlesRef.current = [];
    speedRef.current = INITIAL_SPEED;
    spawnTimerRef.current = 0.65;
    puzzleCooldownRef.current = 4.5;
    shakeRef.current = 0;
    lastTimeRef.current = 0;
    setScore(0);
    setDistance(0);
    setCombo(0);
    setPuzzle(null);
    setPuzzleInput("");
    setFlash(0);
    setMessage("Run to the gate before the PT sir catches you.");
  };

  const startGame = () => {
    resetRun();
    setGameState("playing");
    spawnParticles(50, 75, "#facc15", 20);
    sync();
  };

  const endGame = (finalScore: number) => {
    shakeRef.current = 16;
    setFlash(0.9);
    setGameState("gameover");
    setMessage("Caught red-handed. Instant restart maaro 😂");
    setHighScores(saveHighScore(finalScore));
    spawnParticles(50, 68, "#fb7185", 28);
    sync();
  };

  const moveLane = (dir: -1 | 1) => {
    const player = playerRef.current;
    const next = laneDelta(player.targetLane, dir);
    if (next !== player.targetLane) {
      player.targetLane = next;
      shakeRef.current = Math.max(shakeRef.current, 4);
      spawnParticles(18 + LANES_X[next] * 64, 83, "#60a5fa", 8);
      sync();
    }
  };

  const jump = () => {
    const player = playerRef.current;
    if (!player.jumping) {
      player.jumping = true;
      player.vy = 1.25;
      spawnParticles(18 + LANES_X[player.lane] * 64, 84, "#fde68a", 14);
      sync();
    }
  };

  const duck = () => {
    const player = playerRef.current;
    player.ducking = 0.55;
    spawnParticles(18 + LANES_X[player.lane] * 64, 86, "#c4b5fd", 10);
    sync();
  };

  const triggerPuzzle = () => {
    const nextPuzzle = createPuzzle();
    puzzleTimerRef.current = nextPuzzle.timer;
    setPuzzle(nextPuzzle);
    setPuzzleInput("");
    setMessage("Mini puzzle! Solve fast for bonus points.");
    shakeRef.current = 8;
    spawnParticles(50, 35, "#34d399", 22);
    sync();
  };

  const resolvePuzzle = (success: boolean) => {
    if (!puzzle) return;
    if (success) {
      setScore((s) => s + puzzle.reward + combo * 10);
      setCombo((c) => c + 1);
      setMessage(`Smart escape! +${puzzle.reward} score`);
      shakeRef.current = 10;
      setFlash(0.35);
      spawnParticles(50, 38, "#f59e0b", 26);
    } else {
      setCombo(0);
      setMessage("Puzzle fail... but you still sprint away!");
      shakeRef.current = 12;
      spawnParticles(50, 38, "#f87171", 16);
    }
    puzzleCooldownRef.current = rand(8, 12);
    setPuzzle(null);
    setPuzzleInput("");
    sync();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      if (puzzle) {
        if (event.key === "Enter") {
          resolvePuzzle(puzzleInput.trim().toLowerCase() === puzzle.answer.trim().toLowerCase());
        }
        if (event.key === "Escape") {
          resolvePuzzle(false);
        }
        return;
      }

      if (event.key.toLowerCase() === "p") {
        setGameState((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s));
        return;
      }
      if (event.key === "Enter" && (gameState === "menu" || gameState === "start" || gameState === "gameover")) {
        startGame();
        return;
      }
      if (gameState !== "playing") return;

      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") moveLane(-1);
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") moveLane(1);
      if (event.key === "ArrowUp" || event.key === " ") jump();
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") duck();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gameState, puzzle, puzzleInput, combo, score]);

  useEffect(() => {
    const loop = (time: number) => {
      const dt = Math.min(0.033, (time - (lastTimeRef.current || time)) / 1000);
      lastTimeRef.current = time;

      if (gameState === "playing") {
        const player = playerRef.current;
        speedRef.current += dt * SPEED_GAIN;
        spawnTimerRef.current -= dt;
        puzzleCooldownRef.current -= dt;

        if (flash > 0) setFlash((f) => Math.max(0, f - dt * 1.5));

        const laneOffset = player.targetLane - player.lane;
        if (laneOffset !== 0) {
          player.lane = (player.lane + Math.sign(laneOffset)) as Lane;
        }

        if (player.jumping) {
          player.y += player.vy * dt * 52;
          player.vy -= dt * 3.6;
          if (player.y <= 0) {
            player.y = 0;
            player.vy = 0;
            player.jumping = false;
          }
        }

        if (player.ducking > 0) player.ducking = Math.max(0, player.ducking - dt);
        if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
        if (player.blink > 0) player.blink = Math.max(0, player.blink - dt);

        if (spawnTimerRef.current <= 0) {
          const kind = pick<ObstacleKind>(["teacher", "desk", "prefect", "banana"]);
          const obstacle: Obstacle = {
            id: nextIdRef.current++,
            lane: Math.floor(rand(0, 3)) as Lane,
            z: 1.15,
            kind,
            height: kind === "banana" ? 16 : kind === "desk" ? 26 : 34,
            width: kind === "desk" ? 34 : 24,
            hue:
              kind === "teacher"
                ? "from-rose-400 to-red-600"
                : kind === "desk"
                  ? "from-amber-500 to-orange-700"
                  : kind === "prefect"
                    ? "from-indigo-400 to-violet-700"
                    : "from-yellow-300 to-yellow-500",
          };
          obstaclesRef.current.push(obstacle);
          spawnTimerRef.current = rand(0.45, 0.95) / speedRef.current;
        }

        obstaclesRef.current = obstaclesRef.current.filter((obstacle) => {
          obstacle.z -= dt * speedRef.current * 0.95;
          const nearHit = obstacle.z < 0.18 && obstacle.z > 0.06 && obstacle.lane === player.lane;
          if (nearHit && player.invuln <= 0) {
            const mustJump = obstacle.kind === "banana" || obstacle.kind === "desk";
            const mustDuck = obstacle.kind === "teacher" || obstacle.kind === "prefect";
            const jumped = player.y > 16;
            const ducked = player.ducking > 0.12;
            const safe = (mustJump && jumped) || (mustDuck && ducked);
            if (!safe) {
              endGame(score);
              return false;
            }
            setScore((s) => s + 25);
            setCombo((c) => c + 1);
            setMessage(pick(SCHOOL_MESSAGES));
            player.invuln = 0.12;
            player.blink = 0.18;
            shakeRef.current = 7;
            spawnParticles(18 + LANES_X[player.lane] * 64, 70 - player.y * 0.2, "#22c55e", 14);
          }
          if (obstacle.z <= 0) {
            setScore((s) => s + 10);
            return false;
          }
          return true;
        });

        if (puzzleCooldownRef.current <= 0 && !puzzle) {
          triggerPuzzle();
        }

        if (puzzle) {
          puzzleTimerRef.current -= dt;
          if (puzzleTimerRef.current <= 0) {
            resolvePuzzle(false);
          }
        }

        particlesRef.current = particlesRef.current.filter((particle) => {
          particle.life -= dt;
          particle.x += particle.vx * dt * 60;
          particle.y += particle.vy * dt * 60;
          particle.vy += dt * 0.4;
          return particle.life > 0;
        });

        shakeRef.current = Math.max(0, shakeRef.current - dt * 26);
        setDistance((d) => d + dt * speedRef.current * 32);
        setScore((s) => s + Math.floor(dt * 18 + combo * 0.02));
        sync();
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [gameState, puzzle, flash, combo, score]);

  const shakeX = rand(-shakeRef.current, shakeRef.current);
  const shakeY = rand(-shakeRef.current, shakeRef.current);
  const player = playerRef.current;
  const obstacles = obstaclesRef.current;
  const particles = particlesRef.current;
  const bestScore = highScores.length ? highScores[0].score : 0;

  if (gameState === "menu") {
    return <LauncherMenu bestScore={bestScore} highScores={highScores} onPlay={startGame} />;
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#140f24] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.22),_transparent_28%),linear-gradient(180deg,_#2a1c55_0%,_#120d20_48%,_#09070f_100%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col p-3 sm:p-5 lg:p-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-white/10 px-4 py-3 shadow-2xl backdrop-blur-xl">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-yellow-200/80">Escape School 😂</p>
            <h1 className="text-xl font-black sm:text-3xl">Mass bunk runner with chaos puzzles</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm sm:text-base">
            <Stat label="Score" value={score} glow="from-yellow-300 to-orange-500" />
            <Stat label="Combo" value={`${combo}x`} glow="from-cyan-300 to-sky-500" />
            <Stat label="Distance" value={`${Math.floor(distance)}m`} glow="from-fuchsia-300 to-pink-500" />
          </div>
        </header>

        <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="relative min-h-[68vh] overflow-hidden rounded-[32px] border border-white/10 bg-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div
              className="absolute inset-0 transition-transform duration-75"
              style={{ transform: `translate(${shakeX}px, ${shakeY}px) scale(${flash > 0 ? 1.01 : 1})` }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(255,255,255,0.12),_rgba(255,255,255,0)_28%)]" />
              <div className="absolute left-[8%] top-[10%] h-24 w-24 rounded-full bg-yellow-300/30 blur-3xl sm:h-36 sm:w-36" />
              <div className="absolute right-[6%] top-[18%] h-20 w-20 rounded-full bg-fuchsia-400/20 blur-3xl sm:h-28 sm:w-28" />

              <div className="absolute inset-x-[10%] bottom-0 top-[12%] rounded-t-[42px] border-x border-t border-white/10 bg-gradient-to-b from-slate-800/70 to-slate-950/95">
                <div className="absolute inset-x-0 top-[7%] flex justify-around px-[8%] text-[10px] font-semibold uppercase tracking-[0.3em] text-white/35 sm:text-xs">
                  {laneGuide.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>

                <div className="absolute inset-x-[4%] bottom-[8%] top-[18%] rounded-[34px] bg-[linear-gradient(180deg,_#334155_0%,_#111827_100%)] shadow-inner">
                  <div className="absolute inset-0">
                    {[0, 1, 2, 3, 4, 5].map((line) => (
                      <div
                        key={line}
                        className="absolute left-1/2 h-[13%] w-[1.3%] -translate-x-1/2 rounded-full bg-white/80"
                        style={{ top: `${line * 16 + ((distance * 2.2) % 16)}%`, opacity: 1 - line * 0.12 }}
                      />
                    ))}
                    <div className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
                  </div>

                  {obstacles.map((obstacle) => {
                    const scale = clamp(1.32 - obstacle.z, 0.18, 1.15);
                    const y = 78 - (1 - obstacle.z) * 50;
                    const x = LANES_X[obstacle.lane] * 100;
                    const isLow = obstacle.kind === "banana" || obstacle.kind === "desk";
                    const icon = obstacle.kind === "teacher" ? "🧑‍🏫" : obstacle.kind === "desk" ? "🪑" : obstacle.kind === "prefect" ? "🫡" : "🍌";
                    return (
                      <div
                        key={obstacle.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform"
                        style={{
                          left: `${x}%`,
                          top: `${y}%`,
                          transform: `translate(-50%, -50%) scale(${scale})`,
                          opacity: clamp(scale + 0.1, 0.2, 1),
                          zIndex: Math.floor((1 - obstacle.z) * 100),
                        }}
                      >
                        <div
                          className={`flex items-center justify-center rounded-[22px] border border-white/15 bg-gradient-to-br ${obstacle.hue} shadow-xl`}
                          style={{
                            width: `${obstacle.width + scale * 8}px`,
                            height: `${obstacle.height + scale * 10}px`,
                            marginTop: isLow ? "18px" : "0",
                          }}
                        >
                          <span className="text-lg drop-shadow sm:text-2xl">{icon}</span>
                        </div>
                      </div>
                    );
                  })}

                  <div
                    className="absolute -translate-x-1/2 transition-all duration-100"
                    style={{
                      left: `${LANES_X[player.lane] * 100}%`,
                      bottom: `${10 + player.y * 0.55}%`,
                      opacity: player.blink > 0 ? 0.45 : 1,
                    }}
                  >
                    <div className="relative flex flex-col items-center">
                      <div className="absolute top-[78%] h-4 w-12 rounded-full bg-black/30 blur-md" />
                      <div className={`text-5xl transition-transform duration-100 ${player.ducking > 0 ? "scale-x-110 scale-y-75" : player.jumping ? "-rotate-12" : ""}`}>
                        🧑‍🎓
                      </div>
                      <div className="mt-1 rounded-full bg-cyan-300/20 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-100">
                        You
                      </div>
                    </div>
                  </div>

                  {particles.map((particle) => (
                    <div
                      key={particle.id}
                      className="absolute rounded-full"
                      style={{
                        left: `${particle.x}%`,
                        top: `${particle.y}%`,
                        width: `${particle.size}px`,
                        height: `${particle.size}px`,
                        background: particle.color,
                        opacity: particle.life / particle.maxLife,
                        boxShadow: `0 0 18px ${particle.color}`,
                        transform: `translate(-50%, -50%) scale(${particle.life / particle.maxLife})`,
                      }}
                    />
                  ))}
                </div>
              </div>

              {flash > 0 ? (
                <div
                  className="pointer-events-none absolute inset-0 bg-yellow-200"
                  style={{ opacity: flash * 0.22 }}
                />
              ) : null}
            </div>

            <div className="absolute left-3 top-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/80 shadow-lg backdrop-blur sm:left-5 sm:top-5 sm:text-sm">
              <div className="font-semibold text-white">Controls</div>
              <div>← → move · ↑ jump · ↓ duck · P pause</div>
            </div>

            <div className="absolute inset-x-3 bottom-3 grid grid-cols-4 gap-2 sm:hidden">
              <TouchButton label="←" onTap={() => moveLane(-1)} />
              <TouchButton label="→" onTap={() => moveLane(1)} />
              <TouchButton label="⤴" onTap={jump} />
              <TouchButton label="⤵" onTap={duck} />
            </div>

            <div
              className="absolute inset-0"
              onTouchStart={(e) => {
                const touch = e.touches[0];
                touchStartRef.current = { x: touch.clientX, y: touch.clientY };
              }}
              onTouchEnd={(e) => {
                if (!touchStartRef.current || puzzle) return;
                const touch = e.changedTouches[0];
                const dx = touch.clientX - touchStartRef.current.x;
                const dy = touch.clientY - touchStartRef.current.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                  if (dx > 28) moveLane(1);
                  if (dx < -28) moveLane(-1);
                } else {
                  if (dy < -26) jump();
                  if (dy > 26) duck();
                }
                touchStartRef.current = null;
              }}
            />

            {gameState !== "playing" || puzzle ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/52 p-4 backdrop-blur-sm">
                {puzzle ? (
                  <div className="w-full max-w-md rounded-[28px] border border-emerald-300/20 bg-slate-950/90 p-5 text-center shadow-2xl">
                    <p className="text-xs font-bold uppercase tracking-[0.45em] text-emerald-300">Funny Puzzle</p>
                    <h2 className="mt-2 text-3xl font-black">{puzzle.prompt}</h2>
                    <p className="mt-2 text-sm text-white/70">{puzzle.hint}</p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-400 transition-all"
                        style={{ width: `${(puzzleTimerRef.current / puzzle.timer) * 100}%` }}
                      />
                    </div>
                    <input
                      autoFocus
                      value={puzzleInput}
                      onChange={(e) => setPuzzleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          resolvePuzzle(puzzleInput.trim().toLowerCase() === puzzle.answer.trim().toLowerCase());
                        }
                      }}
                      className="mt-4 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center text-lg font-bold outline-none ring-0 placeholder:text-white/25 focus:border-cyan-300/50"
                      placeholder="Type answer..."
                    />
                    {puzzle.options ? (
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {puzzle.options.map((option) => (
                          <button
                            key={option}
                            onClick={() => {
                              setPuzzleInput(option);
                              resolvePuzzle(option === puzzle.answer);
                            }}
                            className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold uppercase tracking-[0.22em] text-white transition hover:scale-105 hover:bg-white/20"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <OverlayCard
                    title={gameState === "start" ? "Proxy deke nikal!" : gameState === "paused" ? "Attendance hold" : "Caught by staff!"}
                    subtitle={
                      gameState === "start"
                        ? "Dodge teachers, jump desks, duck prefects, solve stupidly funny puzzles, and escape school in style."
                        : gameState === "paused"
                          ? "Take a breath. Bell bajte hi continue."
                          : "One more run. First 10 seconds mein hi maza aa jayega."
                    }
                    actionLabel={gameState === "paused" ? "Resume" : "Start Escape"}
                    secondaryLabel={gameState === "gameover" ? "Restart now" : "Tap / swipe / arrow keys"}
                    onAction={() => {
                      if (gameState === "paused") setGameState("playing");
                      else startGame();
                    }}
                  >
                    <div className="grid gap-3 text-left sm:grid-cols-3">
                      <Feature emoji="🏃" title="Tight controls" text="Instant lane swap, quick jump, fast duck." />
                      <Feature emoji="🧩" title="Funny puzzles" text="Solve mini school nonsense for juicy score boosts." />
                      <Feature emoji="✨" title="Juicy feedback" text="Particles, flash, shake, combo pops, big vibes." />
                    </div>
                  </OverlayCard>
                )}
              </div>
            ) : null}
          </section>

          <aside className="flex flex-col gap-4">
            <Panel title="Mission Feed" accent="from-cyan-300 to-blue-500">
              <p className="text-sm leading-6 text-white/80">{message}</p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
                Bonus tip: low obstacles = <span className="font-bold text-yellow-300">jump</span>, tall staff = <span className="font-bold text-fuchsia-300">duck</span>.
              </div>
            </Panel>

            <Panel title="High Scores" accent="from-yellow-300 to-orange-500">
              <div className="space-y-2">
                {highScores.length ? (
                  highScores.map((entry, index) => (
                    <div key={`${entry.stamp}-${index}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      <span className="font-bold text-white/90">#{index + 1} {entry.name}</span>
                      <span className="text-yellow-300">{entry.score}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-white/60">No escapes yet. Be the first legend.</p>
                )}
              </div>
            </Panel>

            <Panel title="Quick Rules" accent="from-fuchsia-300 to-pink-500">
              <ul className="space-y-2 text-sm text-white/75">
                <li>• Desks & bananas ke upar se jump.</li>
                <li>• Teachers & prefects ke neeche duck.</li>
                <li>• Puzzle solve = fat bonus + combo boost.</li>
                <li>• Enter = instant restart after game over.</li>
              </ul>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, glow }: { label: string; value: string | number; glow: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 shadow-lg backdrop-blur">
      <div className="text-[10px] uppercase tracking-[0.35em] text-white/50">{label}</div>
      <div className={`bg-gradient-to-r ${glow} bg-clip-text text-lg font-black text-transparent sm:text-xl`}>
        {value}
      </div>
    </div>
  );
}

function Panel({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/10 p-4 shadow-2xl backdrop-blur-xl">
      <h3 className={`bg-gradient-to-r ${accent} bg-clip-text text-lg font-black text-transparent`}>{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function OverlayCard({
  title,
  subtitle,
  actionLabel,
  secondaryLabel,
  onAction,
  children,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  secondaryLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-3xl rounded-[32px] border border-white/10 bg-slate-950/88 p-5 shadow-2xl sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.5em] text-cyan-300">Browser game</p>
      <h2 className="mt-2 text-4xl font-black sm:text-6xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          onClick={onAction}
          className="rounded-full bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 px-6 py-3 text-sm font-black uppercase tracking-[0.3em] text-slate-950 transition hover:scale-105"
        >
          {actionLabel}
        </button>
        <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/70">
          {secondaryLabel}
        </div>
      </div>
    </div>
  );
}

function Feature({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <div className="text-3xl">{emoji}</div>
      <h4 className="mt-3 text-lg font-black">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-white/65">{text}</p>
    </div>
  );
}

function LauncherMenu({
  bestScore,
  highScores,
  onPlay,
}: {
  bestScore: number;
  highScores: HighScoreEntry[];
  onPlay: () => void;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#140f24] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.22),_transparent_28%),linear-gradient(180deg,_#2a1c55_0%,_#120d20_48%,_#09070f_100%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="absolute left-[10%] top-[12%] h-40 w-40 rounded-full bg-yellow-300/20 blur-3xl" />
      <div className="absolute right-[8%] top-[24%] h-44 w-44 rounded-full bg-fuchsia-400/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.5em] text-yellow-200/80">Browser game</p>
        <h1 className="mt-3 text-5xl font-black leading-[1.05] sm:text-7xl">
          <span className="bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 bg-clip-text text-transparent">
            Escape School
          </span>
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/70 sm:text-base">
          Mass bunk runner with chaos puzzles. Dodge teachers, jump desks, duck prefects, and sprint to the gate before assembly starts.
        </p>

        <div className="mt-6 flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm shadow-lg backdrop-blur">
          <span className="uppercase tracking-[0.3em] text-white/50">Best</span>
          <span className="bg-gradient-to-r from-yellow-300 to-orange-500 bg-clip-text text-xl font-black text-transparent">
            {bestScore}
          </span>
        </div>

        <button
          onClick={onPlay}
          className="mt-8 rounded-full bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 px-10 py-4 text-base font-black uppercase tracking-[0.35em] text-slate-950 shadow-[0_20px_60px_rgba(251,146,60,0.35)] transition hover:scale-105"
        >
          Play
        </button>
        <p className="mt-3 text-xs uppercase tracking-[0.3em] text-white/45">Press Enter to start</p>

        <div className="mt-10 grid w-full gap-3 text-left sm:grid-cols-2">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 backdrop-blur">
            <h3 className="bg-gradient-to-r from-cyan-300 to-blue-500 bg-clip-text text-base font-black text-transparent">
              How to play
            </h3>
            <ul className="mt-3 space-y-1.5 text-sm text-white/75">
              <li>← → swap lanes</li>
              <li>↑ / Space jump over low stuff</li>
              <li>↓ duck under tall staff</li>
              <li>Solve puzzles for bonus score</li>
              <li>Mobile: swipe or tap the buttons</li>
            </ul>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 backdrop-blur">
            <h3 className="bg-gradient-to-r from-yellow-300 to-orange-500 bg-clip-text text-base font-black text-transparent">
              High scores
            </h3>
            <div className="mt-3 space-y-2">
              {highScores.length ? (
                highScores.map((entry, index) => (
                  <div
                    key={`${entry.stamp}-${index}`}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  >
                    <span className="font-bold text-white/90">
                      #{index + 1} {entry.name}
                    </span>
                    <span className="text-yellow-300">{entry.score}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/60">No escapes yet. Be the first legend.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TouchButton({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button
      onTouchStart={(e) => {
        e.preventDefault();
        onTap();
      }}
      onClick={onTap}
      className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-2xl font-black shadow-lg backdrop-blur"
    >
      {label}
    </button>
  );
}
