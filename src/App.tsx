import React, { useState, useEffect, useRef } from "react";
import { AgentRun, ContractChunk } from "./types";
import { LiveTracePanel } from "./components/LiveTracePanel";
import { RightPanel } from "./components/RightPanel";
import { 
  Terminal, 
  Cpu, 
  Play, 
  Send, 
  AlertCircle, 
  Shield, 
  Database, 
  ServerCrash,
  Sparkles,
  RefreshCw,
  Clock
} from "lucide-react";

export default function App() {
  const [presetScenarios, setPresetScenarios] = useState<any[]>([]);
  const [contracts, setContracts] = useState<ContractChunk[]>([]);
  const [history, setHistory] = useState<AgentRun[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [activeTab, setActiveTab] = useState<string>("hitl");
  
  // Custom Advisory Text input
  const [customInputText, setCustomInputText] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  // Live timer state for overall system monitoring
  const [utcTime, setUtcTime] = useState("");

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sync current timestamp
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setUtcTime(d.toISOString().replace("Z", " UTC"));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch initial system presets
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const scRes = await fetch("/api/scenarios");
      const scData = await scRes.json();
      setPresetScenarios(scData);

      const conRes = await fetch("/api/contracts");
      const conData = await conRes.json();
      setContracts(conData);

      const histRes = await fetch("/api/history");
      const histData = await histRes.json();
      setHistory(histData);
    } catch (err) {
      console.error("Express data retrieval endpoint error:", err);
    }
  };

  // Check and poll active run simulation loop
  useEffect(() => {
    const checkActiveRun = async () => {
      try {
        const res = await fetch("/api/active-run");
        const active = await res.json();
        setActiveRun(active);

        if (active) {
          // If active run is actively running in backend, start polling loop
          if (active.status === "running") {
            startPolling();
          } else {
            stopPolling();
            // Refresh history list upon termination
            const histRes = await fetch("/api/history");
            const histData = await histRes.json();
            setHistory(histData);
          }
        } else {
          stopPolling();
        }
      } catch (err) {
        console.error("Active run status check failed:", err);
      }
    };

    checkActiveRun();
    return () => stopPolling();
  }, []);

  const startPolling = () => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/active-run");
        const active = await res.json();
        setActiveRun(active);

        if (!active || active.status === "completed" || active.status === "failed") {
          stopPolling();
          const histRes = await fetch("/api/history");
          const histData = await histRes.json();
          setHistory(histData);
        }
      } catch (err) {
        console.error("Polling error caught, skipping tick", err);
      }
    }, 600);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  // Launch pre-packaged scenarios
  const handleLaunchScenario = async (scenarioId: string) => {
    setIsLaunching(true);
    try {
      stopPolling();
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId })
      });
      const data = await res.json();
      setActiveRun(data);
      setActiveTab("hitl");
      startPolling();
    } catch (err) {
      console.error("Failed to launch simulation", err);
    } finally {
      setIsLaunching(false);
    }
  };

  // Custom Advisory Prompt submission
  const handleLaunchCustomText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInputText.trim()) return;

    // Client-side verification for exact "Alert:" trigger string pattern match
    if (!customInputText.toLowerCase().includes("alert:")) {
      setCustomError("Trigger Missing: Custom supply chain input alerts must explicitly include the trigger prefix 'Alert:' (e.g. 'Alert: Chennai Port lockout ...') to be recognized by the LangGraph parser pipeline.");
      return;
    }

    setCustomError(null);
    setIsLaunching(true);
    try {
      stopPolling();
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: "custom",
          customInput: customInputText
        })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Launch failed");
      }
      const data = await res.json();
      setActiveRun(data);
      setActiveTab("hitl");
      setCustomInputText("");
      startPolling();
    } catch (err: any) {
      console.error("Custom advisory launch failed", err);
      setCustomError(err.message || "Custom advisory launch execution failed.");
    } finally {
      setIsLaunching(false);
    }
  };

  // MITL decision endpoints trigger
  const handleSupervisorDecision = async (decision: "APPROVE" | "DENY" | "REQUEST_MORE_INFO") => {
    try {
      const res = await fetch("/api/active-run/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision })
      });
      const data = await res.json();
      setActiveRun(data || null);
      startPolling();
    } catch (err) {
      console.error("Failed to submit supervisor signature", err);
    }
  };

  // Loop circuit breaker demo trigger
  const handleSimulateLoopBug = async () => {
    try {
      stopPolling();
      const res = await fetch("/api/simulate-loop-bug", { method: "POST" });
      const data = await res.json();
      setActiveRun(data);
      setActiveTab("otel");
      startPolling();
    } catch (err) {
      console.error("Loop bug launcher failure", err);
    }
  };

  // Clear traces entries
  const handleClearLogs = async () => {
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      const data = await res.json();
      setHistory(data.history);
      setActiveRun(null);
      stopPolling();
    } catch (err) {
      console.error("Failure cleaning history metrics", err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-gray-100 flex flex-col font-sans selection:bg-orange-500/30 selection:text-orange-200">
      
      {/* Dynamic Upper Monitor Bar */}
      <header className="bg-[#111114] border-b border-white/10 py-4 px-6 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 bg-gradient-to-tr from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-lg shadow-orange-500/10">
              <Shield className="w-5 h-5 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white leading-none">
                  SupplyGuard AI
                </h1>
                <span className="bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[9px] font-mono tracking-widest px-1.5 py-0.5 rounded font-bold uppercase leading-none">
                  DeployFest Build
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                LangGraph Logistics Security & Real-Time RAG Grounding Agent
              </p>
            </div>
          </div>

          {/* System Telemetry Badges */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="bg-[#151518] border border-white/5 px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono">
              <span className="text-gray-500">Live Time:</span>
              <span className="text-gray-300 font-semibold">{utcTime}</span>
            </div>

            <div className="bg-[#151518] border border-white/5 px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono">
              <Database className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-gray-500">RAG Embedding:</span>
              <span className="text-orange-400 font-semibold">Ready</span>
            </div>

            <div className="bg-[#151518] border border-white/5 px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono">
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${activeRun?.status === "running" ? "animate-spin" : ""}`} />
              <span className="text-gray-500">System State:</span>
              <span className="text-emerald-400 font-bold">Optimal</span>
            </div>
          </div>

        </div>
      </header>

      {/* Primary Dashboard Content Panel */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 flex flex-col gap-6 overflow-hidden">
        
        {/* Row 1: Quick Scenario Launcher & Dynamic Alert Generator */}
        <section className="bg-[#151518] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4" id="section-control-deck">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-500 flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-orange-500" />
              Incidents & Advisories Control Deck
            </span>
            <span className="text-[11px] font-mono text-white/40">
              Demo Scenarios (Touch to trigger sequential agent nodes)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {(presetScenarios || []).map((sc) => (
              <button
                key={sc.id}
                onClick={() => handleLaunchScenario(sc.id)}
                disabled={activeRun?.status === "running"}
                className={`p-3.5 rounded-lg border text-left flex flex-col justify-between min-h-[10rem] h-auto pb-4 transition-all group cursor-pointer ${
                  activeRun?.scenarioId === sc.id
                    ? "border-orange-500 bg-orange-500/5 shadow-[0_4px_12px_rgba(245,158,11,0.05)]"
                    : "border-white/5 bg-[#111114] hover:bg-[#1A1A1F] disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
                id={`btn-launch-${sc.id}`}
              >
                <div className="space-y-1">
                  <span className="text-[10px] font-mono font-semibold uppercase text-white/40 tracking-wider">
                    {sc.id === "scenario-a" && "Scenario A (Critical Approval)"}
                    {sc.id === "scenario-b" && "Scenario B (Denial Escalates)"}
                    {sc.id === "scenario-c" && "Scenario C (Fog Auto-Recover)"}
                    {sc.id === "scenario-d" && "Scenario D (Alternate Lock)"}
                  </span>
                  <p className="text-xs font-semibold text-white/85 leading-relaxed mt-1">
                    {sc.input}
                  </p>
                </div>
                
                <span className="text-[11px] font-bold text-orange-400 mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all font-mono">
                  <span>Launch Simulation</span>
                  <span>→</span>
                </span>
              </button>
            ))}
          </div>

          <hr className="border-white/10" />

          {customError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs py-3 px-4 rounded-lg flex items-start gap-2.5 animate-fade-in" id="custom-alert-error-box">
              <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold uppercase tracking-wider text-[10px] block mb-0.5">Execution Interrupted</span>
                <span>{customError}</span>
              </div>
            </div>
          )}

          {/* Dynamic alerts custom form (Pillar 1/2 real LLM verification) */}
          <form onSubmit={handleLaunchCustomText} className="flex flex-col sm:flex-row items-stretch gap-3">
            <div className="relative flex-1">
              <Terminal className="absolute top-3.5 left-3.5 w-4 h-4 text-white/30 whitespace-pre" />
              <input
                type="text"
                placeholder="Write custom supply chain disruption alert ((Start with Alert: )(e.g., Alert:'Port of Chennai lockout starting June 12, estimated 5-day delay...'))"
                className="w-full bg-[#0A0A0B] border border-white/10 focus:border-orange-500 text-xs text-white outline-none rounded-lg py-3 b-0 focus:ring-1 focus:ring-orange-500 pl-11 pr-4 transition-all"
                value={customInputText}
                onChange={(e) => {
                  setCustomInputText(e.target.value);
                  setCustomError(null);
                }}
                disabled={activeRun?.status === "running" || isLaunching}
                id="input-custom-advisory"
              />
            </div>
            <button
              type="submit"
              disabled={activeRun?.status === "running" || isLaunching || !customInputText.trim()}
              className="px-5 py-3 bg-orange-500 hover:bg-orange-400 disabled:bg-white/5 disabled:text-white/20 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-2 transition-all shadow-[0_4px_12px_rgba(245,158,11,0.1)] shrink-0 cursor-pointer"
              id="btn-submit-custom"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit to Gemini Agent</span>
            </button>
          </form>
        </section>

        {/* Row 2: Double Grid Core Monitor Panels */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
          {/* LEFT: Live Workflow progression tree */}
          <div className="lg:col-span-12 xl:col-span-5 h-[580px]">
            <LiveTracePanel activeRun={activeRun} history={history} />
          </div>

          {/* RIGHT: Operational Workspace (Auth metrics, Grounding RAG corpus, spans) */}
          <div className="lg:col-span-12 xl:col-span-7 h-[580px]">
            <RightPanel
              activeRun={activeRun}
              contracts={contracts}
              history={history}
              onDecision={handleSupervisorDecision}
              onSimulateLoopBug={handleSimulateLoopBug}
              onClearLogs={handleClearLogs}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          </div>
        </section>

      </main>

      {/* Global Bottom Banner */}
      <footer className="bg-[#111114] border-t border-white/10 py-3 text-center text-[10px] text-white/30 font-mono tracking-widest uppercase mt-auto">
        SupplyGuard AI Portal (Node Engine & OpenTelemetry Integrator v3.1.2)
      </footer>

    </div>
  );
}
