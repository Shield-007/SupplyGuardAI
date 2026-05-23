import React, { useState } from "react";
import { 
  AgentRun, 
  ContractChunk, 
  AlternativeCarrier, 
  AlternativePort, 
  AlternativeSupplier,
  TelemetrySpan
} from "../types";
import { 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  Activity, 
  Clock, 
  HelpCircle, 
  Check, 
  X, 
  Search, 
  ChevronRight, 
  Flame, 
  RefreshCw,
  Cpu,
  CornerDownRight,
  Sparkles,
  Link
} from "lucide-react";
import { PortRoutingMap } from "./PortRoutingMap";

interface RightPanelProps {
  activeRun: AgentRun | null;
  contracts: ContractChunk[];
  history: AgentRun[];
  onDecision: (decision: "APPROVE" | "DENY" | "REQUEST_MORE_INFO") => void;
  onSimulateLoopBug: () => void;
  onClearLogs: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function RightPanel({
  activeRun,
  contracts,
  history,
  onDecision,
  onSimulateLoopBug,
  onClearLogs,
  activeTab,
  setActiveTab
}: RightPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSpan, setSelectedSpan] = useState<TelemetrySpan | null>(null);

  // Filtered contracts for RAG browser
  const filteredContracts = contracts.filter(
    (c) =>
      c.docName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.section.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.clauseId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helpers to fetch information from the active run state
  const isPaused = activeRun?.status === "paused";
  const scoreData = activeRun?.score;
  const eventData = activeRun?.event;
  const lastHistoryRun = history && Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null;
  const displayRun = activeRun || lastHistoryRun;

  // Retrieve details parsed during assess_blast_radius (node 2)
  const assessNode = activeRun?.nodes?.find(n => n.id === "assess_blast_radius");
  const affectedShipmentsCount = assessNode?.output?.shipments?.length || 12;
  const financialExposureHourlyUsd = assessNode?.output?.dependencies?.estimatedExposurePerHourUsd || 8400;
  const assemblyLinesCount = assessNode?.output?.dependencies?.assemblyLinesAtRisk?.length || 2;
  const shipmentsList = Array.isArray(assessNode?.output?.shipments) ? assessNode.output.shipments : [];
  const SLA_Breach_Hours = shipmentsList.length > 0 
    ? Math.min(...shipmentsList.map((s: any) => typeof s.daysUntilSlaBreach === "number" ? s.daysUntilSlaBreach * 24 : 19)) 
    : 19;

  return (
    <div className="flex flex-col h-full bg-[#151518] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
      {/* Tab select header */}
      <div className="flex border-b border-white/10 bg-[#111114]">
        <button
          onClick={() => setActiveTab("hitl")}
          className={`flex-1 py-3 px-4 text-xs font-semibold tracking-wider uppercase border-b-2 transition-all flex items-center justify-center gap-2 ${
            activeTab === "hitl"
              ? "border-orange-500 text-orange-400 bg-[#151518]"
              : "border-transparent text-white/40 hover:text-white/80 hover:bg-[#1C1C21]/50"
          }`}
          id="tab-hitl-auth"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>HITL Auth Workspace</span>
          {isPaused && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("rag")}
          className={`flex-1 py-3 px-4 text-xs font-semibold tracking-wider uppercase border-b-2 transition-all flex items-center justify-center gap-2 ${
            activeTab === "rag"
              ? "border-orange-500 text-orange-400 bg-[#151518]"
              : "border-transparent text-white/40 hover:text-white/80 hover:bg-[#1C1C21]/50"
          }`}
          id="tab-rag-grounding"
        >
          <FileText className="w-4 h-4" />
          <span>RAG Contracts ({contracts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("otel")}
          className={`flex-1 py-3 px-4 text-xs font-semibold tracking-wider uppercase border-b-2 transition-all flex items-center justify-center gap-2 ${
            activeTab === "otel"
              ? "border-orange-500 text-orange-400 bg-[#151518]"
              : "border-transparent text-white/40 hover:text-white/80 hover:bg-[#1C1C21]/50"
          }`}
          id="tab-otel-telemetry"
        >
          <Activity className="w-4 h-4" />
          <span>OTel Telemetry API</span>
        </button>
      </div>

      {/* Main tab body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        
        {/* TAB 1: HUMAN IN THE LOOP (HITL) */}
        {activeTab === "hitl" && (
          <div className="space-y-6 animate-fade-in" id="workspace-hitl">
            {isPaused ? (
              // Active Glowing Authorization Card on ESCALATE state
              <div className="border border-red-500/30 bg-[#1C1C21] rounded-2xl shadow-2xl overflow-hidden" id="hitl-authorizer">
                {/* Card Header matching custom Sophisticated Dark HTML exactly */}
                <div className="bg-red-500/10 p-5 border-b border-red-500/20 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-red-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold tracking-tight text-white uppercase">RECOVERY PLAN REQUIRES APPROVAL</h3>
                    <p className="text-[10px] text-red-500 uppercase font-mono font-bold tracking-widest mt-0.5">Impact Score: {scoreData?.score || 75}/100 (CRITICAL)</p>
                  </div>
                </div>

                {/* Card Body content */}
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="bg-[#151518] border border-white/5 p-3 rounded-lg space-y-1">
                      <span className="text-white/40 font-semibold uppercase text-[9px] tracking-wider block">Disruption Scenario</span>
                      <strong className="text-white/90 text-xs">
                        {eventData?.eventType || "Port Strike"} ({activeRun.customInput ? "Custom Text Input" : "5 Days Est."})
                      </strong>
                    </div>

                    <div className="bg-[#151518] border border-white/5 p-3 rounded-lg space-y-1">
                      <span className="text-white/40 font-semibold uppercase text-[9px] tracking-wider block">Impact Score Rating</span>
                      <strong className="text-red-400 text-xs font-mono flex items-center gap-1">
                        {scoreData?.score || 75}/100 CRITICAL
                      </strong>
                    </div>

                    <div className="bg-[#151518] border border-white/5 p-3 rounded-lg space-y-1">
                      <span className="text-white/40 font-semibold uppercase text-[9px] tracking-wider block">Affected Shipments</span>
                      <strong className="text-white/90 text-sm font-mono">{affectedShipmentsCount} containers</strong>
                    </div>

                    <div className="bg-[#151518] border border-white/5 p-3 rounded-lg space-y-1">
                      <span className="text-white/40 font-semibold uppercase text-[9px] tracking-wider block">Jeopardy Loss Rate</span>
                      <strong className="text-red-400 text-sm font-mono">${financialExposureHourlyUsd.toLocaleString()}/hour</strong>
                    </div>
                  </div>

                  <div className="bg-orange-500/5 border border-orange-500/20 p-4 rounded-xl text-xs">
                    <label className="text-[10px] uppercase text-orange-400/80 font-bold block mb-1.5 underline decoration-orange-500/40 tracking-wider">SLA RISK ASSESSMENT</label>
                    <p className="text-white/90">Breach imminent in <span className="font-mono font-bold text-orange-400">{SLA_Breach_Hours} hours</span>.</p>
                    <p className="text-[10px] text-white/50 italic font-serif mt-1">Source: AutoAssembly Plant 3 - Section 2.1 (Penalty triggers after 24h delay)</p>
                  </div>

                  {/* Score Flags lists */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block">
                      Trigger Flags & Contract Grounding Citations
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {(scoreData?.flags || []).map((flag, idx) => (
                        <div key={idx} className="bg-black/30 border border-white/5 p-2 rounded text-[11px] flex items-start gap-2">
                          <span className="bg-red-500/10 text-red-400 border border-red-500/20 rounded h-5 w-6 flex items-center justify-center shrink-0 font-bold text-[10px]">
                            +{flag.score}
                          </span>
                          <div className="space-y-0.5">
                            <p className="text-white/80">{flag.reason}</p>
                            <span className="font-mono text-[9px] text-orange-400/80 block">
                              Source Reference Index: {flag.source}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Live Google Maps Routing Visualization */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block">
                      Live Port Routing Discovery (Google Maps API)
                    </span>
                    <div className="h-[260px] rounded-xl overflow-hidden border border-white/10 shadow-lg">
                      <PortRoutingMap affectedPortName={eventData?.affectedPort || "Chennai"} />
                    </div>
                  </div>

                  {/* Recommended Auto-Compiled Action layout styling */}
                  <div className="space-y-2.5">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block">Recommended Recovery Actions</span>
                    <ul className="space-y-2.5">
                      <li className="flex items-start gap-3 bg-white/5 p-3 rounded-lg border border-white/10">
                        <span className="text-emerald-500 mt-1">●</span>
                        <div className="text-xs">
                          <span className="font-semibold text-white/90">Reroute via Kattupalli Port</span>
                          <p className="text-[11px] text-white/40 mt-0.5">Compliance Reference: GlobalParts_v3.2.pdf, Appendix B (Approved Port)</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3 bg-white/5 p-3 rounded-lg border border-white/10">
                        <span className="text-emerald-500 mt-1">●</span>
                        <div className="text-xs">
                          <span className="font-semibold text-white/90">Substitute Supplier: FastParts Vietnam</span>
                          <p className="text-[11px] text-white/40 mt-0.5">Lead Time: +2 Days | Ref: FPV-2024-09 | Cost Delta: +$1,200/unit</p>
                        </div>
                      </li>
                    </ul>
                  </div>

                  {/* Action Buttons styled like Sophisticated Dark card blocks */}
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <button
                      onClick={() => onDecision("APPROVE")}
                      className="py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg shadow-emerald-900/20 cursor-pointer text-center"
                      id="btn-hitl-approve"
                    >
                      APPROVE PLAN
                    </button>
                    <button
                      onClick={() => onDecision("DENY")}
                      className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl transition-all cursor-pointer text-center"
                      id="btn-hitl-deny"
                    >
                      DENY
                    </button>
                    <button
                      onClick={() => onDecision("REQUEST_MORE_INFO")}
                      className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-[11px] font-bold rounded-xl transition-all uppercase tracking-tighter cursor-pointer text-center"
                      id="btn-hitl-info"
                    >
                      Request Info
                    </button>
                  </div>
                </div>
              </div>
            ) : activeRun && activeRun.status === "running" ? (
              // When agent is walking through previous steps
              <div className="border border-white/10 bg-[#1C1C21]/80 rounded-xl p-8 text-center space-y-4">
                <div className="inline-flex relative">
                  <div className="w-12 h-12 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"></div>
                  <Cpu className="w-5 h-5 text-orange-400 absolute top-3.5 left-3.5 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-orange-400">Agent Running Sequentially</p>
                  <p className="text-xs text-white/40 max-w-xs mx-auto">
                    Computing blast radius, query formulas, and validating contract terms synchronously...
                  </p>
                </div>
              </div>
            ) : activeRun?.status === "completed" || history.find(r => r.id === activeRun?.id)?.status === "completed" ? (
              // Output display of completed automatic or approved runs
              <div className="space-y-4 animate-fade-in">
                <div className="border border-emerald-500/20 bg-emerald-500/10 p-4 rounded-xl flex items-start gap-3">
                  <div className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-400">
                    <Check className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-emerald-400 uppercase">Recovery Executed Successfully</h4>
                    <p className="text-xs text-white/50">
                      Rerouting commands, booking schedules, and purchase order modifications completed.
                    </p>
                  </div>
                </div>

                {/* Google Maps Executed Route Display */}
                <div className="border border-white/10 bg-[#1C1C21] p-4 rounded-xl space-y-2.5">
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block">
                    Executed Routing Corridor Map (Google Maps API)
                  </span>
                  <div className="h-[210px] rounded-lg overflow-hidden border border-white/5">
                    <PortRoutingMap affectedPortName={displayRun?.event?.affectedPort || "Chennai"} />
                  </div>
                </div>

                <div className="border border-white/10 bg-[#1C1C21] p-4 rounded-xl space-y-3 font-mono text-xs">
                  <div className="border-b border-white/5 pb-2 text-[10px] uppercase font-bold text-white/40 flex items-center justify-between">
                    <span>MOCK API SECURE TRANSACTIONS WORKFLOW</span>
                    <span className="text-emerald-400">● LIVE</span>
                  </div>
                  
                  {/* Carriers reroute entries */}
                  <div className="space-y-2">
                    <span className="text-[10px] text-orange-400 block font-semibold uppercase">Rerouted Carrier Cargo Booking:</span>
                    <div className="space-y-1.5">
                      {displayRun?.recoveryActions?.rerouteConfirmations && displayRun.recoveryActions.rerouteConfirmations.length > 0 ? (
                        displayRun.recoveryActions.rerouteConfirmations.map((conf: any, idx: number) => (
                          <div key={idx} className="bg-black/30 p-2.5 border border-white/5 rounded space-y-1 text-[11px]">
                            <span className="text-white/40">Shipment: <strong className="text-white/80">{conf.shipmentId}</strong></span>
                            <div className="text-white/80 flex justify-between gap-2">
                              <span>New Gateway: {conf.newRoute}</span>
                              <span className="text-emerald-400 shrink-0">{conf.confirmationId} ({conf.newCarrier})</span>
                            </div>
                            <div className="text-white/30 flex justify-between text-[10px]">
                              <span>ETD: {conf.newEtd}</span>
                              <span>Cost Delta: +${conf.costDeltaUsd?.toLocaleString()} USD</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="bg-black/20 p-2.5 border border-white/5 rounded text-white/40 text-[11px] italic">
                          No cargo booking adjustments requested for this run.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* PO Substitutions */}
                  <div className="space-y-2">
                    <span className="text-[10px] text-orange-400 block font-semibold uppercase">Purchase Order Substitution:</span>
                    <div className="space-y-1.5">
                      {displayRun?.recoveryActions?.poUpdates && displayRun.recoveryActions.poUpdates.length > 0 ? (
                        displayRun.recoveryActions.poUpdates.map((po: any, idx: number) => (
                          <div key={idx} className="bg-black/30 p-2.5 border border-white/5 rounded space-y-1 text-[11px]">
                            <span className="text-white/40">SKU Ref: <strong className="text-white/80">{po.productSku}</strong> (PO: {po.poId})</span>
                            <div className="text-white/80 flex justify-between">
                              <span>Supplier: {po.newSupplierId}</span>
                              <span className="text-emerald-400 font-mono">{po.updateId}</span>
                            </div>
                            <span className="text-white/30 block text-[10px]">Contractual reference index: {po.reference} applied</span>
                          </div>
                        ))
                      ) : (
                        <div className="bg-black/20 p-2.5 border border-white/5 rounded text-white/40 text-[11px] italic">
                          No supplier purchase order substitutions required.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Stakeholders alerts */}
                  <div className="space-y-2">
                    <span className="text-[10px] text-orange-400 block font-semibold uppercase">Slack / Email Alert Integration:</span>
                    <div className="space-y-1.5">
                      {displayRun?.recoveryActions?.notificationsSent && displayRun.recoveryActions.notificationsSent.length > 0 ? (
                        displayRun.recoveryActions.notificationsSent.map((notif: any, idx: number) => (
                          <div key={idx} className="bg-black/30 p-2.5 border border-white/5 rounded text-white/50 text-[11px] flex justify-between items-center">
                            <span>Plant: <strong className="text-white/80">{notif.plant}</strong></span>
                            <span className="text-emerald-400 font-mono text-[10px] uppercase font-bold">{notif.alertLevel}</span>
                          </div>
                        ))
                      ) : (
                        <div className="bg-black/30 p-2.5 border border-white/5 rounded text-white/50 text-[11px]">
                          Teams channel <strong className="text-white/80">#SupplyLogistics</strong> notified (Alert Level: Yellow - Delays Cleared).
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : activeRun?.status === "failed" || lastHistoryRun?.status === "failed" ? (
              // Aborted document output
              <div className="space-y-4 animate-fade-in">
                <div className="border border-rose-500/30 bg-rose-950/25 p-4 rounded-xl flex items-start gap-3">
                  <div className="p-1.5 bg-rose-500/20 rounded-lg text-rose-400">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-rose-450 uppercase text-rose-400">Incident Aborted & Escalated</h4>
                    <p className="text-xs text-white/50">
                      Rerouting bypassed. A manual negotiation summary has been logged and sent to teams.
                    </p>
                  </div>
                </div>

                {/* Escalation Markdown Preview */}
                <div className="border border-white/10 bg-black/40 p-4 rounded-xl text-xs space-y-3 font-mono text-white/80 overflow-y-auto max-h-96">
                  <div className="flex items-center justify-between text-[10px] border-b border-white/5 pb-2 text-white/30">
                    <span>LATEST LOCAL REPORT RECORD (JSONL)</span>
                    <span className="text-red-400">● ABORT_TRACE</span>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-white/70">
                    {activeRun?.escalationReport || (lastHistoryRun?.escalationReport) || "Compiling error records..."}
                  </pre>
                </div>
              </div>
            ) : (
              // Idle state when nothing executes
              <div className="border border-white/10 bg-black/30 rounded-xl p-8 text-center space-y-4">
                <Cpu className="w-10 h-10 text-white/15 mx-auto animate-pulse" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white/50">No Advisory Active</p>
                  <p className="text-xs text-white/30 max-w-xs mx-auto">
                    Select a core scenario card above, or click simulated loop parameters to start the state progression stream.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RAG CONTRACTS ENCYCLOPEDIA (Pillar 2) */}
        {activeTab === "rag" && (
          <div className="space-y-4 animate-fade-in" id="workspace-rag">
            {/* Search filter bar */}
            <div className="relative">
              <Search className="absolute top-2.5 left-3 w-4 h-4 text-white/30" />
              <input
                type="text"
                placeholder="Search grounded vendor contracts & Appendix list..."
                className="w-full bg-[#0A0A0B] border border-white/10 focus:border-orange-500 text-xs rounded-lg py-2.5 pl-9 pr-4 text-white hover:border-white/20 outline-none transition-all focus:ring-1 focus:ring-orange-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                id="search-rag"
              />
            </div>

            {/* Simulated index metrics */}
            <div className="grid grid-cols-2 gap-2 text-[11px] bg-black/40 p-3 rounded-lg border border-white/5 font-mono text-white/50">
              <div>Store State: <span className="text-orange-400 font-bold">ChromaDB Node Cache</span></div>
              <div>Retrieval Model: <span className="text-orange-400 font-bold">text-embedding-004</span></div>
              <div>Total Chunks: <span className="text-white/80 font-bold">5 segments</span></div>
              <div>Simulate Status: <span className="text-emerald-400 font-bold">Fully Grounded</span></div>
            </div>

            {/* Document list render */}
            <div className="space-y-3.5 max-h-[480px] overflow-y-auto pr-1">
              {filteredContracts.map((chunk, idx) => (
                <div key={idx} className="bg-[#1C1C21]/60 border border-white/5 rounded-lg p-3.5 space-y-2 hover:border-orange-500/30 transition-all font-sans">
                  {" "}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-400">
                      <FileText className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                      <span className="truncate max-w-[200px]">{chunk.docName}</span>
                    </div>
                    <span className="bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-mono font-semibold px-2 py-0.5 rounded">
                      {chunk.clauseId}
                    </span>
                  </div>

                  <span className="text-[10px] font-semibold tracking-wider text-white/40 block uppercase">
                    {chunk.section}
                  </span>

                  <p className="text-xs text-white/80 leading-relaxed font-sans bg-black/30 p-3 rounded-lg border border-white/5">
                    {chunk.content}
                  </p>
                </div>
              ))}

              {filteredContracts.length === 0 && (
                <p className="text-xs text-center text-white/30 py-6">No grounding matches found.</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: OPENTELEMETRY TRACES ENGINE (Pillar 3) */}
        {activeTab === "otel" && (
          <div className="space-y-4 animate-fade-in" id="workspace-otel">
            
            {/* Core simulation stats */}
            <div className="bg-[#111114] border border-white/10 rounded-xl p-4 space-y-3">
              <span className="text-xs font-bold text-orange-400 flex items-center gap-1.5 uppercase tracking-wider">
                <Activity className="w-4 h-4 text-orange-500" />
                Live Otel Latency & Span Tracing Panel
              </span>
              <p className="text-xs text-white/50 leading-relaxed">
                SupplyGuard AI creates complete tracing telemetry logs. Every node entry, database look, decision, and tool latency produces standard OpenTelemetry attributes.
              </p>

              {/* Loop mitigation warning trigger */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <button
                  onClick={onSimulateLoopBug}
                  className="flex-1 py-2 px-3 bg-red-950/20 hover:bg-red-900/20 text-red-400 border border-red-500/20 text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
                  id="btn-trigger-loop-bug"
                >
                  <Flame className="w-3.5 h-3.5 animate-pulse text-red-500" />
                  <span>Validate Infinite Loop Safety Circuit</span>
                </button>
                <button
                  onClick={onClearLogs}
                  className="py-2 px-3 bg-[#1C1C21] hover:bg-white/5 text-white/60 border border-white/10 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  id="btn-clear-trace-logs"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset All</span>
                </button>
              </div>
            </div>

            {/* active run telemetrys or history traces */}
            {activeRun ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs px-1 font-mono">
                  <span className="text-white/40">Active Trace Span Count: <strong className="text-white/80">{(activeRun.spans || []).length} spans</strong></span>
                  <span className="text-xs text-orange-400 font-bold">{activeRun.scenarioName}</span>
                </div>

                <div className="border border-white/10 bg-black/40 rounded-lg overflow-y-auto max-h-[340px] p-3 space-y-2">
                  {/* Global Root trace details */}
                  <div className="p-2 border border-white/5 bg-[#1C1C21]/40 rounded flex items-center justify-between text-xs font-mono">
                    <span className="text-orange-400 truncate">ROOT::SupplyGuard_Sim_Engine</span>
                    <span className="text-white/30 text-[11px]">Duration: ~4.2s</span>
                  </div>

                  {(activeRun.spans || []).map((span, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => setSelectedSpan(span)}
                      className={`p-2.5 border rounded cursor-pointer transition-all font-mono text-[11px] space-y-1.5 ${
                        selectedSpan?.id === span.id 
                          ? "border-emerald-500 bg-emerald-950/25" 
                          : span.status === "error"
                            ? "border-red-500/40 bg-red-950/10 hover:bg-red-950/20"
                            : "border-white/5 bg-black/40 hover:bg-[#1C1C21]/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-white/80 truncate pr-2">
                          <CornerDownRight className="w-3.5 h-3.5 text-white/30 shrink-0" />
                          <span className="truncate">{span.name}</span>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                          span.status === "error" 
                            ? "bg-red-500/20 text-red-400" 
                            : span.status === "paused"
                              ? "bg-red-500/20 text-red-400 animate-pulse"
                              : "bg-emerald-500/10 text-emerald-400"
                        }`}>
                          {span.durationMs !== undefined ? `${span.durationMs}ms` : span.status}
                        </span>
                      </div>
                      
                      {/* Condensed helper metadata */}
                      <span className="text-[9px] text-white/30 block uppercase tracking-wider">
                        TYPE: {span.type} | START: {span.startTime.substring(11, 19)}
                      </span>
                    </div>
                  ))}

                  {(activeRun.spans || []).length === 0 && (
                    <div className="text-center py-8">
                      <Clock className="w-8 h-8 text-white/10 mx-auto animate-spin" />
                      <p className="text-[11px] text-white/30 mt-2">Awaiting agent step entries...</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // If idle, show generic history logs telemetry block
              <div className="space-y-3">
                <span className="text-xs text-white/40 px-1 block font-mono">Historic Telemetry Log Traces</span>
                <div className="border border-white/10 bg-black/40 rounded-lg p-3 space-y-2">
                  {(history || []).map((h, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-white/5 pb-2.5 last:border-0 last:pb-0 text-xs font-mono">
                      <div className="space-y-1">
                        <span className="text-orange-400 block truncate max-w-[200px]">{h.scenarioName}</span>
                        <span className="text-[10px] text-white/30 block">ID: {h.id} | Spans: {(h.spans || []).length}</span>
                      </div>
                      <div className="text-right space-y-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${
                          h.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}>
                          {h.status.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-white/30 block">~{(h.endTime ? (new Date(h.endTime).getTime() - new Date(h.startTime).getTime()) / 1000 : 4.5).toFixed(1)}s</span>
                      </div>
                    </div>
                  ))}
                  {(!history || history.length === 0) && (
                    <p className="text-xs text-center text-white/30 py-4 font-sans">No historic execution logs available yet.</p>
                  )}
                </div>
              </div>
            )}

            {/* Trace detail modal viewer inline */}
            {selectedSpan && (
              <div className="bg-black/60 border border-white/10 rounded-lg p-4 space-y-3 animate-fade-in font-mono text-[11px]">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-orange-400 text-xs font-bold leading-none">{selectedSpan.name}</span>
                  <button onClick={() => setSelectedSpan(null)} className="text-white/40 hover:text-white/80 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-white/50">
                  <span>SPAN ID:</span> <span className="text-white/80">{selectedSpan.id}</span>
                  <span>CATEGORY:</span> <span className="text-white/80 uppercase">{selectedSpan.type}</span>
                  <span>STATUS:</span> <span className="text-white/80 uppercase">{selectedSpan.status}</span>
                  <span>DURATION:</span> <span className="text-white/80 font-bold">{selectedSpan.durationMs} milliseconds</span>
                </div>
                <div className="space-y-1 font-sans">
                  <span className="text-white/40 font-bold uppercase text-[10px] tracking-wider block">Attributes Logged :</span>
                  <pre className="p-2.5 bg-black/60 border border-white/5 rounded-lg text-white/85 overflow-x-auto text-[10px] leading-relaxed font-mono">
                    {JSON.stringify(selectedSpan.attributes, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Persistent Bottom Trace Link Bar */}
      <div className="border-t border-white/10 bg-[#0A0A0B] py-3.5 px-4 flex items-center justify-between text-xs text-white/40 font-mono">
        <div className="flex items-center gap-1.5">
          <Link className="w-3.5 h-3.5 text-orange-500" />
          <span>Observability Link: </span>
          <a
            href="https://langfuse.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:underline font-bold flex items-center gap-0.5"
          >
            <span>Langfuse Console Log</span>
            <ChevronRight className="w-3 h-3 inline" />
          </a>
        </div>
        <span className="text-[10px] text-white/30">DeployFest Demo Tool</span>
      </div>

    </div>
  );
}
