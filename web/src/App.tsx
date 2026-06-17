import { useEffect, useMemo, useState } from "react";
import { createClient, type ProjectEntry } from "./api";
import { Sidebar } from "./components/Sidebar";
import { Board } from "./components/Board";
import { TaskView } from "./components/TaskView";
import { NewTaskModal } from "./components/NewTaskModal";
import { Accounts } from "./components/Accounts";
import { Tokens } from "./components/Tokens";
import { Memory } from "./components/Memory";
import { Projects } from "./components/Projects";
import { Timeline } from "./components/Timeline";
import { Knowledge } from "./components/Knowledge";
import { Layers } from "./components/Layers";
import { Skills } from "./components/Skills";
import { Settings } from "./components/Settings";
import { Connectors } from "./components/Connectors";
import { Security } from "./components/Security";
import { Quality } from "./components/Quality";
import { Swarm } from "./components/Swarm";
import { Onboarding } from "./components/Onboarding";
import { Toaster } from "./components/Toaster";

const SECTION_TITLES: Record<string, string> = {
  board: "Board",
  projects: "Projects",
  accounts: "Accounts",
  tokens: "Tokens",
  memory: "Memory",
  security: "Security",
  quality: "Quality",
  swarm: "Swarm",
  connectors: "Connectors (MCP)",
  knowledge: "Knowledge",
  skills: "Skills",
  layers: "Layers",
  timeline: "Timeline",
  settings: "Settings",
};

// One-line "what is this" per section, shown under the title so a screen reads
// as intentional instead of a bare table.
const SECTION_DESC: Record<string, string> = {
  board: "Tasks as pipeline stages — drag a card onto a column to run that stage.",
  projects: "Repositories Loom works in — tasks and token usage per project.",
  accounts: "aimux subscriptions, sessions and health.",
  tokens: "token-pilot usage — tokens spent and saved per session.",
  memory: "task-journal reasoning — decisions, findings and rejections per task.",
  security: "Песочница для агента — worktree-изоляция, политика команд, скан секретов, аудит.",
  quality: "AI-ревью кода (self/ralph/adversarial) + прогон проверок.",
  swarm: "Координатор мульти-агента — несколько агентов на одну задачу.",
  connectors: "MCP servers passed into agent sessions — add, enable, test.",
  knowledge: "Recall prior reasoning across projects — what was decided or rejected.",
  skills: "Библиотека скиллов из ~/.claude/skills — открывай, правь, создавай новые через AI.",
  layers: "Архитектура Loom: standalone-пакеты (aimux/token-pilot/task-journal/security/quality/swarm) + inline-модули в core/*.",
  timeline: "Event stream, board totals and agent performance.",
  settings: "Loom configuration.",
};

export function App() {
  const client = useMemo(() => createClient(), []);
  const [view, setView] = useState<string>("board");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [reload, setReload] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [onboard, setOnboard] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [boardProject, setBoardProject] = useState<string>(""); // "" = all projects

  useEffect(() => {
    client.projects().then((d) => { setOnboard(d.projects.length === 0); setProjects(d.projects); }).catch(() => setOnboard(false));
  }, [client, reload]);

  const inTask = taskId !== null;

  if (onboard) {
    return (
      <div className="app">
        <div className="main"><div className="content">
          <Onboarding client={client} onDone={() => { setOnboard(false); setReload((r) => r + 1); }} />
        </div></div>
      </div>
    );
  }

  function nav(v: string) {
    setView(v);
    setTaskId(null);
    setDrawer(false);
  }

  return (
    <div className="app">
      <Sidebar client={client} view={inTask ? "" : view} onNav={nav} open={drawer} />
      <div className="main">
        <header className="top">
          <button className="burger" aria-label="Toggle menu" aria-expanded={drawer} onClick={() => setDrawer((d) => !d)}>
            ☰
          </button>
          {inTask ? (
            <h1>
              <span style={{ cursor: "pointer", color: "var(--mut)" }} onClick={() => setTaskId(null)}>
                ‹ Board
              </span>
            </h1>
          ) : (
            <div className="page-title">
              <h1>{SECTION_TITLES[view] ?? view}</h1>
              {SECTION_DESC[view] ? <span className="page-sub">{SECTION_DESC[view]}</span> : null}
            </div>
          )}
          {inTask ? <span className="crumb">  {taskId}</span> : <span className="crumb" />}
          {view === "board" && !inTask ? (
            <div className="right">
              {projects.length > 1 ? (
                <select className="inp" value={boardProject} onChange={(e) => setBoardProject(e.target.value)} title="Filter the board by project">
                  <option value="">All projects</option>
                  {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
                </select>
              ) : null}
              <button className="btn acc" onClick={() => setShowNew(true)}>+ New</button>
            </div>
          ) : null}
        </header>
        <div className="content">
          {inTask ? (
            <TaskView
              key={`${taskId}:${reload}`}
              client={client}
              taskId={taskId}
              onChanged={() => setReload((r) => r + 1)}
            />
          ) : view === "board" ? (
            <Board key={reload} client={client} onOpen={setTaskId} projects={projects} projectFilter={boardProject} />
          ) : view === "projects" ? (
            <Projects client={client} onSwitched={() => setReload((r) => r + 1)} />
          ) : view === "accounts" ? (
            <Accounts client={client} />
          ) : view === "tokens" ? (
            <Tokens client={client} />
          ) : view === "memory" ? (
            <Memory client={client} />
          ) : view === "timeline" ? (
            <Timeline client={client} />
          ) : view === "knowledge" ? (
            <Knowledge client={client} />
          ) : view === "layers" ? (
            <Layers client={client} />
          ) : view === "skills" ? (
            <Skills client={client} />
          ) : view === "settings" ? (
            <Settings client={client} />
          ) : view === "connectors" ? (
            <Connectors client={client} />
          ) : view === "security" ? (
            <Security client={client} />
          ) : view === "quality" ? (
            <Quality client={client} />
          ) : view === "swarm" ? (
            <Swarm client={client} />
          ) : (
            <div className="empty">Section “{SECTION_TITLES[view] ?? view}” — coming soon.</div>
          )}
        </div>
      </div>

      {showNew ? (
        <NewTaskModal
          client={client}
          defaultProjectId={boardProject || undefined}
          onClose={() => setShowNew(false)}
          onCreated={() => setReload((r) => r + 1)}
        />
      ) : null}
      <Toaster />
    </div>
  );
}
