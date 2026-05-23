import React, { useEffect, useRef, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin, Navigation, Info, ShieldAlert, ArrowRight } from "lucide-react";

// Read API keys securely as mandated in the Google Maps skill
const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

// Standard Port Geocoding database for accurate routing
interface PortCoord {
  name: string;
  code: string;
  lat: number;
  lng: number;
  description: string;
}

const PORT_COORDINATES: Record<string, PortCoord> = {
  "chennai": { name: "Chennai Port", code: "INMAA", lat: 13.0922, lng: 80.2941, description: "Primary maritime container gateway of South India (Subject to active disruption)" },
  "kattupalli": { name: "Kattupalli Port", code: "INKAT", lat: 13.3103, lng: 80.3340, description: "Approved Alternate Gateway with modern cargo sorting automation" },
  "mumbai": { name: "Mumbai Port Trust", code: "INBOM", lat: 18.9515, lng: 72.8427, description: "West Coast maritime hub (Subject to active disruption)" },
  "nhava sheva": { name: "Nhava Sheva Port (JNPT)", code: "INNSA", lat: 18.9419, lng: 72.9513, description: "Approved Alternate Western Gateway with active deep-water berths" }
};

// Dark map styles matching our cohesive dark terminal aesthetic
const darkMapStyles = [
  { backgroundColor: "#151518" },
  { elementType: "geometry", stylers: [{ color: "#212127" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212127" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a0a0b0" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#f59e0b" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e2e38" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1c1c22" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#808090" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3e3e4a" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#f59e0b", opacity: 0.2 }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#d1d5db" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f0f12" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4b5563" }] }
];

interface RouteDisplayProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
  routeType: "disrupted" | "alternative";
  onRouteCalculated?: (distance: string, duration: string) => void;
}

// Inner routes display component that uses Google Maps JS Routes Library
function RouteDisplay({ origin, destination, routeType, onRouteCalculated }: RouteDisplayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [midpoint, setMidpoint] = useState<google.maps.LatLngLiteral | null>(null);
  const [duration, setDuration] = useState<string>("");

  useEffect(() => {
    if (!routesLib || !map) return;

    let animIntervalId: any = null;

    // Clear previous polylines
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    setMidpoint(null);

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode: "DRIVING", // Query driving/freight paths between port interfaces
      fields: ["path", "distanceMeters", "durationMillis", "viewport"],
    })
      .then(({ routes }) => {
        if (routes?.[0]) {
          const newPolylines = routes[0].createPolylines();
          
          const isAlt = routeType === "alternative";
          const strokeColor = isAlt ? "#10b981" : "#ef4444"; // emerald-500 or red-500
          const glyphColor = isAlt ? "#ffe6cc" : "#fee2e2";
          
          // Style the polylines elegantly with animated paths
          newPolylines.forEach(p => {
            p.setOptions({
              strokeColor: strokeColor,
              strokeOpacity: isAlt ? 0.9 : 0.6,
              strokeWeight: isAlt ? 5.0 : 4.0,
              icons: [
                {
                  icon: {
                    path: window.google?.maps?.SymbolPath?.CIRCLE ?? 0,
                    fillOpacity: 1,
                    scale: isAlt ? 4.5 : 4.0,
                    fillColor: glyphColor,
                    strokeColor: strokeColor,
                    strokeWeight: 1.5,
                  },
                  offset: "0%",
                  repeat: "60px",
                }
              ]
            });
            p.setMap(map);
          });
          polylinesRef.current = newPolylines;

          // Active logistics flow pulse animation along the routes
          let count = 0;
          animIntervalId = setInterval(() => {
            count = (count + 1) % 120;
            newPolylines.forEach(p => {
              p.setOptions({
                icons: [
                  {
                    icon: {
                      path: window.google?.maps?.SymbolPath?.CIRCLE ?? 0,
                      fillOpacity: 1,
                      scale: isAlt ? 4.5 : 4.0,
                      fillColor: glyphColor,
                      strokeColor: strokeColor,
                      strokeWeight: 1.5,
                    },
                    offset: (count / 1.25) + "%",
                    repeat: "60px",
                  }
                ]
              });
            });
          }, isAlt ? 30 : 60); // Faster active speed for alternate bypass route, slower crawl for disrupted delay

          // Extract metrics and trigger callback
          const distanceKm = (routes[0].distanceMeters ? (routes[0].distanceMeters / 1000).toFixed(1) : "25.4") + " km";
          const durationMins = routes[0].durationMillis
            ? Math.round(routes[0].durationMillis / 60000) + " mins"
            : "45 mins";

          setDuration(durationMins);

          // Compute midpoint coordinates of the path safely
          const path = routes[0].path;
          if (path && path.length > 0) {
            const midIndex = Math.floor(path.length / 2);
            const midPointRaw = path[midIndex];
            let midLat: number;
            let midLng: number;
            if (typeof (midPointRaw as any).lat === "function") {
              midLat = (midPointRaw as any).lat();
              midLng = (midPointRaw as any).lng();
            } else {
              midLat = (midPointRaw as any).lat;
              midLng = (midPointRaw as any).lng;
            }
            setMidpoint({ lat: midLat, lng: midLng });
          } else {
            setMidpoint(null);
          }

          if (onRouteCalculated) {
            onRouteCalculated(distanceKm, durationMins);
          }

          // Adjust map viewport to cover both ports seamlessly
          if (routes[0].viewport) {
            map.fitBounds(routes[0].viewport);
          } else {
            // Fallback manual bounds
            const bounds = new google.maps.LatLngBounds();
            bounds.extend(origin);
            bounds.extend(destination);
            map.fitBounds(bounds);
          }
        }
      })
      .catch(err => {
        console.error("Google Maps Route calculation failed:", err);
      });

    return () => {
      if (animIntervalId) clearInterval(animIntervalId);
      polylinesRef.current.forEach(p => p.setMap(null));
    };
  }, [routesLib, map, origin, destination, routeType]);

  return midpoint ? (
    <InfoWindow position={midpoint} disableAutoPan={true} headerDisabled={true}>
      <div className="bg-[#0C0C0E]/95 border border-white/20 p-2.5 rounded-lg text-white font-mono text-[10px] min-w-[200px] shadow-2xl space-y-1.5 pointer-events-none select-none">
        <div className="flex items-center gap-1.5 border-b border-white/10 pb-1 justify-between">
          <span className={`text-[8.5px] uppercase font-bold tracking-wide ${routeType === "alternative" ? "text-emerald-400" : "text-rose-400"}`}>
            {routeType === "alternative" ? "Active Bypass Option" : "Active Blocked Loop"}
          </span>
          <span className="text-white/40 text-[7px] font-semibold">ROUTE TELEMETRY HUD</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-left">
          <div>
            <span className="text-white/30 text-[7.5px] block leading-normal uppercase">TRANSIT EST</span>
            <strong className="text-white text-[11px] leading-tight font-bold">{duration || "Calculating..."}</strong>
          </div>
          <div className="text-right">
            <span className="text-white/30 text-[7.5px] block leading-normal uppercase">COST DELTA</span>
            <strong className={`text-[11px] leading-tight font-bold ${routeType === "alternative" ? "text-emerald-400" : "text-rose-400"}`}>
              {routeType === "alternative" ? "+$1,200 USD" : "+$4,800 USD"}
            </strong>
          </div>
        </div>
      </div>
    </InfoWindow>
  ) : null;
}

const INLAND_HUBS: Record<string, { name: string; code: string; lat: number; lng: number; description: string }> = {
  "chennai": { name: "Sriperumbudur Freight Corridor", code: "SRIP-ICD", lat: 13.0033, lng: 79.9722, description: "Major manufacturing cluster hosting secure smart cargo depots" },
  "mumbai": { name: "Pune Consolidated Depot", code: "PUNE-ICD", lat: 18.5204, lng: 73.8567, description: "Primary regional manufacturing consolidating hub on expressway" },
};

interface PortRoutingMapProps {
  affectedPortName: string;
  onRouteUpdated?: (distance: string, duration: string) => void;
}

export function PortRoutingMap({ affectedPortName, onRouteUpdated }: PortRoutingMapProps) {
  const [routeType, setRouteType] = useState<"disrupted" | "alternative">("alternative");
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);

  // Identify ports based on run context string
  const lowerPort = affectedPortName.toLowerCase();
  const isMumbaiContext = lowerPort.includes("mumbai") || lowerPort.includes("bombay") || lowerPort.includes("inbom");

  const originPortKey = isMumbaiContext ? "mumbai" : "chennai";
  const destPortKey = isMumbaiContext ? "nhava sheva" : "kattupalli";

  const origin = PORT_COORDINATES[originPortKey];
  const destination = PORT_COORDINATES[destPortKey];
  const inlandHub = INLAND_HUBS[originPortKey];

  const handleRouteCalculated = (distance: string, duration: string) => {
    setRouteInfo({ distance, duration });
    if (onRouteUpdated) {
      onRouteUpdated(distance, duration);
    }
  };

  if (!hasValidKey) {
    // Elegant fallback simulated workspace dashboard showing high-precision SVG connection paths
    const isAlt = routeType === "alternative";
    const simulatedDistance = isAlt
      ? (isMumbaiContext ? "124.2 km" : "51.8 km")
      : (isMumbaiContext ? "149.8 km" : "41.5 km");
    const simulatedDuration = isAlt
      ? (isMumbaiContext ? "2 hr 45 mins" : "1 hr 10 mins")
      : (isMumbaiContext ? "4 hr 15 mins" : "1 hr 35 mins");

    return (
      <div className="bg-[#111114] border border-white/10 rounded-xl overflow-hidden flex flex-col h-full" id="fallback-maps-renderer">
        {/* API Key prompt bar */}
        <div className="bg-[#1A1A1F] border-b border-white/5 py-2 px-3 text-[11px] text-white/50 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-orange-400">
            <ShieldAlert className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
            STANDBY: OFFLINE SIMULATION GEOMETRY
          </span>
          <a
            href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-500 hover:underline hover:text-orange-400 font-mono text-[9px] uppercase tracking-wider"
          >
            Get Live API Key →
          </a>
        </div>

        {/* Beautiful high contrast SVG simulated port connector map */}
        <div className="relative flex-1 bg-[#0A0A0C] min-h-[190px] flex items-center justify-center p-4">
          {/* Grids and grid ticks to emulate a scientific coordinate terminal */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#15151b_1px,transparent_1px),linear-gradient(to_bottom,#15151b_1px,transparent_1px)] bg-[size:16px_16px] opacity-60"></div>
          
          {/* Simulated Floating Control Buttons */}
          <div className="absolute top-2.5 left-2.5 z-20 bg-[#141419]/95 border border-white/10 p-0.5 rounded-lg flex items-center gap-0.5 shadow-xl backdrop-blur-md" id="fallback-route-controls">
            <button
              id="fallback-btn-alternative"
              onClick={() => setRouteType("alternative")}
              className={`px-2 py-1 rounded text-[9px] uppercase font-mono font-bold transition-all duration-200 ${
                isAlt
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                  : "text-white/40 hover:text-white/80 border border-transparent"
              }`}
            >
              Alternative
            </button>
            <button
              id="fallback-btn-disrupted"
              onClick={() => setRouteType("disrupted")}
              className={`px-2 py-1 rounded text-[9px] uppercase font-mono font-bold transition-all duration-200 ${
                !isAlt
                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/20"
                  : "text-white/40 hover:text-white/80 border border-transparent"
              }`}
            >
              Disrupted
            </button>
          </div>

          <div className="relative w-full max-w-sm h-36 flex flex-col justify-between items-center z-10 font-mono">
            {/* Origin Depot */}
            <div className="bg-[#1C1C22]/85 border border-white/10 p-2 rounded w-full flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-[11px]">
                <div className="w-2 h-2 rounded-full bg-zinc-400 shrink-0"></div>
                <div>
                  <span className="text-white/30 text-[8px] block leading-tight">INLAND DEPARTURE LINK</span>
                  <span className="text-white font-bold">{inlandHub?.name} ({inlandHub?.code})</span>
                </div>
              </div>
              <span className="text-[9px] bg-white/5 text-white/50 px-1 py-0.5 rounded border border-white/10 font-bold uppercase">Source</span>
            </div>

            {/* Simulated Route Vector Line with active styling */}
            <div className="flex-1 w-full flex items-center justify-center relative my-1 select-none">
              <svg className="w-24 h-12" viewBox="0 0 100 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M50 0 V48"
                  stroke={isAlt ? "#10b981" : "#ef4444"}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  className="simulated-flow-line"
                  style={{ animationDuration: isAlt ? "1.2s" : "2.5s" }}
                />
              </svg>
              
              {/* Telemetry info box above the active simulated polyline */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className={`bg-[#0C0C0E]/95 border ${isAlt ? "border-emerald-500/30" : "border-rose-500/30"} p-2 rounded-lg shadow-2xl flex flex-col items-center gap-1 text-[9.5px] font-mono whitespace-nowrap min-w-[170px]`}>
                  <div className="flex items-center justify-between w-full border-b border-white/5 pb-1 gap-1">
                    <span className={`text-[8.5px] uppercase font-bold tracking-wide ${isAlt ? "text-emerald-400" : "text-rose-400"}`}>
                      {isAlt ? "Active Bypass Option" : "Active Blocked Loop"}
                    </span>
                    <span className="text-white/30 text-[7px] font-semibold">SIM TELEMETRY HUD</span>
                  </div>
                  <div className="flex justify-between w-full text-[9px] leading-tight">
                    <div className="flex flex-col text-left">
                      <span className="text-white/40 text-[7px] leading-none uppercase">Transit Est</span>
                      <strong className="text-white font-bold">{simulatedDuration}</strong>
                    </div>
                    <div className="flex flex-col text-right">
                      <span className="text-white/40 text-[7px] leading-none uppercase">Cost Delta</span>
                      <strong className={isAlt ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                        {isAlt ? "+$1,200 USD" : "+$4,800 USD"}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Target port box */}
            <div className={`border p-2 rounded w-full flex items-center justify-between text-xs transition-colors duration-300 ${
              isAlt ? "bg-emerald-950/20 border-emerald-500/30 text-white" : "bg-red-950/20 border-red-500/30 text-white"
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${isAlt ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`}></div>
                <div>
                  <span className="text-white/40 text-[9px] block">
                    {isAlt ? "DESIGNATED BYPASS TARGET" : "BLOCKED DESTINATION GATEWAY"}
                  </span>
                  <span className="text-white font-bold">
                    {isAlt ? `${destination?.name} (${destination?.code})` : `${origin?.name} (${origin?.code})`}
                  </span>
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase leading-none ${
                isAlt ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"
              }`}>
                {isAlt ? "Open Gate" : "Closed"}
              </span>
            </div>
          </div>

          {/* Quick HUD Metrics */}
          <div className="absolute bottom-2.5 left-2.5 bg-black/80 border border-white/5 p-2 rounded text-[10px] font-mono space-y-0.5 max-w-[180px] z-15 backdrop-blur-sm">
            <span className="text-white/40 block uppercase tracking-wider text-[8px]">Geometric Analytics</span>
            <div className="text-white"><span className="text-white/50">Travel Arc:</span> <strong className={isAlt ? "text-emerald-400" : "text-rose-400"}>{simulatedDistance}</strong></div>
            <div className="text-white"><span className="text-white/50">Trucking Duration:</span> <strong className={isAlt ? "text-emerald-400" : "text-rose-400"}>{simulatedDuration}</strong></div>
          </div>
        </div>

        {/* API key setup instructional footer */}
        <div className="p-3.5 bg-[#141419] border-t border-white/5 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-white/80 font-bold">
            <Info className="w-4 h-4 text-orange-500" />
            <span>To activate live Google Maps routing pipelines:</span>
          </div>
          <ol className="list-decimal list-inside text-white/50 space-y-1 text-[11px] leading-relaxed">
            <li>Open the <strong className="text-white/70">Settings (⚙️ gear icon, top-right)</strong></li>
            <li>Select <strong className="text-white/70">Secrets</strong></li>
            <li>Add <code className="bg-white/5 text-orange-400 px-1 py-0.5 rounded text-[10px] font-mono">GOOGLE_MAPS_PLATFORM_KEY</code> as name</li>
            <li>Paste your key as value and click <strong className="text-white/70">Add Secret / Apply</strong></li>
          </ol>
        </div>
      </div>
    );
  }

  // Live interactive Google Map view with full routing calculation
  const startTarget = inlandHub;
  const endTarget = routeType === "alternative" ? destination : origin;
  
  const defaultCenter = { 
    lat: (inlandHub.lat + origin.lat + destination.lat) / 3, 
    lng: (inlandHub.lng + origin.lng + destination.lng) / 3 
  };

  return (
    <div className="bg-[#111114] border border-white/10 rounded-xl overflow-hidden flex flex-col h-full" id="google-maps-parent">
      {/* Route Info HUD */}
      <div className="bg-[#1A1A1F] border-b border-white/5 py-2 px-3 text-[11px] text-white/80 flex items-center justify-between z-10 font-mono">
        <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
          <Navigation className="w-3.5 h-3.5 animate-pulse" />
          GOOGLE MAPS API LIVE ROUTING
        </span>
        {routeInfo && (
          <div className="flex items-center gap-3 text-white/50 text-[10px]">
            <span>Distance: <strong className={routeType === "alternative" ? "text-emerald-400" : "text-rose-400"}>{routeInfo.distance}</strong></span>
            <span>Est. Trucking Transit: <strong className={routeType === "alternative" ? "text-emerald-400" : "text-rose-400"}>{routeInfo.duration}</strong></span>
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-[220px]" style={{ width: "100%" }}>
        {/* Route Selector Floating Overlay Controller */}
        <div className="absolute top-2.5 left-2.5 z-20 bg-[#141419]/95 border border-white/10 p-0.5 rounded-lg flex items-center gap-0.5 shadow-2xl backdrop-blur-md" id="map-route-controls">
          <button
            id="btn-select-alternative"
            onClick={() => setRouteType("alternative")}
            className={`px-2.5 py-1 rounded-md text-[9px] uppercase font-mono font-bold transition-all duration-200 flex items-center gap-1 ${
              routeType === "alternative"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${routeType === "alternative" ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`}></span>
            Alternative
          </button>
          <button
            id="btn-select-disrupted"
            onClick={() => setRouteType("disrupted")}
            className={`px-2.5 py-1 rounded-md text-[9px] uppercase font-mono font-bold transition-all duration-200 flex items-center gap-1 ${
              routeType === "disrupted"
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                : "text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${routeType === "disrupted" ? "bg-rose-400 animate-pulse" : "bg-white/20"}`}></span>
            Disrupted
          </button>
        </div>

        <APIProvider apiKey={API_KEY} version="weekly">
          <Map
            defaultCenter={defaultCenter}
            defaultZoom={11}
            mapId="DEMO_MAP_ID"
            style={{ width: "100%", height: "100%" }}
            options={{
              styles: darkMapStyles,
              disableDefaultUI: true,
              zoomControl: true,
              scrollwheel: true
            }}
            internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
          >
            {/* 1. Inland Consolidated Depot Marker */}
            <AdvancedMarker position={{ lat: inlandHub.lat, lng: inlandHub.lng }}>
              <div className="flex flex-col items-center">
                <div className="px-1 py-0.5 bg-[#1F1F24] border border-white/20 rounded font-mono text-[8px] text-white/80 mb-1 shadow-md leading-none">
                  {inlandHub.code}
                </div>
                <Pin background="#3f3f46" glyphColor="#fff" border="#52525b" scale={0.75} />
              </div>
            </AdvancedMarker>

            {/* 2. Disrupted Port Marker */}
            <AdvancedMarker position={{ lat: origin.lat, lng: origin.lng }}>
              <div className={`flex flex-col items-center transition-all duration-300 ${routeType === "disrupted" ? "opacity-100 scale-100" : "opacity-35 scale-90"}`}>
                <div className="px-1 py-0.5 bg-[#450a0a] border border-red-500/30 rounded font-mono text-[8px] text-red-200 mb-1 shadow-md font-bold leading-none">
                  {origin.code}
                </div>
                <Pin background="#ef4444" glyphColor="#fff" border="#b91c1c" scale={0.8} />
              </div>
            </AdvancedMarker>

            {/* 3. Recommended Alternate Gateway Marker */}
            <AdvancedMarker position={{ lat: destination.lat, lng: destination.lng }}>
              <div className={`flex flex-col items-center transition-all duration-300 ${routeType === "alternative" ? "opacity-100 scale-100" : "opacity-35 scale-90"}`}>
                <div className="px-1 py-0.5 bg-[#064e3b] border border-emerald-500/30 rounded font-mono text-[8px] text-emerald-200 mb-1 shadow-md font-bold leading-none">
                  {destination.code}
                </div>
                <Pin background="#10b981" glyphColor="#fff" border="#047857" scale={0.8} />
              </div>
            </AdvancedMarker>

            {/* Draw Routes dynamic link */}
            <RouteDisplay
              origin={{ lat: startTarget.lat, lng: startTarget.lng }}
              destination={{ lat: endTarget.lat, lng: endTarget.lng }}
              routeType={routeType}
              onRouteCalculated={handleRouteCalculated}
            />
          </Map>
        </APIProvider>

        {/* Tiny map helper cards */}
        <div className="absolute right-2 bottom-2 bg-black/80 border border-white/10 p-2 rounded text-[10px] font-mono text-white/70 flex flex-col gap-1 backdrop-blur-sm max-w-[130px]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
            <span>{inlandHub.code} (Int. Cargo)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
            <span>{origin.code} ({routeType === "disrupted" ? "Active Block" : "Inactive"})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>{destination.code} ({routeType === "alternative" ? "Bypass active" : "Standby"})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
