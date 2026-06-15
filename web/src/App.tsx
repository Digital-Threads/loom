import { useEffect, useMemo, useState } from "react";
import { createClient } from "./api";
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
import { Onboarding } from "./components/Onboarding";
import { Toaster } from "./components/Toaster";

const SECTION_TITLES: Record<string, string> = {
  board: "Board",
  projects: "Projects",
  accounts: "Accounts",
  tokens: "Tokens",
  memory: "Memory",
  connectors: "Connectors (MCP)",
  knowledge: "Knowledge",
  skills: "Skills",
  layers: "Layers",
  timeline: "Timeline",
  settings: "Settings",
};

export function App() {
  const client = useMemo(() => createClient(), []);
  const [view, setView] = useState<string>("board");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [reload, setReload] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [onboard, setOnboard] = useState<boolean | null>(null);

  useEffect(() => {
    client.projects().then((d) => setOnboard(d.projects.length === 0)).catch(() => setOnboard(false));
  }, [client]);

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
          <button className="burger" onClick={() => setDrawer((d) => !d)}>
            ☰
          </button>
          {inTask ? (
            <h1>
              <span style={{ cursor: "pointer", color: "var(--mut)" }} onClick={() => setTaskId(null)}>
                ‹ Board
              </span>
            </h1>
          ) : (
            <h1>{SECTION_TITLES[view] ?? view}</h1>
          )}
          {inTask ? <span className="crumb">  {taskId}</span> : <span className="crumb" />}
          {view === "board" && !inTask ? (
            <div className="right">
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
            <Board key={reload} client={client} onOpen={setTaskId} />
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
          ) : (
            <div className="empty">Section “{SECTION_TITLES[view] ?? view}” — coming soon.</div>
          )}
        </div>
      </div>

      {showNew ? (
        <NewTaskModal
          client={client}
          onClose={() => setShowNew(false)}
          onCreated={() => setReload((r) => r + 1)}
        />
      ) : null}
      <Toaster />
    </div>
  );
}
