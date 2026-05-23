import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import {
  DisruptionEvent,
  Shipment,
  DownstreamDependency,
  ContractChunk,
  AlternativeCarrier,
  AlternativePort,
  AlternativeSupplier,
  AgentNodeId,
  AgentNodeState,
  TelemetrySpan,
  AgentRun,
  ImpactScore,
  ScoreFlag,
} from "./src/types";

dotenv.config();

const PORT = 3000;
const app = express();
app.use(express.json());

// Trace Storage Directory
const TRACE_DIR = path.join(process.cwd(), "traces");
if (!fs.existsSync(TRACE_DIR)) {
  fs.mkdirSync(TRACE_DIR, { recursive: true });
}

// Global System State
let history: AgentRun[] = [];
let activeRun: AgentRun | null = null;
let activeRunPromise: { resolve?: (decision: "APPROVE" | "DENY" | "REQUEST_MORE_INFO") => void } = {};

// ---------------------------------------------------------------------------
// LAZY-INITIALIZE GEMINI API (Prevents startup crash when key is missing)
// ---------------------------------------------------------------------------
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY" && key.trim() !== "") {
      try {
        aiClient = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });
        console.log("Success: Server-side Gemini Client has been initialized.");
      } catch (e) {
        console.error("Warning: Failed to initialize Gemini API Client", e);
      }
    } else {
      console.log("Warning: GEMINI_API_KEY environment variable is not configured. Running in high-fidelity mock mode.");
    }
  }
  return aiClient;
}

// ---------------------------------------------------------------------------
// PRE-INGESTED MOCK CONTRACT RAG DATABASE (Pillar 2 - Grounding)
// ---------------------------------------------------------------------------
const RAG_CORPUS: ContractChunk[] = [
  {
    docName: "GlobalParts_Vendor_Contract_v3.2.pdf",
    section: "Paragraph 4.2 - Disparity & Force Majeure",
    clauseId: "CON-42-GP",
    content: "Force majeure terms and liability suspensions apply only if a disruption event exceeds 72 continuous hours in duration. Alternate suppliers catalogued in Appendix B must be formally engaged within 48 hours of the official Force Majeure declaration to bypass standard purchase order liability terms."
  },
  {
    docName: "AutoAssembly_SLA_Plant3_2025.pdf",
    section: "Section 2.1 - Logistics Lead Times & Delays",
    clauseId: "SLA-21-PL3",
    content: "Any raw material delivery delay beyond 24 hours triggers an immediate baseline operational penalty of $5,000 per hour. Delays exceeding 72 hours trigger a severe breach clause entitling Plant 3 to trigger an emergency contract audit review cycle and source external components."
  },
  {
    docName: "GlobalParts_Vendor_Contract_v3.2.pdf",
    section: "Appendix B - Approved Alternate Supplier Schedule",
    clauseId: "APP-B-SUP",
    content: "Approved Alternate Suppliers: SKU-4421 (Automotive Microcontroller Units) pre-approved sources include: (1) FastParts Vietnam, LeadTime: 6 days, contact ref: FPV-2024-09. (2) QuickSupply Thailand, LeadTime: 8 days, contractual reference: QST-2024-11."
  },
  {
    docName: "GlobalParts_Vendor_Contract_v3.2.pdf",
    section: "Appendix D - Approved Alternate Port Facilities",
    clauseId: "APP-D-PORT",
    content: "Approved Alternate Ports: For Indian subcontinent maritime routes terminating at Chennai Port, Kattupalli Port (located 45km north, operational, maximum vessel class: Panamax capacity) is pre-approved as a designated backup gateway."
  },
  {
    docName: "OceanFast_Logistics_Operations_SLA.pdf",
    section: "Schedule C - Carrier Diversion Clauses",
    clauseId: "CAR-SLA-OF",
    content: "For active ocean freight, carrier rerouting requests must be submitted at least 12 hours prior to scheduled vessel gateway departure. Late cancellations or bypass requests trigger a flat carrier penalty of 8% of the total declared shipment value."
  }
];

// Helper to query our RAG Corpus using simple semantic/keyword relevance
function retrieveContractChunks(queryText: string): ContractChunk[] {
  const query = queryText.toLowerCase();
  const scored = RAG_CORPUS.map((chunk) => {
    let score = 0;
    const terms = [
      "force majeure", "4.2", "72", "penalty", "sla", "2.1", "alternate",
      "fastparts", "vietnam", "kattupalli", "oceanfast", "reroute", "chennai", "mumbai"
    ];
    
    terms.forEach((term) => {
      if (query.includes(term) && chunk.content.toLowerCase().includes(term)) {
        score += 20;
      }
    });

    // Content match density
    const chunkLower = chunk.content.toLowerCase();
    const queryWords = query.split(/\s+/).filter(w => w.length > 3);
    queryWords.forEach((word) => {
      if (chunkLower.includes(word)) score += 5;
    });

    return { ...chunk, score };
  });

  // Sort and return top 3 with score > 0 (or default to top matches)
  return scored
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3)
    .map(c => {
      const { score, ...rest } = c;
      return rest;
    });
}

// ---------------------------------------------------------------------------
// MOCK LOGISTICS TOOL DATABASE
// ---------------------------------------------------------------------------
const MOCK_SHIPMENTS: Record<string, Shipment[]> = {
  "Chennai": [
    { shipmentId: "SHP-001", orderValue: 120000, destinationPlant: "AutoAssembly Plant 3", daysUntilSlaBreach: 1, productSku: "SKU-4421" },
    { shipmentId: "SHP-002", orderValue: 95000, destinationPlant: "AutoAssembly Plant 3", daysUntilSlaBreach: 2, productSku: "SKU-4421" },
    { shipmentId: "SHP-003", orderValue: 45000, destinationPlant: "AutoAssembly Plant 3", daysUntilSlaBreach: 1, productSku: "SKU-3091" },
    { shipmentId: "SHP-004", orderValue: 160000, destinationPlant: "Powertrain Plant 1", daysUntilSlaBreach: 4, productSku: "SKU-4421" }
  ],
  "Mumbai": [
    { shipmentId: "SHP-005", orderValue: 50000, destinationPlant: "AutoAssembly Plant 3", daysUntilSlaBreach: 5, productSku: "SKU-3091" },
    { shipmentId: "SHP-006", orderValue: 35000, destinationPlant: "Powertrain Plant 1", daysUntilSlaBreach: 6, productSku: "SKU-1022" }
  ]
};

const MOCK_DEPENDENCIES: Record<string, DownstreamDependency> = {
  "SHP-001": { assemblyLinesAtRisk: ["Main Line Alpha"], productsBlocked: ["Electric SUV Core"], estimatedExposurePerHourUsd: 5000 },
  "SHP-002": { assemblyLinesAtRisk: ["Main Line Alpha", "Sub-Module Flex B"], productsBlocked: ["Electric SUV Core", "Sedan Cockpit B"], estimatedExposurePerHourUsd: 3400 },
  "SHP-003": { assemblyLinesAtRisk: ["Trim Line C"], productsBlocked: ["Compact Hatchback"], estimatedExposurePerHourUsd: 1200 },
  "SHP-004": { assemblyLinesAtRisk: ["Powertrain Assembly 2"], productsBlocked: ["Electric Motor Gen3"], estimatedExposurePerHourUsd: 2800 },
  "SHP-005": { assemblyLinesAtRisk: ["Sub-Module Flex B"], productsBlocked: ["Sedan Cockpit B"], estimatedExposurePerHourUsd: 1500 },
  "SHP-006": { assemblyLinesAtRisk: ["Battery Enclosure Riveting"], productsBlocked: ["Pack-Battery L3"], estimatedExposurePerHourUsd: 800 }
};

const MOCK_CARRIERS: AlternativeCarrier[] = [
  { name: "BlueWave Shipping", transitDays: 2, costUsd: 14500, reliabilityScore: 94, availability: "High" },
  { name: "Pacific Express Inc", transitDays: 3, costUsd: 11000, reliabilityScore: 88, availability: "Medium" },
  { name: "OceanFast Logistics", transitDays: 4, costUsd: 9500, reliabilityScore: 92, availability: "Low" }
];

const MOCK_PORTS: Record<string, AlternativePort> = {
  "INMAA": { code: "INMAA", status: "congested", averageDelayDays: 5, lastUpdated: "2026-05-23T06:00:00Z" },
  "INKAT": { code: "INKAT", status: "open", averageDelayDays: 0.5, lastUpdated: "2026-05-23T07:00:00Z" },
  "INBOM": { code: "INBOM", status: "congested", averageDelayDays: 2, lastUpdated: "2026-05-23T05:30:00Z" },
  "INNSA": { code: "INNSA", status: "open", averageDelayDays: 0.6, lastUpdated: "2026-05-23T08:00:00Z" }
};

const MOCK_SUPPLIERS: AlternativeSupplier[] = [
  { name: "FastParts Vietnam", country: "Vietnam", leadTimeDays: 6, unitCost: 4.8, isContractApproved: true, sku: "SKU-4421" },
  { name: "QuickSupply Thailand", country: "Thailand", leadTimeDays: 8, unitCost: 5.2, isContractApproved: true, sku: "SKU-4421" },
  { name: "AeroTech Shenzhen", country: "China", leadTimeDays: 4, unitCost: 6.5, isContractApproved: false, sku: "SKU-4421" }
];

// Helper tools mimicking live latency
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Tool implementations
async function getAffectedShipments(portName: string): Promise<Shipment[]> {
  await delay(400); // Demo latency
  const cleanPort = (portName || "").toLowerCase().includes("chennai") ? "Chennai" : "Mumbai";
  return MOCK_SHIPMENTS[cleanPort] || [];
}

async function getDownstreamDependencies(shipmentIds: string[]): Promise<DownstreamDependency> {
  await delay(400); // Demo latency
  let assemblyLinesAtRisk: string[] = [];
  let productsBlocked: string[] = [];
  let estimatedExposurePerHourUsd = 0;

  shipmentIds.forEach((id) => {
    const dep = MOCK_DEPENDENCIES[id];
    if (dep) {
      assemblyLinesAtRisk = Array.from(new Set([...assemblyLinesAtRisk, ...dep.assemblyLinesAtRisk]));
      productsBlocked = Array.from(new Set([...productsBlocked, ...dep.productsBlocked]));
      estimatedExposurePerHourUsd += dep.estimatedExposurePerHourUsd;
    }
  });

  return { assemblyLinesAtRisk, productsBlocked, estimatedExposurePerHourUsd };
}

async function getAvailableCarriers(origin: string, destination: string): Promise<AlternativeCarrier[]> {
  await delay(400);
  return MOCK_CARRIERS;
}

async function getPortStatus(portCodes: string[]): Promise<AlternativePort[]> {
  await delay(400);
  return portCodes.map((code) => MOCK_PORTS[code] || { code, status: "open", averageDelayDays: 0, lastUpdated: "Active" });
}

async function getSupplierInventory(sku: string): Promise<AlternativeSupplier[]> {
  await delay(400);
  return MOCK_SUPPLIERS.filter((s) => s.sku === sku);
}

// ---------------------------------------------------------------------------
// INITIAL DEMO SCENARIOS
// ---------------------------------------------------------------------------
const PRESET_SCENARIOS = [
  {
    id: "scenario-a",
    name: "Scenario A - Chennai Strike (Critical / Escalated / Approved)",
    input: "Strike declared at Port of Chennai starting June 12, estimated duration is 5 days. Impacting automotive MCU chips cargo, shipments: SHP-001, SHP-002, SHP-003, SHP-004."
  },
  {
    id: "scenario-b",
    name: "Scenario B - Chennai Strike (Critical / Denied by Supervisor)",
    input: "Port strike starting at Chennai immediately. Estimated duration is 6 days. Shipments SHP-001 and SHP-002 are on-board. Critical shortage alert flagged."
  },
  {
    id: "scenario-c",
    name: "Scenario C - Mumbai Fog Delay (Minor / Auto Recovered)",
    input: "Heavy fog disruption reported at Port of Mumbai, estimated 1-day delay. Minor speed slowing affects cargo shipments SHP-005, SHP-006."
  },
  {
    id: "scenario-d",
    name: "Scenario D - Total Blackout (Zero Alternatives / Hard Block Escalated)",
    input: "Port strike in Chennai combined with emergency lockdowns in Vietnam and Thailand, blocking alternate component lines for SKU-4421. Shortage expected."
  }
];

// ---------------------------------------------------------------------------
// TELEMETRY HELPER (PILLAR 3 - Observability & Tracing)
// ---------------------------------------------------------------------------
function addSpan(
  run: AgentRun,
  name: string,
  type: "node" | "tool" | "rag" | "hitl",
  startTime: string,
  endTime: string,
  attributes: Record<string, any>,
  status: "success" | "error" | "paused" = "success"
): TelemetrySpan {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const durationMs = end - start;

  const span: TelemetrySpan = {
    id: `span-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    parentId: run.spans.length > 0 ? run.spans[run.spans.length - 1].id : undefined,
    name,
    type,
    startTime,
    endTime,
    durationMs,
    attributes,
    status
  };

  run.spans.push(span);
  return span;
}

// ---------------------------------------------------------------------------
// CORE AGENT STATE MACHINE IMPLEMENTATION (LangGraph Simulator)
// ---------------------------------------------------------------------------
async function processAgentStateMachine(run: AgentRun) {
  // Initialization Tracker for loops
  if (!run.loopCount) run.loopCount = {};
  
  // Transition Helper
  const setNodeState = (nodeId: AgentNodeId, status: AgentNodeState["status"], output?: any, durationMs?: number) => {
    const node = run.nodes.find(n => n.id === nodeId);
    if (node) {
      node.status = status;
      node.timestamp = new Date().toISOString();
      if (output !== undefined) node.output = output;
      if (durationMs !== undefined) node.durationMs = durationMs;
    }
  };

  const checkLoopRisk = (nodeId: AgentNodeId): boolean => {
    if (!run.loopCount) run.loopCount = {};
    run.loopCount[nodeId] = (run.loopCount[nodeId] || 0) + 1;
    
    if (run.loopCount[nodeId] > 3) {
      // Loop Detected! Terminate executing tree immediately
      return true;
    }
    return false;
  };

  try {
    // -------------------------------------
    // 1. parse_disruption_event
    // -------------------------------------
    const t1_start = new Date().toISOString();
    setNodeState("parse_disruption_event", "running");
    
    if (checkLoopRisk("parse_disruption_event")) throw new Error("LOOP_DETECTED");
    await delay(600);

    const rawInput = run.customInput || (run.scenarioId === "scenario-c" 
      ? "Port of Mumbai 1-day fog delay" 
      : run.scenarioId === "scenario-d" 
        ? "Chennai Strike but Vietnam and Thailand suppliers locked down"
        : "Port of Chennai strike, 5-day delay");

    const lowerInput = rawInput.toLowerCase();
    
    // Default values parsed through robust offline keyword heuristic matching
    let eventType = "Port Strike";
    if (lowerInput.includes("fog") || lowerInput.includes("weather") || lowerInput.includes("visibility")) {
      eventType = "Severe Fog";
    } else if (lowerInput.includes("lockout") || lowerInput.includes("lockdown")) {
      eventType = "Lockdown Disruption";
    } else if (lowerInput.includes("strike") || lowerInput.includes("walkout") || lowerInput.includes("protest")) {
      eventType = "Port Strike";
    } else if (lowerInput.includes("typhoon") || lowerInput.includes("storm") || lowerInput.includes("monsoon")) {
      eventType = "Tropical Storm";
    } else if (lowerInput.includes("delay") || lowerInput.includes("congestio")) {
      eventType = "Port Congestion";
    }

    let affectedPort = "Chennai Port";
    let affectedRegion = "South India Maritime Hub";
    if (lowerInput.includes("mumbai") || lowerInput.includes("bombay") || lowerInput.includes("inbom")) {
      affectedPort = "Mumbai Port";
      affectedRegion = "Western Coast Terminal";
    } else if (lowerInput.includes("chennai") || lowerInput.includes("inmaa") || lowerInput.includes("kattupalli")) {
      affectedPort = "Chennai Port";
      affectedRegion = "South India Maritime Hub";
    } else {
      const portRegex = /port\s+of\s+([a-zA-Z]+)/i;
      const match = rawInput.match(portRegex);
      if (match && match[1]) {
        affectedPort = match[1] + " Port";
        affectedRegion = match[1] + " Maritime Terminal";
      }
    }

    let severity: "low" | "medium" | "high" | "critical" = "high";
    if (lowerInput.includes("critical") || lowerInput.includes("severe") || lowerInput.includes("disastrous")) {
      severity = "critical";
    } else if (lowerInput.includes("minor") || lowerInput.includes("low") || lowerInput.includes("slight")) {
      severity = "low";
    } else if (lowerInput.includes("medium") || lowerInput.includes("moderate") || lowerInput.includes("average")) {
      severity = "medium";
    }

    let estimatedDurationDays = 5;
    const dayMatch = lowerInput.match(/(\d+)\s*-?\s*day/);
    if (dayMatch && dayMatch[1]) {
      estimatedDurationDays = parseInt(dayMatch[1], 10);
    }

    let impactedShipmentIds = ["SHP-001", "SHP-002", "SHP-003", "SHP-004"];
    if (affectedPort.includes("Mumbai")) {
      impactedShipmentIds = ["SHP-005", "SHP-006"];
    } else {
      const shpMatches = [...lowerInput.matchAll(/shp-\d+/g)].map(m => m[0].toUpperCase());
      if (shpMatches.length > 0) {
        impactedShipmentIds = shpMatches;
      }
    }

    let parsedEvent: DisruptionEvent = {
      eventType,
      affectedPort,
      affectedRegion,
      severity,
      estimatedDurationDays,
      impactedShipmentIds
    };

    const client = getGeminiClient();
    if (client) {
      try {
        const prompt = `You are the SupplyGuard AI extraction parser. Extract structured details from this supply chain advisory alert. Respond in JSON.
        Alert: "${rawInput}"
        Expected JSON format:
        {
          "eventType": "string",
          "affectedPort": "string",
          "affectedRegion": "string",
          "severity": "low" | "medium" | "high" | "critical",
          "estimatedDurationDays": number,
          "impactedShipmentIds": ["string"]
        }
        Do not add any markup other than clean JSON. Let your JSON keys strictly match this format.`;

        const response = await client.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                eventType: { type: Type.STRING },
                affectedPort: { type: Type.STRING },
                affectedRegion: { type: Type.STRING },
                severity: { type: Type.STRING, description: "Must be low, medium, high, or critical" },
                estimatedDurationDays: { type: Type.INTEGER },
                impactedShipmentIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["eventType", "affectedPort", "affectedRegion", "severity", "estimatedDurationDays", "impactedShipmentIds"]
            }
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text.trim());
          parsedEvent = {
            eventType: parsed.eventType || eventType,
            affectedPort: parsed.affectedPort || affectedPort,
            affectedRegion: parsed.affectedRegion || affectedRegion,
            severity: (["low", "medium", "high", "critical"].includes(parsed.severity) ? parsed.severity : severity) as any,
            estimatedDurationDays: parsed.estimatedDurationDays || estimatedDurationDays,
            impactedShipmentIds: parsed.impactedShipmentIds && parsed.impactedShipmentIds.length > 0
              ? parsed.impactedShipmentIds.map((id: string) => id.toUpperCase())
              : impactedShipmentIds
          };
        }
      } catch (gem_err: any) {
        const errStr = String(gem_err?.message || gem_err);
        const isQuotaExceeded = errStr.includes("429") || errStr.toLowerCase().includes("quota") || errStr.toLowerCase().includes("exhausted") || errStr.includes("RESOURCE_EXHAUSTED");
        if (isQuotaExceeded) {
          console.warn("[GEMINI API WARNING] Free-tier request limit reached (429 Quota Exhausted). Gracefully falling back to high-fidelity offline heuristic mapper.");
          run.quotaExceeded = true;
        } else {
          console.error("Gemini API invocation parsing issue, falling back to robust offline mapper", gem_err);
        }
      }
    }

    // High fidelity scenario overrides (ensures exact compliance regardless of API responses)
    if (run.scenarioId === "scenario-a" || run.scenarioId === "scenario-b") {
      parsedEvent = {
        eventType: "Port Strike",
        affectedPort: "Chennai Port",
        affectedRegion: "South India Maritime Hub",
        severity: "critical",
        estimatedDurationDays: 5,
        impactedShipmentIds: ["SHP-001", "SHP-002", "SHP-003", "SHP-004"]
      };
    } else if (run.scenarioId === "scenario-c") {
      parsedEvent = {
        eventType: "Severe Fog",
        affectedPort: "Mumbai Port",
        affectedRegion: "Western Coast Terminal",
        severity: "medium",
        estimatedDurationDays: 1,
        impactedShipmentIds: ["SHP-005", "SHP-006"]
      };
    } else if (run.scenarioId === "scenario-d") {
      parsedEvent = {
        eventType: "Lockdown Disruption",
        affectedPort: "Chennai Port (Locked Alternates)",
        affectedRegion: "Global Logistics Network",
        severity: "critical",
        estimatedDurationDays: 7,
        impactedShipmentIds: ["SHP-001", "SHP-002"]
      };
    }

    run.event = parsedEvent;
    const t1_end = new Date().toISOString();
    const t1_duration = new Date(t1_end).getTime() - new Date(t1_start).getTime();
    setNodeState("parse_disruption_event", "completed", parsedEvent, t1_duration);
    addSpan(run, "parse_disruption_event", "node", t1_start, t1_end, {
      "advisory.input": rawInput,
      "extracted.event_type": parsedEvent.eventType,
      "extracted.severity": parsedEvent.severity,
      "extracted.port": parsedEvent.affectedPort,
      "unstructured.extraction_method": run.quotaExceeded ? "Fallback Offline Heuristics" : "Real-time LLM Schema Extraction",
      "quota.exceeded": run.quotaExceeded || false
    });

    // -------------------------------------
    // 2. assess_blast_radius
    // -------------------------------------
    const t2_start = new Date().toISOString();
    setNodeState("assess_blast_radius", "running");
    if (checkLoopRisk("assess_blast_radius")) throw new Error("LOOP_DETECTED");

    // Sequential Tool Calls mapping
    const shipmentsToolStart = new Date().toISOString();
    const shipments = await getAffectedShipments(parsedEvent.affectedPort);
    const shipmentsToolEnd = new Date().toISOString();
    addSpan(run, "tool::get_affected_shipments", "tool", shipmentsToolStart, shipmentsToolEnd, {
      port_code: parsedEvent.affectedPort,
      results_count: shipments.length
    });

    const dependenciesToolStart = new Date().toISOString();
    const shipmentIds = shipments.map((s) => s.shipmentId);
    const dependencies = await getDownstreamDependencies(shipmentIds);
    const dependenciesToolEnd = new Date().toISOString();
    addSpan(run, "tool::get_downstream_dependencies", "tool", dependenciesToolStart, dependenciesToolEnd, {
      shipment_count: shipmentIds.length,
      exposure_hourly_usd: dependencies.estimatedExposurePerHourUsd
    });

    const blastOutput = { shipments, dependencies };
    const t2_end = new Date().toISOString();
    const t2_duration = new Date(t2_end).getTime() - new Date(t2_start).getTime();
    setNodeState("assess_blast_radius", "completed", blastOutput, t2_duration);
    addSpan(run, "assess_blast_radius", "node", t2_start, t2_end, {
      impacted_orders_count: shipments.length,
      total_hourly_exposure_usd: dependencies.estimatedExposurePerHourUsd,
      blocked_assembly_lines: dependencies.assemblyLinesAtRisk
    });

    // -------------------------------------
    // 3. rag_contract_lookup (Pillar 2 - Grounding)
    // -------------------------------------
    const t3_start = new Date().toISOString();
    setNodeState("rag_contract_lookup", "running");
    if (checkLoopRisk("rag_contract_lookup")) throw new Error("LOOP_DETECTED");

    await delay(500);
    const searchQuery = `${parsedEvent.eventType} ${parsedEvent.affectedPort} alternate force majeure penalty SLA`;
    const retrievedChunks = retrieveContractChunks(searchQuery);

    const t3_end = new Date().toISOString();
    const t3_duration = new Date(t3_end).getTime() - new Date(t3_start).getTime();
    setNodeState("rag_contract_lookup", "completed", retrievedChunks, t3_duration);
    addSpan(run, "rag_contract_lookup", "node", t3_start, t3_end, {
      query: searchQuery
    });
    addSpan(run, "vector::query_vendor_contracts", "rag", t3_start, t3_end, {
      query: searchQuery,
      documents_recalled: retrievedChunks.map((c) => c.docName),
      clause_ids: retrievedChunks.map((c) => c.clauseId)
    });

    // -------------------------------------
    // 4. find_alternatives
    // -------------------------------------
    const t4_start = new Date().toISOString();
    setNodeState("find_alternatives", "running");
    if (checkLoopRisk("find_alternatives")) throw new Error("LOOP_DETECTED");

    // Call carrier, port, and supplier tools sequentially
    const carrierStart = new Date().toISOString();
    const carriers = await getAvailableCarriers("Chennai", "Europe");
    const carrierEnd = new Date().toISOString();
    addSpan(run, "tool::get_available_carriers", "tool", carrierStart, carrierEnd, {
      origin: "Chennai", destination: "Europe", carriers_found: carriers.length
    });

    const portStart = new Date().toISOString();
    const isMumbaiPort = run.event?.affectedPort?.toLowerCase().includes("mumbai") || run.event?.affectedPort?.toLowerCase().includes("inbom");
    const portsToQuery = isMumbaiPort ? ["INBOM", "INNSA"] : ["INMAA", "INKAT"];
    const portStatuses = await getPortStatus(portsToQuery);
    const portEnd = new Date().toISOString();
    addSpan(run, "tool::get_port_status", "tool", portStart, portEnd, {
      port_codes: portsToQuery
    });

    // In scenario-d (Total lock down), we override to return alternate supplier with isContractApproved=false / availability empty
    const supplierStart = new Date().toISOString();
    let suppliers = await getSupplierInventory("SKU-4421");
    if (run.scenarioId === "scenario-d") {
      // Vietnam and Thailand pre-approved alternates are catalogued, but blocked in this scenario
      suppliers = [];
    }
    const supplierEnd = new Date().toISOString();
    addSpan(run, "tool::get_supplier_inventory", "tool", supplierStart, supplierEnd, {
      sku: "SKU-4421", suppliers_found: suppliers.length
    });

    const alternativesOutput = { carriers, portStatuses, suppliers };
    const t4_end = new Date().toISOString();
    const t4_duration = new Date(t4_end).getTime() - new Date(t4_start).getTime();
    setNodeState("find_alternatives", "completed", alternativesOutput, t4_duration);
    addSpan(run, "find_alternatives", "node", t4_start, t4_end, {
      alternate_options_retrieved: true,
      has_approved_ports: portStatuses.some(p => p.code === "INKAT" && p.status === "open"),
      has_approved_suppliers: suppliers.some(s => s.isContractApproved)
    });

    // -------------------------------------
    // 5. impact_scorer (Deterministic Function)
    // -------------------------------------
    const t5_start = new Date().toISOString();
    setNodeState("impact_scorer", "running");
    if (checkLoopRisk("impact_scorer")) throw new Error("LOOP_DETECTED");

    await delay(400);

    // Compute deterministic points
    let score = 0;
    const flags: ScoreFlag[] = [];

    // Rule 1: Severity Score
    if (parsedEvent.severity === "low") {
      score += 5;
      flags.push({ score: 5, reason: "Disruption severity is rated low (minimal alert profile)", source: "parse_disruption_event::severity" });
    } else if (parsedEvent.severity === "medium") {
      score += 15;
      flags.push({ score: 15, reason: "Moderate disruption severity level flagged on corridor", source: "parse_disruption_event::severity" });
    } else if (parsedEvent.severity === "high") {
      score += 25;
      flags.push({ score: 25, reason: "Severe alert level flagged on shipment corridor", source: "parse_disruption_event::severity" });
    } else if (parsedEvent.severity === "critical") {
      score += 30;
      flags.push({ score: 30, reason: "Critical disruption alert level triggered on main supply line", source: "parse_disruption_event::severity" });
    }

    // Rule 2: Impacted Shipment Volume Points
    const shipmentCount = shipments.length;
    const shipmentPoints = shipmentCount * 5;
    score += shipmentPoints;
    flags.push({ score: shipmentPoints, reason: `Volume of impacted shipments: ${shipmentCount} cargo units currently in transit`, source: "assess_blast_radius::shipments_count" });

    // Rule 3: Estimated disruption duration points
    const durationPoints = parsedEvent.estimatedDurationDays * 3;
    score += durationPoints;
    flags.push({ score: durationPoints, reason: `Disruption estimated duration: ${parsedEvent.estimatedDurationDays} business calendar days`, source: "parse_disruption_event::estimated_duration" });

    // Rule 4: Financial Exposure Score
    const hourlyExposureUsd = dependencies.estimatedExposurePerHourUsd;
    const exposurePoints = Math.round(Math.min(Math.floor(hourlyExposureUsd / 600), 15));
    if (exposurePoints > 0) {
      score += exposurePoints;
      flags.push({ score: exposurePoints, reason: `Hourly business jeopardy loss rate evaluated at $${hourlyExposureUsd.toLocaleString()}/hour`, source: "assess_blast_radius::exposure" });
    }

    // Rule 5: SLA Breach urgency
    const minBreachDays = Math.min(...shipments.map((s) => s.daysUntilSlaBreach), 3);
    if (minBreachDays <= 1) {
      score += 10;
      flags.push({ score: 10, reason: "SLA penalty alert: critical breach window threshold <= 24 hours detected", source: "assess_blast_radius::days_until_breach (AutoAssembly Section 2.1)" });
    } else if (minBreachDays === 2) {
      score += 5;
      flags.push({ score: 5, reason: "SLA penalty warning: breach window threshold <= 48 hours detected", source: "assess_blast_radius::days_until_breach (AutoAssembly Section 2.1)" });
    } else {
      score += 1;
      flags.push({ score: 1, reason: "SLA penalty record: breach window is buffered with > 48 hours margin", source: "assess_blast_radius::days_until_breach (AutoAssembly Section 2.1)" });
    }

    // Rule 6: Absolute blackout & alternate locks
    const hasApprovedAlternateSupplier = suppliers.some((s) => s.isContractApproved);
    if (!hasApprovedAlternateSupplier && run.scenarioId === "scenario-d") {
      score += 20;
      flags.push({ score: 20, reason: "Supplier Outage: pre-approved alternate SKUs are blocked or locked", source: "rag_contract_lookup::AppendixB" });
    }

    // Secure Clamp between 0 and 100 to fit high precision model metrics
    score = Math.min(score, 100);

    const action = score >= 41 ? "ESCALATE" : "AUTO_RECOVER";
    const impactScore: ImpactScore = { score, action, flags };
    run.score = impactScore;

    const t5_end = new Date().toISOString();
    const t5_duration = new Date(t5_end).getTime() - new Date(t5_start).getTime();
    setNodeState("impact_scorer", "completed", impactScore, t5_duration);
    addSpan(run, "impact_scorer", "node", t5_start, t5_end, {
      final_impact_score: score,
      routed_action: action,
      active_alarm_flags: flags.length
    });

    // -------------------------------------
    // Routing Decider Edge
    // -------------------------------------
    if (action === "ESCALATE") {
      // Pause graph - await supervisor decision via WebSocket or Polling
      const t6_start = new Date().toISOString();
      setNodeState("human_review", "paused");
      run.status = "paused";
      addSpan(run, "human_review::interrupt", "hitl", t6_start, t6_start, {
        score_trigger: score,
        enforced_guard: "HITL Edge Enforced: Reroute blocked until authorization key received."
      }, "paused");
      
      // Stop execution. Wait until resume signal is triggered
      return;
    } else {
      // Auto routing directly to execute_recovery
      await executeRecoveryProcess(run);
    }

  } catch (error: any) {
    console.error("Agent execution loop error boundary caught exception:", error);
    
    // Check if loop detected
    if (error.message === "LOOP_DETECTED") {
      run.status = "failed";
      // Update all subsequent pending nodes to failed
      run.nodes.forEach(n => {
        if (n.status === "pending" || n.status === "running") n.status = "failed";
      });
      addSpan(run, "critical_loop_breaker::exception", "node", new Date().toISOString(), new Date().toISOString(), {
        warning: "Loop risk alert: An execution node was visited more than 3 times in a single loop run.",
        action: "EMERGENCY SHUTDOWN INSTIGATED. Execution halted to prevent pipeline queue explosion."
      }, "error");
    } else {
      run.status = "failed";
    }
  }
}

// Separate Recovery Actions executor
async function executeRecoveryProcess(run: AgentRun) {
  const setNodeState = (nodeId: AgentNodeId, status: AgentNodeState["status"], output?: any, durationMs?: number) => {
    const node = run.nodes.find(n => n.id === nodeId);
    if (node) {
      node.status = status;
      node.timestamp = new Date().toISOString();
      if (output !== undefined) node.output = output;
      if (durationMs !== undefined) node.durationMs = durationMs;
    }
  };

  const t7_start = new Date().toISOString();
  setNodeState("execute_recovery", "running");
  await delay(800);

  // Pillar 1 Guard Compliance
  if (run.score && run.score.score >= 41 && !run.decision) {
    setNodeState("execute_recovery", "failed");
    throw new Error("ComplianceError: Rerouting triggered on ESCALATE event without valid supervisor signature.");
  }

  // Dynamically query actual shipments to prevent duplicating the same reroute data
  const assessNode = run.nodes.find(n => n.id === "assess_blast_radius");
  const shipmentsList = assessNode?.output?.shipments || [];

  const isMumbai = run.event?.affectedPort?.toLowerCase().includes("mumbai");
  const alternativePort = isMumbai ? "Nhava Sheva Port (INNSA)" : "Kattupalli Port (INKAT)";
  const alternativeCarrier = isMumbai ? "Oceanic Star" : "BlueWave Shipping";

  const rerouteConfirmations = shipmentsList.length > 0
    ? shipmentsList.map((s: any, idx: number) => ({
        shipmentId: s.shipmentId || `SHP-0${10 + idx}`,
        confirmationId: `R-CN-910${4 + idx}`,
        newCarrier: alternativeCarrier,
        newRoute: `Port Reroute (${run.event?.affectedPort || "Chennai Port"} -> ${alternativePort})`,
        newEtd: `June ${13 + idx} (Delta +${s.daysToAlternative || (1 + idx)} day)`,
        costDeltaUsd: s.costDeltaUsd || (3000 + idx * 750)
      }))
    : [
        { shipmentId: "SHP-001", confirmationId: "R-CN-9104", newCarrier: "BlueWave Shipping", newRoute: "Port Reroute (Chennai -> Kattupalli)", newEtd: "June 13 (Delay minimized)", costDeltaUsd: 5000 }
      ];

  let poUpdates: any[] = [];
  const needsSupplierSub = shipmentsList.some((s: any) => s.productSku === "SKU-4421");
  const hasApprovedAltSupplier = run.scenarioId !== "scenario-d"; // blocked in scenario-d
  if (needsSupplierSub && hasApprovedAltSupplier) {
    poUpdates = [
      { poId: "PO-SUV-770A", updateId: "PO-UPD-5501", productSku: "SKU-4421", newSupplierId: "FastParts Vietnam", reference: "FPV-2024-09" }
    ];
  }

  const plants = Array.from(new Set(shipmentsList.map((s: any) => s.destinationPlant || "AutoAssembly Plant 3")));
  const notificationsSent = (plants.length > 0 ? plants : ["AutoAssembly Plant 3"]).map(plant => ({
    plant: String(plant),
    status: "notified",
    alertLevel: run.score && run.score.score >= 50 ? "Amber - Delays Cleared" : "Green - Resolved",
    notifiedVia: "Teams + SMS Integration (Channel: SupplyLogistics)"
  }));

  const recoveryOut = { rerouteConfirmations, poUpdates, notificationsSent };
  run.recoveryActions = recoveryOut;

  const t7_end = new Date().toISOString();
  const t7_duration = new Date(t7_end).getTime() - new Date(t7_start).getTime();
  setNodeState("execute_recovery", "completed", recoveryOut, t7_duration);
  addSpan(run, "execute_recovery", "node", t7_start, t7_end, {
    reroute_orders_submitted: rerouteConfirmations.length,
    supplier_orders_amended: poUpdates.length,
    notifications_delivered: notificationsSent.length
  });

  // Complete Graph Audit Trace Logger Terminal Edge
  await executeAuditLogger(run, "COMPLETED");
}

async function executeAbortAndEscalate(run: AgentRun) {
  const setNodeState = (nodeId: AgentNodeId, status: AgentNodeState["status"], output?: any, durationMs?: number) => {
    const node = run.nodes.find(n => n.id === nodeId);
    if (node) {
      node.status = status;
      node.timestamp = new Date().toISOString();
      if (output !== undefined) node.output = output;
      if (durationMs !== undefined) node.durationMs = durationMs;
    }
  };

  const t8_start = new Date().toISOString();
  setNodeState("abort_and_escalate", "running");
  await delay(800);

  const isD = run.scenarioId === "scenario-d";
  const report = `
# SUPPLY CHAIN DISRUPTION ESCALATION REPORT - CRITICAL OUTAGE
**Incident Reference ID:** ESG-REP-${run.id.substring(0, 8).toUpperCase()}
**Timestamp:** 2026-05-23T07:32:00Z
**Incident Category:** Port Disruption / alternate supplier blackout

## Executive Summary
A critical maritime roadblock has occurred at the **Chennai Port Terminal**. Immediate intervention and manual commercial negotiation are required to prevent a full plant-assembly line stoppage.

## Core Blast Radius Summary
- **Primary Blocked Component:** SKU-4421 (Automotive Microcontroller Units)
- **Hourly Penalty Exposure:** $8,400 / hour (beginning at SLA penalty trigger hour 24)
- **Assembly Lines Engaged:** Main Line Alpha, Powertrain Assembly 2
- **Force Majeure Validation:** Not applicable until hour 72 (Clause 4.2 Global Parts Contract v3.2)

## Option Space & Impediments
${isD ? `
- **Approved Alternate Supplier:** Vietnam & Thailand certified alternate corridors are **UNAVAILABLE** due to regional lockdowns. Standard purchase order substitution guidelines cannot bypass this constraint.
- **Port Action Map:** Backup Kattupalli port gate status is operational, but carrier OceanFast Logistics refuses booking assignments.
` : `
- **Reason for Abort:** Supervisor manually **DENIED** alternative rerouting recommendations. Standard container assignment SHP-001 remained stationary at port coordinates.
`}

## Immediate Recommendation Matrix
1. Initiate emergency procurement negotiations directly with secondary Asian tier-2 channels via manual override.
2. Request immediate legal assessment of GlobalParts Clause 4.2 timeline triggers.
`;

  run.escalationReport = report;
  const t8_end = new Date().toISOString();
  const t8_duration = new Date(t8_end).getTime() - new Date(t8_start).getTime();
  setNodeState("abort_and_escalate", "completed", report, t8_duration);
  addSpan(run, "abort_and_escalate", "node", t8_start, t8_end, {
    escalation_report_compiled: true,
    total_usd_jeopardy_exposed: 8400
  });

  // Complete Graph Audit Trace Logger Terminal Edge
  await executeAuditLogger(run, "ABORTED");
}

async function executeAuditLogger(run: AgentRun, finalState: "COMPLETED" | "ABORTED") {
  const setNodeState = (nodeId: AgentNodeId, status: AgentNodeState["status"], output?: any, durationMs?: number) => {
    const node = run.nodes.find(n => n.id === nodeId);
    if (node) {
      node.status = status;
      node.timestamp = new Date().toISOString();
      if (output !== undefined) node.output = output;
      if (durationMs !== undefined) node.durationMs = durationMs;
    }
  };

  const t9_start = new Date().toISOString();
  setNodeState("audit_and_trace_logger", "running");
  await delay(500);

  run.status = finalState === "COMPLETED" ? "completed" : "failed";
  run.endTime = new Date().toISOString();

  const auditData = {
    runId: run.id,
    totalDurationMs: new Date(run.endTime).getTime() - new Date(run.startTime).getTime(),
    finalOutcome: finalState,
    nodeHistories: run.nodes.map(n => ({ id: n.id, status: n.status, ms: n.durationMs })),
    spansCount: run.spans.length,
    timestamp: run.endTime
  };

  const t9_end = new Date().toISOString();
  const t9_duration = new Date(t9_end).getTime() - new Date(t9_start).getTime();
  setNodeState("audit_and_trace_logger", "completed", auditData, t9_duration);
  
  // Close the final span
  addSpan(run, "audit_and_trace_logger", "node", t9_start, t9_end, {
    persistent_write_success: true,
    log_file_key: `run_${run.id}.json`
  });

  // Write Trace to local traces repository append-only or single JSON
  const traceFilePath = path.join(TRACE_DIR, `run_${run.id}.json`);
  fs.writeFileSync(traceFilePath, JSON.stringify(run, null, 2));

  // Push to local memory history registry
  history.push(run);
  activeRun = null;
}

// ---------------------------------------------------------------------------
// INITIAL SYSTEM STATUS PRESETS
// ---------------------------------------------------------------------------
activeRun = null;

// Populate initial mock trace records
const pop_start_time = new Date("2026-05-23T04:30:11Z").toISOString();
const mockHistoricRun: AgentRun = {
  id: "run-hist-8a101",
  scenarioId: "scenario-a",
  scenarioName: "Scenario A - Chennai Strike (Base History)",
  status: "completed",
  event: {
    eventType: "Port Strike",
    affectedPort: "Chennai Port",
    affectedRegion: "Tamil Nadu, India",
    severity: "critical",
    estimatedDurationDays: 5,
    impactedShipmentIds: ["SHP-001", "SHP-002", "SHP-003", "SHP-004"]
  },
  nodes: [
    { id: "parse_disruption_event", name: "1. parse_disruption_event", status: "completed", timestamp: pop_start_time, durationMs: 450 },
    { id: "assess_blast_radius", name: "2. assess_blast_radius", status: "completed", timestamp: pop_start_time, durationMs: 820 },
    { id: "rag_contract_lookup", name: "3. rag_contract_lookup", status: "completed", timestamp: pop_start_time, durationMs: 512 },
    { id: "find_alternatives", name: "4. find_alternatives", status: "completed", timestamp: pop_start_time, durationMs: 1220 },
    { id: "impact_scorer", name: "5. impact_scorer", status: "completed", timestamp: pop_start_time, durationMs: 400 },
    { id: "human_review", name: "6. human_review", status: "completed", timestamp: pop_start_time },
    { id: "execute_recovery", name: "7. execute_recovery", status: "completed", timestamp: pop_start_time, durationMs: 810 },
    { id: "abort_and_escalate", name: "8. abort_and_escalate", status: "pending", timestamp: pop_start_time },
    { id: "audit_and_trace_logger", name: "9. audit_and_trace_logger", status: "completed", timestamp: pop_start_time, durationMs: 500 }
  ],
  score: {
    score: 75,
    action: "ESCALATE",
    flags: [
      { score: 50, reason: "Critical alert level triggered on main supply line", source: "parse_disruption_event::severity" },
      { score: 20, reason: "Disruption duration estimated at > 3 working days", source: "parse_disruption_event::estimated_duration" },
      { score: 15, reason: "Breach penalty window critical: delay threshold <= 24 hours detected", source: "assess_blast_radius::days_until_breach" }
    ]
  },
  decision: "APPROVE",
  recoveryActions: {
    rerouteConfirmations: [
      { shipmentId: "SHP-001", confirmationId: "R-CN-4411", newCarrier: "BlueWave Shipping", newRoute: "Port Reroute (Chennai -> Kattupalli)", newEtd: "June 13 (Min delay)", costDeltaUsd: 5000 }
    ],
    poUpdates: [],
    notificationsSent: []
  },
  spans: [
    { id: "span-root", name: "SupplyGuard Agent State Engine", type: "node", startTime: pop_start_time, endTime: pop_start_time, durationMs: 4712, attributes: {}, status: "success" }
  ],
  startTime: pop_start_time,
  endTime: new Date("2026-05-23T04:35:00Z").toISOString()
};
history.push(mockHistoricRun);


// ---------------------------------------------------------------------------
// EXPRESS API ROUTING ENDPOINTS
// ---------------------------------------------------------------------------

// List Preset Scenarios
app.get("/api/scenarios", (req, res) => {
  res.json(PRESET_SCENARIOS);
});

// View Contract Database
app.get("/api/contracts", (req, res) => {
  res.json(RAG_CORPUS);
});

// History Logs
app.get("/api/history", (req, res) => {
  res.json(history);
});

// Reset Logs
app.delete("/api/history", (req, res) => {
  history = [mockHistoricRun];
  res.json({ success: true, history });
});

// Retrieve Active Run Progress
app.get("/api/active-run", (req, res) => {
  res.json(activeRun);
});

// Trigger New Simulation Graph Execution
app.post("/api/run", (req, res) => {
  const { scenarioId, customInput } = req.body;
  const scenario = PRESET_SCENARIOS.find(s => s.id === scenarioId) || PRESET_SCENARIOS[0];

  if (activeRun && (activeRun.status === "running" || activeRun.status === "paused")) {
    return res.status(400).json({ error: "Active simulation is currently processing in backend." });
  }

  // Trigger "Alert:" key verification for custom inputs
  if (scenarioId === "custom") {
    const inputVal = customInput || "";
    if (!inputVal.toLowerCase().includes("alert:")) {
      return res.status(400).json({
        error: "Trigger Missing: Custom supply chain input alerts must explicitly include the prefix 'Alert:' (e.g. 'Alert: Chennai Port lockout ...') to be recognized by the LangGraph pipeline."
      });
    }
  }

  const nodes: AgentNodeState[] = [
    { id: "parse_disruption_event", name: "1. parse_disruption_event", status: "pending", timestamp: new Date().toISOString() },
    { id: "assess_blast_radius", name: "2. assess_blast_radius", status: "pending", timestamp: new Date().toISOString() },
    { id: "rag_contract_lookup", name: "3. rag_contract_lookup", status: "pending", timestamp: new Date().toISOString() },
    { id: "find_alternatives", name: "4. find_alternatives", status: "pending", timestamp: new Date().toISOString() },
    { id: "impact_scorer", name: "5. impact_scorer", status: "pending", timestamp: new Date().toISOString() },
    { id: "human_review", name: "6. human_review", status: "pending", timestamp: new Date().toISOString() },
    { id: "execute_recovery", name: "7. execute_recovery", status: "pending", timestamp: new Date().toISOString() },
    { id: "abort_and_escalate", name: "8. abort_and_escalate", status: "pending", timestamp: new Date().toISOString() },
    { id: "audit_and_trace_logger", name: "9. audit_and_trace_logger", status: "pending", timestamp: new Date().toISOString() }
  ];

  // Create new active run
  activeRun = {
    id: `run-${Date.now()}`,
    scenarioId: scenarioId === "custom" ? "custom" : scenario.id,
    scenarioName: scenarioId === "custom" ? "Custom Advisory Alert" : scenario.name,
    customInput: req.body.customInput || undefined,
    status: "running",
    event: null,
    nodes,
    score: null,
    spans: [],
    startTime: new Date().toISOString()
  };

  // Launch async agent machine thread simulation
  processAgentStateMachine(activeRun);

  res.json(activeRun);
});

// Supervisor Authorization Endpoint - Human in the Loop Resume Edge
app.post("/api/active-run/decision", async (req, res) => {
  const { decision } = req.body; // "APPROVE" | "DENY" | "REQUEST_MORE_INFO"

  if (!activeRun || activeRun.status !== "paused") {
    return res.status(400).json({ error: "No paused simulation requires action at this stage." });
  }

  // Record Decision Node Trace Event
  activeRun.decision = decision;
  const node = activeRun.nodes.find(n => n.id === "human_review");
  if (node) {
    node.status = "completed";
    node.output = { supervisorDecision: decision, authorizedBy: req.headers["user-agent"] || "Supervisor Web Portal" };
    node.timestamp = new Date().toISOString();
  }

  // Update Telemetry trigger resuming span
  addSpan(activeRun, "human_review::decision", "hitl", new Date().toISOString(), new Date().toISOString(), {
    supervisor_decision: decision,
    action_signature: `auth-token-sig::${Math.floor(Math.random()*100000)}`
  });

  // Resume State Machine processing thread
  activeRun.status = "running";
  
  // Trigger appropriate edge
  if (decision === "APPROVE") {
    // Edge moves to execution node
    executeRecoveryProcess(activeRun);
  } else if (decision === "DENY") {
    // Edge moves to abort/escalation generator
    executeAbortAndEscalate(activeRun);
  } else {
    // REQUEST_MORE_INFO - Simulates request response, then triggers secondary auto-resolve or remains paused
    node!.status = "paused";
    node!.output = { supervisorDecision: decision, note: "More details requested on carrier capacities." };
    activeRun.status = "paused";
    return res.json({ success: true, message: "Request for information logged. Simulated graph remains paused." });
  }

  res.json({ success: true, activeRun });
});

// Trigger Infinite Loop Scenario to Demo loop safety metric (PILLAR 3)
app.post("/api/simulate-loop-bug", (req, res) => {
  if (activeRun && (activeRun.status === "running" || activeRun.status === "paused")) {
    return res.status(400).json({ error: "Active simulation is currently processing in backend." });
  }

  const nodes: AgentNodeState[] = [
    { id: "parse_disruption_event", name: "1. parse_disruption_event", status: "pending", timestamp: new Date().toISOString() },
    { id: "assess_blast_radius", name: "2. assess_blast_radius", status: "pending", timestamp: new Date().toISOString() },
    { id: "rag_contract_lookup", name: "3. rag_contract_lookup", status: "pending", timestamp: new Date().toISOString() },
    { id: "find_alternatives", name: "4. find_alternatives", status: "pending", timestamp: new Date().toISOString() },
    { id: "impact_scorer", name: "5. impact_scorer", status: "pending", timestamp: new Date().toISOString() },
    { id: "human_review", name: "6. human_review", status: "pending", timestamp: new Date().toISOString() },
    { id: "execute_recovery", name: "7. execute_recovery", status: "pending", timestamp: new Date().toISOString() },
    { id: "abort_and_escalate", name: "8. abort_and_escalate", status: "pending", timestamp: new Date().toISOString() },
    { id: "audit_and_trace_logger", name: "9. audit_and_trace_logger", status: "pending", timestamp: new Date().toISOString() }
  ];

  activeRun = {
    id: `run-loop-sim-${Date.now()}`,
    scenarioId: "scenario-a",
    scenarioName: "Pillar 3 Loop Detection Validation Bug",
    status: "running",
    event: null,
    nodes,
    score: null,
    spans: [],
    startTime: new Date().toISOString()
  };

  // Launch a buggy process state loop simulator that routes index 1 over and over
  const runLoopProcess = async () => {
    let loopCount = 0;
    const setNodeState = (nodeId: AgentNodeId, status: AgentNodeState["status"], output?: any, durationMs?: number) => {
      const n = activeRun!.nodes.find(v => v.id === nodeId);
      if (n) {
        n.status = status;
        n.timestamp = new Date().toISOString();
        if (output) n.output = output;
      }
    };

    try {
      // Begin standard
      setNodeState("parse_disruption_event", "running");
      await delay(400);
      setNodeState("parse_disruption_event", "completed", { eventType: "Infinite Loop" });
      addSpan(activeRun!, "parse_disruption_event", "node", new Date().toISOString(), new Date().toISOString(), {});

      // Simulate execution loop: assess_blast_radius runs repeatedly
      while (loopCount < 10) {
        loopCount++;
        setNodeState("assess_blast_radius", "running");
        await delay(500);
        
        // Loop safety validation check
        const count = loopCount;
        if (count > 3) {
          throw new Error("LOOP_DETECTED");
        }
        
        setNodeState("assess_blast_radius", "completed", { loopIter: count });
        addSpan(activeRun!, `assess_blast_radius::iteration_${count}`, "node", new Date().toISOString(), new Date().toISOString(), {
          iteration_index: count
        });

        // Artificially jump back
        setNodeState("assess_blast_radius", "pending");
      }
    } catch (err: any) {
      if (err.message === "LOOP_DETECTED") {
        activeRun!.status = "failed";
        activeRun!.endTime = new Date().toISOString();
        activeRun!.nodes.forEach(n => {
          if (n.status === "pending" || n.status === "running") n.status = "failed";
        });
        
        addSpan(activeRun!, "loop_detected_safety_interrupt", "node", new Date().toISOString(), new Date().toISOString(), {
          looping_node: "assess_blast_radius",
          total_revisits_detected: loopCount,
          execution_aborted: true,
          alert_msg: "SYSTEM SHUTDOWN: Agent loop count exceeded threshold limit. Threat safely neutralized."
        }, "error");

        const auditData = {
          runId: activeRun!.id,
          finalOutcome: "FAILED_LOOP_MITIGATED",
          spansCount: activeRun!.spans.length,
          timestamp: activeRun!.endTime
        };
        setNodeState("audit_and_trace_logger", "completed", auditData);
        history.push(activeRun!);
        activeRun = null;
      }
    }
  };

  runLoopProcess();
  res.json(activeRun);
});

// ---------------------------------------------------------------------------
// VITE / SPA FALLBACK MIDDLWARE SETUP
// ---------------------------------------------------------------------------
async function startAppServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware configured.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static files server configured.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SupplyGuard AI Dev Server listening on http://localhost:${PORT}`);
  });
}

startAppServer();
