export interface DisruptionEvent {
  eventType: string;
  affectedPort: string;
  affectedRegion: string;
  severity: "low" | "medium" | "high" | "critical";
  estimatedDurationDays: number;
  impactedShipmentIds: string[];
}

export interface Shipment {
  shipmentId: string;
  orderValue: number;
  destinationPlant: string;
  daysUntilSlaBreach: number;
  productSku: string;
}

export interface DownstreamDependency {
  assemblyLinesAtRisk: string[];
  productsBlocked: string[];
  estimatedExposurePerHourUsd: number;
}

export interface ContractChunk {
  docName: string;
  section: string;
  clauseId: string;
  content: string;
  score?: number; // Simulated relevance score
}

export interface AlternativeCarrier {
  name: string;
  transitDays: number;
  costUsd: number;
  reliabilityScore: number; // 0-100
  availability: string; // "High", "Medium", "Low", "None"
}

export interface AlternativePort {
  code: string;
  status: "open" | "congested" | "closed";
  averageDelayDays: number;
  lastUpdated: string;
}

export interface AlternativeSupplier {
  name: string;
  country: string;
  leadTimeDays: number;
  unitCost: number;
  isContractApproved: boolean;
  sku: string;
}

export interface ScoreFlag {
  score: number;
  reason: string;
  source: string;
}

export interface ImpactScore {
  score: number;
  action: "AUTO_RECOVER" | "ESCALATE";
  flags: ScoreFlag[];
}

export type AgentNodeId =
  | "parse_disruption_event"
  | "assess_blast_radius"
  | "rag_contract_lookup"
  | "find_alternatives"
  | "impact_scorer"
  | "human_review"
  | "execute_recovery"
  | "abort_and_escalate"
  | "audit_and_trace_logger";

export interface AgentNodeState {
  id: AgentNodeId;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  output?: any;
  durationMs?: number;
  timestamp: string;
}

export interface TelemetrySpan {
  id: string;
  parentId?: string;
  name: string;
  type: "node" | "tool" | "rag" | "hitl";
  startTime: string;
  endTime?: string;
  durationMs?: number;
  attributes: Record<string, any>;
  status: "success" | "error" | "paused";
}

export interface AgentRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  customInput?: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  event: DisruptionEvent | null;
  nodes: AgentNodeState[];
  score: ImpactScore | null;
  decision?: "APPROVE" | "DENY" | "REQUEST_MORE_INFO";
  recoveryActions?: {
    rerouteConfirmations?: any[];
    poUpdates?: any[];
    notificationsSent?: any[];
  } | null;
  escalationReport?: string | null;
  spans: TelemetrySpan[];
  startTime: string;
  endTime?: string;
  loopCount?: Record<string, number>;
  quotaExceeded?: boolean;
}

export interface SystemHistory {
  runs: AgentRun[];
}
