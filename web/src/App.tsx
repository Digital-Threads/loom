import { useMemo, useState } from "react";
import { createClient } from "./api";
import { Sidebar } from "./components/Sidebar";
import { Board } from "./components/Board";
import { TaskView } from "./components/TaskView";

const SECTION_TITLES: Record<string, string> = {
  board: "Доска",
  accounts: "Аккаунты",
  connectors: "Коннекторы (MCP)",
  skills: "Скилы",
  layers: "Слои",
  timeline: "Таймлайн",
  settings: "Настройки",
};

export function App() {
  const client = useMemo(() => createClient(), []);
  const [view, setView] = useState<string>("board");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  const inTask = taskId !== null;

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
                ‹ Доска
              </span>
            </h1>
          ) : (
            <h1>{SECTION_TITLES[view] ?? view}</h1>
          )}
          {inTask ? <span className="crumb">  {taskId}</span> : <span className="crumb" />}
          {view === "board" && !inTask ? (
            <div className="right">
              <button className="btn acc">+ Новая</button>
            </div>
          ) : null}
        </header>
        <div className="content">
          {inTask ? (
            <TaskView client={client} taskId={taskId} />
          ) : view === "board" ? (
            <Board client={client} onOpen={setTaskId} />
          ) : (
            <div className="empty">Раздел «{SECTION_TITLES[view] ?? view}» — скоро.</div>
          )}
        </div>
      </div>
    </div>
  );
}
