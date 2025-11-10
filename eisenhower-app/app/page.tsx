"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

type Urgency = "urgent" | "not-urgent";
type Importance = "important" | "not-important";

type QuadrantKey = "do" | "schedule" | "delegate" | "eliminate";

interface Task {
  id: string;
  title: string;
  notes?: string;
  urgency: Urgency;
  importance: Importance;
  createdAt: string;
  completed: boolean;
}

interface KCSChunk {
  id: string;
  content: string;
  metadata: {
    index: number;
    tokenEstimate: number;
    wordCount: number;
    topicHint: string;
  };
}

const quadrantMap: Record<QuadrantKey, { title: string; description: string; color: string }> = {
  do: {
    title: "Do First",
    description: "Critical and urgent — ship immediately.",
    color: "from-rose-500/90 to-rose-400/80",
  },
  schedule: {
    title: "Schedule",
    description: "Important but calm — plan deliberate focus blocks.",
    color: "from-amber-500/90 to-amber-400/80",
  },
  delegate: {
    title: "Delegate",
    description: "Urgent but light — hand off with clear expectations.",
    color: "from-emerald-500/90 to-emerald-400/80",
  },
  eliminate: {
    title: "Defer / Eliminate",
    description: "Noise — decline, delete, or archive for later.",
    color: "from-sky-500/90 to-sky-400/80",
  },
};

const quadrantFor = (urgency: Urgency, importance: Importance): QuadrantKey => {
  if (urgency === "urgent" && importance === "important") return "do";
  if (urgency === "not-urgent" && importance === "important") return "schedule";
  if (urgency === "urgent" && importance === "not-important") return "delegate";
  return "eliminate";
};

const markdownFromRaw = (text: string): string => {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n");
  let inBlock = false;
  const converted = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        inBlock = false;
        return "";
      }
      if (/^#+\s/.test(trimmed)) {
        inBlock = false;
        return trimmed;
      }
      if (/^[-*]\s/.test(trimmed)) {
        inBlock = false;
        return trimmed;
      }
      if (/:\s*$/.test(trimmed)) {
        inBlock = false;
        return `## ${trimmed.replace(/:\s*$/, "")}`;
      }
      if (!inBlock) {
        inBlock = true;
        return `- ${trimmed}`;
      }
      return `  - ${trimmed}`;
    })
    .join("\n");
  return converted;
};

const chunkKcs = (text: string, chunkSize = 700): KCSChunk[] => {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const sentences = normalized
    .split(/(?<=[.?!])\s+(?=[A-Z0-9])/)
    .flatMap((sentence) => sentence.split("\n").map((part) => part.trim()).filter(Boolean));

  const chunks: KCSChunk[] = [];
  let buffer = "";

  const flushBuffer = () => {
    const content = buffer.trim();
    if (!content) return;
    const words = content.split(/\s+/);
    const topicHint = content.slice(0, 90).split(/[.!?]/)[0]?.trim() ?? content.slice(0, 60);
    chunks.push({
      id: `kcs-${chunks.length + 1}`,
      content,
      metadata: {
        index: chunks.length,
        tokenEstimate: Math.ceil(content.length / 4),
        wordCount: words.length,
        topicHint,
      },
    });
    buffer = "";
  };

  for (const sentence of sentences) {
    const prospective = buffer ? `${buffer} ${sentence}` : sentence;
    if (prospective.length > chunkSize && buffer) {
      flushBuffer();
    }
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }

  flushBuffer();
  return chunks;
};

const loadFromStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const persistToStorage = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

export default function Home() {
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [taskUrgency, setTaskUrgency] = useState<Urgency>("urgent");
  const [taskImportance, setTaskImportance] = useState<Importance>("important");
  const [tasks, setTasks] = useState<Task[]>(() => loadFromStorage<Task[]>("eisenhower.tasks", []));
  const [irRaw, setIrRaw] = useState(() => loadFromStorage<string>("ai.ir", ""));
  const [kcsRaw, setKcsRaw] = useState(() => loadFromStorage<string>("ai.kcs", ""));
  const [kcsFormat, setKcsFormat] = useState<"json" | "jsonl">(() =>
    loadFromStorage<"json" | "jsonl">("ai.kcs.format", "json"),
  );

  useEffect(() => {
    persistToStorage("eisenhower.tasks", tasks);
  }, [tasks]);

  useEffect(() => {
    persistToStorage("ai.ir", irRaw);
  }, [irRaw]);

  useEffect(() => {
    persistToStorage("ai.kcs", kcsRaw);
  }, [kcsRaw]);

  useEffect(() => {
    persistToStorage("ai.kcs.format", kcsFormat);
  }, [kcsFormat]);

  const handleAddTask = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!taskTitle.trim()) return;
      setTasks((prev) => [
        {
          id: crypto.randomUUID(),
          title: taskTitle.trim(),
          notes: taskNotes.trim() || undefined,
          urgency: taskUrgency,
          importance: taskImportance,
          createdAt: new Date().toISOString(),
          completed: false,
        },
        ...prev,
      ]);
      setTaskTitle("");
      setTaskNotes("");
    },
    [taskImportance, taskNotes, taskTitle, taskUrgency],
  );

  const toggleTaskComplete = useCallback((id: string) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)));
  }, []);

  const promoteTask = useCallback((id: string, direction: "importance" | "urgency") => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;
        if (direction === "importance") {
          return {
            ...task,
            importance: task.importance === "important" ? "not-important" : "important",
          };
        }
        return {
          ...task,
          urgency: task.urgency === "urgent" ? "not-urgent" : "urgent",
        };
      }),
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  const quadrants = useMemo(() => {
    const grouped: Record<QuadrantKey, Task[]> = {
      do: [],
      schedule: [],
      delegate: [],
      eliminate: [],
    };
    tasks.forEach((task) => {
      const key = quadrantFor(task.urgency, task.importance);
      grouped[key].push(task);
    });
    return grouped;
  }, [tasks]);

  const irMarkdown = useMemo(() => markdownFromRaw(irRaw), [irRaw]);
  const kcsChunks = useMemo(() => chunkKcs(kcsRaw), [kcsRaw]);

  const handleIrUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setIrRaw(text);
      event.target.value = "";
    });
  }, []);

  const handleKcsUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setKcsRaw(text);
      event.target.value = "";
    });
  }, []);

  const downloadFile = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleIrExport = useCallback(() => {
    if (!irMarkdown) return;
    downloadFile("instructional-ruleset.md", irMarkdown);
  }, [downloadFile, irMarkdown]);

  const handleKcsExport = useCallback(() => {
    if (!kcsChunks.length) return;
    if (kcsFormat === "json") {
      downloadFile("knowledge-compendium.json", JSON.stringify(kcsChunks, null, 2));
      return;
    }
    const jsonl = kcsChunks.map((chunk) => JSON.stringify(chunk)).join("\n");
    downloadFile("knowledge-compendium.jsonl", jsonl);
  }, [downloadFile, kcsChunks, kcsFormat]);

  return (
    <div className="min-h-screen bg-slate-950 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 py-10 text-slate-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pb-16 lg:flex-row">
        <section className="flex w-full flex-1 flex-col gap-6">
          <header className="rounded-3xl border border-slate-800/80 bg-slate-900/60 p-8 shadow-2xl shadow-cyan-500/10 backdrop-blur">
            <h1 className="text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
              Eisenhower Matrix Task Navigator
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-300">
              Capture tasks, classify by urgency and importance, and let the matrix drive your focus. Promote, reframe, or
              mark tasks complete without ever leaving the board.
            </p>
          </header>

          <form
            onSubmit={handleAddTask}
            className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/40"
          >
            <h2 className="text-lg font-semibold text-slate-100">Fast Task Intake</h2>
            <p className="mt-1 text-xs text-slate-400">
              Drop a task and tune urgency/importance toggles — we&apos;ll park it in the right quadrant instantly.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Task name</span>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                  placeholder="Ship Gemini blueprint to leadership..."
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Context &amp; notes</span>
                <textarea
                  className="min-h-[90px] rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                  placeholder="Key outcomes, owners, constraints, follow-ups..."
                  value={taskNotes}
                  onChange={(event) => setTaskNotes(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-200">Urgency heuristic</span>
                <div className="flex gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                  <button
                    type="button"
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      taskUrgency === "urgent"
                        ? "bg-rose-500 text-white shadow-lg shadow-rose-500/40"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                    }`}
                    onClick={() => setTaskUrgency("urgent")}
                  >
                    Urgent
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      taskUrgency === "not-urgent"
                        ? "bg-slate-700 text-white shadow-lg shadow-slate-700/40"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                    }`}
                    onClick={() => setTaskUrgency("not-urgent")}
                  >
                    Not Urgent
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-200">Importance heuristic</span>
                <div className="flex gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                  <button
                    type="button"
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      taskImportance === "important"
                        ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                    }`}
                    onClick={() => setTaskImportance("important")}
                  >
                    Important
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      taskImportance === "not-important"
                        ? "bg-slate-700 text-white shadow-lg shadow-slate-700/40"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                    }`}
                    onClick={() => setTaskImportance("not-important")}
                  >
                    Not Important
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-900"
              >
                Capture Task
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/40">
            <header className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-slate-100">Eisenhower Focus Matrix</h2>
              <p className="text-xs text-slate-400">
                Vertical board, four mission blocks. We paint each quadrant with urgency/importance energy.
              </p>
            </header>
            <div className="mt-6 flex flex-col gap-5 lg:flex-row">
              <div className="mx-auto w-full max-w-xl rounded-3xl border border-slate-800/80 bg-slate-950/70 p-4 shadow-inner">
                <div className="grid min-h-[520px] grid-rows-4 gap-3">
                  {(["do", "schedule", "delegate", "eliminate"] as QuadrantKey[]).map((key) => {
                    const quadrant = quadrantMap[key];
                    const quadrantTasks = quadrants[key];
                    return (
                      <div
                        key={key}
                        className={`rounded-2xl border border-slate-800/50 bg-gradient-to-br ${quadrant.color} p-4 shadow-lg shadow-black/30`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-white">{quadrant.title}</h3>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-white/70">
                              {key === "do" ? "urgent · important" : key === "schedule" ? "steady · important" : key === "delegate" ? "urgent · support" : "low impact"}
                            </p>
                          </div>
                          <span className="rounded-full bg-black/20 px-2 py-[2px] text-[11px] font-semibold text-white">
                            {quadrantTasks.length}
                          </span>
                        </div>
                        <div className="mt-4 space-y-3">
                          {quadrantTasks.length === 0 && (
                            <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/70">
                              Nothing queued. Keep it intentional.
                            </div>
                          )}
                          {quadrantTasks.map((task) => (
                            <article
                              key={task.id}
                              className={`group rounded-xl border border-white/25 bg-white/15 p-3 text-slate-900 shadow ${task.completed ? "bg-white/30 ring-2 ring-white/50" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h4
                                    className={`text-sm font-semibold text-slate-900 ${
                                      task.completed ? "line-through decoration-slate-500" : ""
                                    }`}
                                  >
                                    {task.title}
                                  </h4>
                                  {task.notes && <p className="mt-1 text-xs text-slate-800/80">{task.notes}</p>}
                                </div>
                                <button
                                  onClick={() => removeTask(task.id)}
                                  className="rounded-md bg-black/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-900/80 transition hover:bg-black/25"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-900">
                                <button
                                  onClick={() => toggleTaskComplete(task.id)}
                                  className="rounded-md bg-white/50 px-2 py-1 transition hover:bg-white"
                                >
                                  {task.completed ? "Restore" : "Complete"}
                                </button>
                                <button
                                  onClick={() => promoteTask(task.id, "importance")}
                                  className="rounded-md bg-white/30 px-2 py-1 transition hover:bg-white/60"
                                >
                                  {task.importance === "important" ? "Downgrade" : "Promote"} Importance
                                </button>
                                <button
                                  onClick={() => promoteTask(task.id, "urgency")}
                                  className="rounded-md bg-white/30 px-2 py-1 transition hover:bg-white/60"
                                >
                                  {task.urgency === "urgent" ? "Ease Urgency" : "Activate Urgency"}
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <aside className="flex flex-1 flex-col gap-4">
                <div className="rounded-2xl border border-slate-800/40 bg-slate-950/70 p-4 shadow-inner">
                  <h3 className="text-sm font-semibold text-slate-100">Flow Prompts</h3>
                  <p className="mt-2 text-xs text-slate-300">
                    Quickly drop task phrases here to reuse, tag, or brainstorm before locking them into a quadrant.
                  </p>
                  <textarea
                    className="mt-3 min-h-[160px] w-full rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                    placeholder="Write quick task fragments, reminders, or backlog seeds..."
                  />
                </div>
                <div className="rounded-2xl border border-slate-800/40 bg-slate-950/80 p-4 shadow-inner">
                  <h3 className="text-sm font-semibold text-slate-100">Daily Highlights</h3>
                  <ul className="mt-2 space-y-2 text-xs text-slate-300">
                    <li>• Sweep Do First quadrant every morning.</li>
                    <li>• Reserve calendar blocks for Schedule items.</li>
                    <li>• Share Delegated tasks with explicit owners.</li>
                    <li>• Prune Eliminate to protect attention.</li>
                  </ul>
                </div>
              </aside>
            </div>
          </section>
        </section>

        <section className="flex w-full flex-1 flex-col gap-6">
          <div className="rounded-3xl border border-cyan-500/40 bg-cyan-500/10 p-6 shadow-[0_0_50px_-20px_rgba(16,185,129,0.6)] backdrop-blur">
            <h2 className="text-xl font-semibold text-cyan-100">Gemini / Custom GPT Blueprint Studio</h2>
            <p className="mt-2 text-xs text-cyan-100/70">
              Capture the Instructional Ruleset persona and the Knowledge Compendium Synthesis. Markdown conversion for IR,
              chunk mapping + JSON export for KCS.
            </p>
          </div>

          <section className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40">
            <header className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold text-slate-100">Instructional Ruleset (IR)</h3>
              <p className="text-xs text-slate-400">
                Raw text funnels straight into Markdown. Drop persona directives, tone instructions, guardrails, and export
                the markdown-ready blueprint.
              </p>
            </header>
            <div className="mt-4 flex flex-col gap-3">
              <textarea
                className="min-h-[180px] w-full rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                placeholder="Define agent voice, behavioral rails, safety scaffolding, escalation rules..."
                value={irRaw}
                onChange={(event) => setIrRaw(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="file"
                    accept=".txt,.md,.markdown"
                    onChange={handleIrUpload}
                    className="text-xs"
                  />
                  Import IR file
                </label>
                <button
                  onClick={handleIrExport}
                  disabled={!irMarkdown}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/40 disabled:text-emerald-200/60"
                >
                  Export Markdown
                </button>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4">
              <h4 className="text-sm font-semibold text-emerald-100">Markdown Preview</h4>
              <pre className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-emerald-50">
                {irMarkdown || "Markdown preview will render here when you start typing rules."}
              </pre>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40">
            <header className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold text-slate-100">Knowledge Compendium Synthesis (KCS)</h3>
              <p className="text-xs text-slate-400">
                Store research corpus, facts, and exemplars. We chunk, map metadata, and let you export JSON or JSONL for
                ingestion pipelines.
              </p>
            </header>
            <div className="mt-4 flex flex-col gap-3">
              <textarea
                className="min-h-[220px] w-full rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                placeholder="Paste compendium knowledge, transcripts, snippets, frameworks..."
                value={kcsRaw}
                onChange={(event) => setKcsRaw(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <label className="flex items-center gap-2">
                  <input type="file" accept=".txt,.md,.json" onChange={handleKcsUpload} className="text-xs" />
                  Import KCS file
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/70 px-3 py-2">
                  <span className="text-[11px] uppercase tracking-widest text-slate-400">Export as</span>
                  <button
                    type="button"
                    onClick={() => setKcsFormat("json")}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                      kcsFormat === "json"
                        ? "bg-cyan-500 text-slate-950 shadow shadow-cyan-500/50"
                        : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setKcsFormat("jsonl")}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                      kcsFormat === "jsonl"
                        ? "bg-cyan-500 text-slate-950 shadow shadow-cyan-500/50"
                        : "bg-slate-800 text-slate-200"
                    }`}
                  >
                    JSONL
                  </button>
                </div>
                <button
                  onClick={handleKcsExport}
                  disabled={!kcsChunks.length}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-cyan-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-cyan-500/40 disabled:text-cyan-200/60"
                >
                  Export Compendium
                </button>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-cyan-100">Chunk &amp; Metadata Map</h4>
                <span className="rounded-full bg-cyan-500/20 px-2 py-1 text-[11px] font-semibold text-cyan-100">
                  {kcsChunks.length} chunks
                </span>
              </div>
              <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                {kcsChunks.length === 0 && (
                  <p className="text-xs text-cyan-100/70">Start typing to see metadata slices of your knowledge base.</p>
                )}
                {kcsChunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 p-3 text-xs text-cyan-50"
                  >
                    <p className="font-semibold uppercase tracking-widest text-cyan-100/80">Chunk {chunk.metadata.index + 1}</p>
                    <p className="mt-1 text-[11px] text-cyan-100/70">
                      {chunk.metadata.wordCount} words · ~{chunk.metadata.tokenEstimate} tokens · Topic hint:{" "}
                      <span className="font-medium text-cyan-100">{chunk.metadata.topicHint}</span>
                    </p>
                    <p className="mt-2 text-xs text-cyan-50/90">{chunk.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
