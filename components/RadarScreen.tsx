
import React, { useEffect, useState, useRef } from 'react';
import { Aircraft, Airport, FlightStatus, PendingUpdates, Coordinates } from '../types';

interface RadarScreenProps {
  aircraft: Aircraft[];
  airport: Airport;
  selectedAircraftId: string | null;
  onSelectAircraft: (id: string | null) => void;
  pendingUpdates: PendingUpdates | null;
  onRadarInteraction: (updates: { heading?: number | null, directTo?: string | null }) => void;
  weatherSeverity: number; 
  score: number; 
  gameTier: number; // For alternates
  ashCloud?: { points: Coordinates[], maxAltitude: number } | null;
}

const TURN_RATE_PER_TICK = 0.60; 
const SIM_SPEED_FACTOR = 1.0; 

const RadarScreen: React.FC<RadarScreenProps> = ({ 
  aircraft, 
  airport, 
  selectedAircraftId, 
  onSelectAircraft,
  pendingUpdates,
  onRadarInteraction,
  weatherSeverity,
  score,
  gameTier,
  ashCloud
}) => {
  const [sweepAngle, setSweepAngle] = useState(0);
  const [mapOpacity, setMapOpacity] = useState(0.4);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null); 
  const weatherLayerRef = useRef<any>(null); 
  const markersRef = useRef<{[key: string]: any}>({}); 
  const ilsLayerRef = useRef<any>(null); 
  const captureZoneLayerRef = useRef<any>(null); 
  const coverageLayerRef = useRef<any>(null); 
  const ashLayerRef = useRef<any>(null);
  const alternateLayerRef = useRef<any>(null);
  const [projectionVersion, setProjectionVersion] = useState(0); 
  const [radarPixelRadius, setRadarPixelRadius] = useState(600); 

  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<{x: number, y: number} | null>(null);
  const [dragCurrentPos, setDragCurrentPos] = useState<{x: number, y: number} | null>(null);
  const [dragHeading, setDragHeading] = useState<number | null>(null);
  const [snappedWaypoint, setSnappedWaypoint] = useState<string | null>(null);

  const selectedPlane = aircraft.find(p => p.id === selectedAircraftId);
  const isSelectedPlaneEstablished = selectedPlane?.establishedOnILS;

  // Fix Map Rendering Issues (Tiles not loading)
  useEffect(() => {
      const handleResize = () => {
          if (mapInstanceRef.current) {
              mapInstanceRef.current.invalidateSize();
          }
      };
      window.addEventListener('resize', handleResize);
      // Force update on mount after layout settlement
      const timer = setTimeout(() => handleResize(), 500);
      return () => {
          window.removeEventListener('resize', handleResize);
          clearTimeout(timer);
      };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapInstanceRef.current) {
        // @ts-ignore
        const map = window.L.map(mapContainerRef.current, {
            center: [airport.location.lat, airport.location.lon],
            zoom: airport.initialZoom,
            zoomControl: false,
            attributionControl: false,
            boxZoom: false,
            doubleClickZoom: false,
            dragging: true,
            scrollWheelZoom: true,
            touchZoom: true,
            minZoom: 5, // Expanded range
            maxZoom: 18 // Expanded range
        });

        // @ts-ignore
        const tileLayer = window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20,
            opacity: mapOpacity 
        }).addTo(map);

        mapInstanceRef.current = map;
        tileLayerRef.current = tileLayer;

        map.on('move', () => setProjectionVersion(v => v + 1));
        map.on('zoom', () => setProjectionVersion(v => v + 1));
        map.on('click', () => { onSelectAircraft(null); });
        
        // Initial invalidate to ensure tiles load correctly
        setTimeout(() => map.invalidateSize(), 200);

    } else {
        mapInstanceRef.current.setView([airport.location.lat, airport.location.lon], airport.initialZoom);
    }
  }, [airport, onSelectAircraft]);

  useEffect(() => {
      if (!mapInstanceRef.current) return;
      const fetchWeather = async () => {
          try {
              const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
              const data = await response.json();
              if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
                  const lastPast = data.radar.past[data.radar.past.length - 1];
                  const time = lastPast.time;
                  const host = data.host; 
                  const url = `${host}${time}/256/{z}/{x}/{y}/2/1_1.png`;
                  if (weatherLayerRef.current) weatherLayerRef.current.remove();
                  // @ts-ignore
                  weatherLayerRef.current = window.L.tileLayer(url, { opacity: 0, zIndex: 10 }).addTo(mapInstanceRef.current);
              }
          } catch (e) { console.warn("RainViewer failed", e); }
      };
      fetchWeather();
      const interval = setInterval(fetchWeather, 600000);
      return () => clearInterval(interval);
  }, []);

  useEffect(() => {
      if (weatherLayerRef.current) weatherLayerRef.current.setOpacity(weatherSeverity * 0.6);
  }, [weatherSeverity]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const updateRadarSize = () => {
        const centerLatLng = [airport.location.lat, airport.location.lon];
        const edgeLatLng = [airport.location.lat + 1.8, airport.location.lon]; 
        // @ts-ignore
        const p1 = map.latLngToContainerPoint(centerLatLng);
        // @ts-ignore
        const p2 = map.latLngToContainerPoint(edgeLatLng);
        setRadarPixelRadius(Math.abs(p1.y - p2.y));
    };
    updateRadarSize();
    map.on('zoomend', updateRadarSize);
    return () => { map.off('zoomend', updateRadarSize); };
  }, [airport, projectionVersion]); 

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (coverageLayerRef.current) coverageLayerRef.current.remove();
    // @ts-ignore
    coverageLayerRef.current = window.L.circle([airport.location.lat, airport.location.lon], {
        radius: 200000,
        color: '#475569', 
        weight: 1,
        dashArray: '4, 8',
        fill: false,
        opacity: 0.5,
        interactive: false
    }).addTo(mapInstanceRef.current);
    
    // Add Volcano Marker for Popocatepetl if MMMX
    if (airport.code === 'MMMX') {
         // @ts-ignore
         window.L.marker([19.0228, -98.6278], {
             // @ts-ignore
             icon: window.L.divIcon({
                 className: 'bg-transparent',
                 html: '<div class="text-xl">🌋</div>',
                 iconSize: [20, 20]
             })
         }).addTo(mapInstanceRef.current);
    }

    return () => { if (coverageLayerRef.current) coverageLayerRef.current.remove(); };
  }, [airport]);

  // Ash Cloud Rendering
  useEffect(() => {
      if (!mapInstanceRef.current) return;
      if (ashLayerRef.current) ashLayerRef.current.remove();
      
      if (ashCloud) {
          const latlngs = ashCloud.points.map(p => [p.lat, p.lon]);
          // @ts-ignore
          ashLayerRef.current = window.L.polygon(latlngs, {
              color: '#71717a', // Zinc 500
              fillColor: '#52525b', // Zinc 600
              fillOpacity: 0.4,
              weight: 0,
              className: 'animate-pulse'
          }).addTo(mapInstanceRef.current);
      }
      return () => { if (ashLayerRef.current) ashLayerRef.current.remove(); };
  }, [ashCloud]);

  // Alternate Airports (Level 1+)
  useEffect(() => {
      if (!mapInstanceRef.current) return;
      if (alternateLayerRef.current) alternateLayerRef.current.clearLayers();
      else // @ts-ignore 
           alternateLayerRef.current = window.L.layerGroup().addTo(mapInstanceRef.current);

      if (gameTier >= 1 && airport.alternates) {
           airport.alternates.forEach(alt => {
               // Marker
               // @ts-ignore
               window.L.marker([alt.location.lat, alt.location.lon], {
                   // @ts-ignore
                   icon: window.L.divIcon({
                       className: 'bg-transparent',
                       html: `<div class="w-2 h-2 bg-slate-400 border border-slate-200"></div><div class="text-[9px] text-slate-400 font-mono mt-1">${alt.code}</div>`,
                       iconSize: [30, 30]
                   })
               }).addTo(alternateLayerRef.current);

               // ILS Line for alternate
               const localizerAngle = (alt.runwayHeading + 180) % 360;
               const endLat = alt.location.lat + (alt.ilsLengthNM / 60) * Math.cos(localizerAngle * Math.PI / 180);
               const endLon = alt.location.lon + (alt.ilsLengthNM / 60) * Math.sin(localizerAngle * Math.PI / 180) / Math.cos(alt.location.lat * Math.PI / 180);
               
               // @ts-ignore
               window.L.polyline([[alt.location.lat, alt.location.lon], [endLat, endLon]], {
                   color: '#3b82f6',
                   weight: 2,
                   opacity: 0.5,
                   dashArray: '5,5'
               }).addTo(alternateLayerRef.current);
           });
      }
  }, [gameTier, airport]);

  useEffect(() => {
    if (tileLayerRef.current) tileLayerRef.current.setOpacity(mapOpacity);
  }, [mapOpacity]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    Object.values(markersRef.current).forEach((marker: any) => map.removeLayer(marker));
    markersRef.current = {};
    airport.waypoints.forEach(wp => {
        const isSnapped = snappedWaypoint === wp.name || (pendingUpdates?.directTo === wp.name && selectedAircraftId !== null);
        const icon = createWaypointIcon(wp, isSnapped);
        // @ts-ignore
        const marker = window.L.marker([wp.location.lat, wp.location.lon], { icon, interactive: false }).addTo(map);
        markersRef.current[wp.name] = marker;
    });
    return () => { Object.values(markersRef.current).forEach((marker: any) => map.removeLayer(marker)); };
  }, [airport.waypoints]); 

  useEffect(() => {
      airport.waypoints.forEach(wp => {
          const marker = markersRef.current[wp.name];
          if (marker) {
              const isSnapped = snappedWaypoint === wp.name || (pendingUpdates?.directTo === wp.name && selectedAircraftId !== null);
              const newIcon = createWaypointIcon(wp, isSnapped);
              marker.setIcon(newIcon);
          }
      });
  }, [snappedWaypoint, pendingUpdates?.directTo, selectedAircraftId]);

  // --- ILS LINE RENDER (Static per airport) ---
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    // Clean up previous ILS if exists (when airport changes)
    if (ilsLayerRef.current) {
        ilsLayerRef.current.remove();
        ilsLayerRef.current = null;
    }

    const localizerAngle = (airport.runwayHeading + 180) % 360;
    const ILS_LENGTH_NM = 18;
    const projectPoint = (lat: number, lon: number, brng: number, distNM: number) => {
        const R = 3440.065; 
        const d = distNM / R;
        const brngRad = brng * Math.PI / 180;
        const latRad = lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;
        const lat2 = Math.asin(Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(brngRad));
        const lon2 = lonRad + Math.atan2(Math.sin(brngRad) * Math.sin(d) * Math.cos(latRad), Math.cos(d) - Math.sin(latRad) * Math.sin(lat2));
        return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
    };

    const startCoords = [airport.location.lat, airport.location.lon];
    const endCoords = projectPoint(airport.location.lat, airport.location.lon, localizerAngle, ILS_LENGTH_NM);

    // @ts-ignore
    ilsLayerRef.current = window.L.polyline([startCoords, endCoords], {
        weight: 5,
        opacity: 1.0,
        color: '#3b82f6', 
        lineCap: 'butt'
    }).addTo(mapInstanceRef.current);

    return () => {
        if (ilsLayerRef.current) {
            ilsLayerRef.current.remove();
            ilsLayerRef.current = null;
        }
    };
  }, [airport]);

  // --- CAPTURE ZONE RENDER (Dynamic based on score) ---
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (!captureZoneLayerRef.current) {
         // @ts-ignore
         captureZoneLayerRef.current = window.L.layerGroup().addTo(mapInstanceRef.current);
    }
    
    captureZoneLayerRef.current.clearLayers();

    if (score < 10) {
        const localizerAngle = (airport.runwayHeading + 180) % 360;
        const ILS_LENGTH_NM = 18;
        const projectPoint = (lat: number, lon: number, brng: number, distNM: number) => {
            const R = 3440.065; 
            const d = distNM / R;
            const brngRad = brng * Math.PI / 180;
            const latRad = lat * Math.PI / 180;
            const lonRad = lon * Math.PI / 180;
            const lat2 = Math.asin(Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(brngRad));
            const lon2 = lonRad + Math.atan2(Math.sin(brngRad) * Math.sin(d) * Math.cos(latRad), Math.cos(d) - Math.sin(latRad) * Math.sin(lat2));
            return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
        };

        const startCoords = [airport.location.lat, airport.location.lon];
        const leftLimit = (localizerAngle - 15 + 360) % 360;
        const rightLimit = (localizerAngle + 15) % 360;
        const leftEnd = projectPoint(airport.location.lat, airport.location.lon, leftLimit, ILS_LENGTH_NM - 3);
        const rightEnd = projectPoint(airport.location.lat, airport.location.lon, rightLimit, ILS_LENGTH_NM - 3);
        
        // @ts-ignore
        window.L.polyline([startCoords, leftEnd], { color: '#fbbf24', dashArray: '10, 10', weight: 2, opacity: 0.6 }).addTo(captureZoneLayerRef.current);
        // @ts-ignore
        window.L.polyline([startCoords, rightEnd], { color: '#fbbf24', dashArray: '10, 10', weight: 2, opacity: 0.6 }).addTo(captureZoneLayerRef.current);
        const labelPos = projectPoint(airport.location.lat, airport.location.lon, localizerAngle, ILS_LENGTH_NM - 5);
        // @ts-ignore
        window.L.marker(labelPos, { icon: window.L.divIcon({ className: 'bg-transparent', html: '<div class="text-[#fbbf24] text-[10px] font-mono opacity-60 -rotate-90 whitespace-nowrap">ZONA DE CAPTURA ILS</div>', iconSize: [100, 20] }) }).addTo(captureZoneLayerRef.current);
    }
    
    // No return cleanup needed for the group itself, just clearLayers is enough on update
  }, [airport, score]);

  useEffect(() => {
    if (ilsLayerRef.current) {
        if (isSelectedPlaneEstablished) ilsLayerRef.current.setStyle({ color: '#10b981', opacity: 1, weight: 6 });
        else ilsLayerRef.current.setStyle({ color: '#3b82f6', opacity: 1.0, weight: 5 });
    }
  }, [isSelectedPlaneEstablished]);

  const createWaypointIcon = (wp: any, isSnapped: boolean) => {
      // @ts-ignore
      return window.L.divIcon({
          className: 'bg-transparent border-none',
          html: `
            <div class="relative flex flex-col items-center justify-center transition-all duration-200 ${isSnapped ? 'scale-125 z-50' : ''}">
                ${isSnapped ? '<div class="absolute w-12 h-12 rounded-full border-2 border-cyan-400 animate-pulse bg-cyan-900/30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"></div>' : ''}
                ${wp.type === 'VOR' ? 
                    `<svg width="18" height="18" viewBox="0 0 24 24" class="${isSnapped ? 'text-cyan-400' : 'text-slate-400'} stroke-current stroke-[2px] fill-slate-900/50"><path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z" /><circle cx="12" cy="12" r="2" class="fill-current" /></svg>` : 
                 wp.type === 'FIX' ? 
                    `<svg width="10" height="10" viewBox="0 0 24 24" class="${isSnapped ? 'text-cyan-400' : 'text-slate-600'} fill-current opacity-80"><path d="M12 4L4 20h16z" /></svg>` :
                    `<div class="w-4 h-4 border-2 border-slate-300 bg-slate-900/30"></div>`
                }
                <div class="mt-1 text-[10px] font-mono font-bold whitespace-nowrap tracking-wider drop-shadow-md ${isSnapped ? 'text-cyan-300 scale-110' : 'text-slate-400'}">${wp.name}</div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20] 
      });
  };

  useEffect(() => {
    const interval = setInterval(() => { setSweepAngle((prev) => (prev + 1.5) % 360); }, 20);
    return () => clearInterval(interval);
  }, []);

  const project = (lat: number, lon: number) => {
      if (!mapInstanceRef.current) return { x: 0, y: 0 };
      // @ts-ignore
      const point = mapInstanceRef.current.latLngToContainerPoint([lat, lon]);
      return { x: point.x, y: point.y };
  };

  useEffect(() => {
      const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
          if (!isDragging || !dragStartPos || !mapContainerRef.current) return;
          let clientX, clientY;
          if ('touches' in e) { clientX = (e as TouchEvent).touches[0].clientX; clientY = (e as TouchEvent).touches[0].clientY; } 
          else { clientX = (e as MouseEvent).clientX; clientY = (e as MouseEvent).clientY; }
          const rect = mapContainerRef.current.getBoundingClientRect();
          const x = clientX - rect.left;
          const y = clientY - rect.top;
          setDragCurrentPos({ x, y });
          let foundSnap = null;
          for (const wp of airport.waypoints) {
              const wpPos = project(wp.location.lat, wp.location.lon);
              const dist = Math.sqrt(Math.pow(x - wpPos.x, 2) + Math.pow(y - wpPos.y, 2));
              if (dist < 40) { foundSnap = wp.name; break; }
          }
          if (foundSnap) {
              setSnappedWaypoint(foundSnap);
              setDragHeading(null);
              onRadarInteraction({ directTo: foundSnap });
          } else {
              setSnappedWaypoint(null);
              const dx = x - dragStartPos.x;
              const dy = y - dragStartPos.y;
              const angleRad = Math.atan2(dy, dx);
              let angleDeg = angleRad * 180 / Math.PI;
              let compassHeading = (angleDeg + 90) % 360;
              if (compassHeading < 0) compassHeading += 360;
              const newHeading = Math.round(compassHeading);
              setDragHeading(newHeading);
              onRadarInteraction({ heading: newHeading });
          }
      };
      const handleGlobalUp = () => {
          if (isDragging) {
              setIsDragging(false);
              setDragStartPos(null);
              setDragCurrentPos(null);
              setDragHeading(null);
              setSnappedWaypoint(null);
          }
      };
      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);
      window.addEventListener('touchmove', handleGlobalMove, { passive: false });
      window.addEventListener('touchend', handleGlobalUp);
      return () => {
          window.removeEventListener('mousemove', handleGlobalMove);
          window.removeEventListener('mouseup', handleGlobalUp);
          window.removeEventListener('touchmove', handleGlobalMove);
          window.removeEventListener('touchend', handleGlobalUp);
      }
  }, [isDragging, dragStartPos, onRadarInteraction, airport.waypoints]);

  const centerPos = project(airport.location.lat, airport.location.lon);

  const handlePlaneStart = (e: React.MouseEvent | React.TouchEvent, planeId: string, pos: {x: number, y: number}) => {
      e.stopPropagation(); 
      onSelectAircraft(planeId);
      setIsDragging(true);
      setDragStartPos(pos);
      setDragCurrentPos(pos);
  };

  const calculatePath = (startLat: number, startLon: number, startHdg: number, targetHdg: number, speedKnots: number) => {
    const points: string[] = [];
    let currentLat = startLat;
    let currentLon = startLon;
    let currentHdg = startHdg;
    const tickDurationHours = 0.2 / 3600; 
    let limit = 1500; 
    for (let i = 0; i < limit; i++) {
        if (i % 10 === 0) { const p = project(currentLat, currentLon); points.push(`${p.x},${p.y}`); }
        let diff = targetHdg - currentHdg;
        if (diff < -180) diff += 360;
        if (diff > 180) diff -= 360;
        if (Math.abs(diff) < TURN_RATE_PER_TICK) currentHdg = targetHdg;
        else currentHdg += Math.sign(diff) * TURN_RATE_PER_TICK;
        currentHdg = (currentHdg + 360) % 360;
        const distNM = speedKnots * tickDurationHours * SIM_SPEED_FACTOR;
        const distDeg = distNM / 60;
        const radHdg = currentHdg * Math.PI / 180;
        const dLat = distDeg * Math.cos(radHdg);
        const dLon = distDeg * Math.sin(radHdg) / Math.cos(currentLat * Math.PI / 180);
        currentLat += dLat;
        currentLon += dLon;
        if (currentHdg === targetHdg) {
            const remainingTicks = 4000; 
            const finalDistNM = speedKnots * (remainingTicks * 0.2 / 3600);
            const finalDistDeg = finalDistNM / 60;
            const finalLat = currentLat + finalDistDeg * Math.cos(radHdg);
            const finalLon = currentLon + finalDistDeg * Math.sin(radHdg) / Math.cos(currentLat * Math.PI / 180);
            const pEnd = project(finalLat, finalLon);
            points.push(`${pEnd.x},${pEnd.y}`);
            break;
        }
    }
    return points.join(' ');
  };

  let directToLineCoords = null;
  let curvedPathPoints = null;

  if (selectedPlane) {
      if (pendingUpdates?.directTo) {
        const wp = airport.waypoints.find(w => w.name === pendingUpdates.directTo);
        if (wp) {
            const start = project(selectedPlane.position.lat, selectedPlane.position.lon);
            const end = project(wp.location.lat, wp.location.lon);
            directToLineCoords = { start, end };
        }
      } else if (pendingUpdates?.heading !== null || (isDragging && dragHeading !== null)) {
        const targetH = isDragging && dragHeading !== null ? dragHeading : (pendingUpdates?.heading !== null ? pendingUpdates.heading : null);
        if (targetH !== null && Math.abs(targetH - selectedPlane.heading) > 1) {
            curvedPathPoints = calculatePath(selectedPlane.position.lat, selectedPlane.position.lon, selectedPlane.heading, targetH, selectedPlane.speed);
        }
      }
  }

  return (
    <div className="relative w-full h-full bg-black overflow-hidden shadow-2xl rounded-lg border border-slate-800 cursor-crosshair touch-none">
      <div ref={mapContainerRef} className="absolute inset-0 z-0"></div>
      
      {/* Selector de Opacidad - Movido a esquina inferior izquierda */}
      <div className="absolute bottom-4 left-4 z-50 flex items-center gap-2 bg-slate-900/80 p-2 rounded border border-slate-700 pointer-events-auto">
        <span className="text-[9px] text-slate-400 font-mono">MAPA</span>
        <input type="range" min="0" max="1" step="0.1" value={mapOpacity} onChange={(e) => setMapOpacity(parseFloat(e.target.value))} className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
      </div>

      <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-1 pointer-events-auto">
        <button className="w-8 h-8 bg-slate-800 text-slate-300 border border-slate-600 rounded hover:bg-slate-700 flex items-center justify-center font-bold" onClick={() => mapInstanceRef.current?.zoomIn()}>+</button>
        <button className="w-8 h-8 bg-slate-800 text-slate-300 border border-slate-600 rounded hover:bg-slate-700 flex items-center justify-center font-bold" onClick={() => mapInstanceRef.current?.zoomOut()}>-</button>
      </div>

      <div className="absolute inset-0 z-25 pointer-events-none overflow-hidden">
          <svg className="w-full h-full">
            {curvedPathPoints && !snappedWaypoint && (
                <polyline points={curvedPathPoints} fill="none" stroke="#facc15" strokeWidth="3" strokeDasharray="8,6" opacity="1" />
            )}
            {directToLineCoords && (
                <line x1={directToLineCoords.start.x} y1={directToLineCoords.start.y} x2={directToLineCoords.end.x} y2={directToLineCoords.end.y} stroke={snappedWaypoint ? "#22d3ee" : "#facc15"} strokeWidth="3" strokeDasharray={snappedWaypoint ? "0" : "8,6"} />
            )}
          </svg>
          {isDragging && dragCurrentPos && (
              <div className={`absolute rounded px-2 py-1 text-xs font-bold font-mono border ${snappedWaypoint ? 'bg-cyan-900/90 text-cyan-400 border-cyan-500' : 'bg-slate-900/80 text-yellow-400 border-yellow-500'}`} style={{ left: dragCurrentPos.x + 15, top: dragCurrentPos.y + 15 }}>{snappedWaypoint ? `DIRECTO A ${snappedWaypoint}` : `${dragHeading}°`}</div>
          )}
      </div>

      <div className="absolute inset-0 z-30 pointer-events-none">
          {aircraft.map((plane) => {
            if (plane.status === FlightStatus.LANDED || plane.status === FlightStatus.CRASHED) return null;
            const pos = project(plane.position.lat, plane.position.lon);
            const isSelected = plane.id === selectedAircraftId;
            const isEmergency = plane.status === FlightStatus.LOST_SEPARATION || plane.proximityAlert === 'CRITICAL';
            const isWarning = plane.proximityAlert === 'WARNING';
            const isOnILS = plane.establishedOnILS;
            const hasSquawk7700 = plane.squawk === '7700';
            let navLabel = null;
            let navColor = "text-emerald-400";

            if (hasSquawk7700) { navLabel = "SQ 7700"; navColor = "text-red-500 animate-pulse"; } 
            else if (plane.squawk === '7600') { navLabel = "SQ 7600"; navColor = "text-orange-500 animate-pulse"; } 
            else if (isSelected && pendingUpdates?.directTo) { navLabel = `→${pendingUpdates.directTo}`; navColor = "text-yellow-400"; } 
            else if (plane.currentDirectTo && !plane.clearedForILS) { navLabel = `→${plane.currentDirectTo}`; navColor = "text-orange-400"; } 
            else if (isOnILS) { navLabel = `LOC LOCK`; navColor = "text-cyan-400"; } 
            else if (plane.clearedForILS) { navLabel = `ILS ARM`; navColor = "text-blue-400"; } 
            else { navLabel = `H ${Math.round(plane.heading).toString().padStart(3,'0')}`; navColor = "text-slate-400"; }

            if (pos.x < -100 || pos.y < -100 || pos.x > window.innerWidth + 100 || pos.y > window.innerHeight + 100) return null;

            return (
              <React.Fragment key={plane.id}>
                {isSelected && plane.history && plane.history.map((histPos, idx) => {
                    const hPos = project(histPos.lat, histPos.lon);
                    return (<div key={idx} className="absolute w-[2px] h-[2px] bg-emerald-500/40 rounded-full pointer-events-none" style={{ left: hPos.x, top: hPos.y }} />);
                })}
                <div onMouseDown={(e) => handlePlaneStart(e, plane.id, pos)} onTouchStart={(e) => handlePlaneStart(e, plane.id, pos)} onClick={(e) => { e.stopPropagation(); }} className="absolute cursor-pointer group pointer-events-auto" style={{ left: pos.x, top: pos.y }}>
                    <div className="absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 bg-transparent z-10" />
                    {plane.tutorialHint && score < 10 && (
                        <div className="absolute -top-16 left-8 bg-blue-600 text-white text-[12px] font-bold px-3 py-2 rounded shadow-xl whitespace-nowrap z-50 animate-bounce border-2 border-white">{plane.tutorialHint}<div className="absolute top-full left-0 w-0 h-0 border-t-[8px] border-t-white border-r-[8px] border-r-transparent"></div></div>
                    )}
                    <div className={`absolute w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm z-20 ${hasSquawk7700 ? 'bg-red-500 animate-ping' : plane.squawk === '7600' ? 'bg-orange-500' : isEmergency ? 'bg-red-500 animate-pulse' : 'bg-emerald-400'}`} />
                    {isWarning && (<div className="absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 border border-orange-500 rounded-full animate-pulse opacity-80 z-10 shadow-[0_0_10px_rgba(249,115,22,0.6)]" />)}
                    {isEmergency && (<div className="absolute w-16 h-16 -translate-x-1/2 -translate-y-1/2 border-2 border-red-600 rounded-full animate-ping opacity-100 z-10" />)}
                    {isSelected && (<><div className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 border border-emerald-300 opacity-80 z-10" /><div className="absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2 border border-yellow-400 rounded-full opacity-100 z-10 animate-pulse shadow-[0_0_10px_rgba(250,204,21,0.5)]" /></>)}
                    <div className={`absolute top-0 left-0 h-[1px] origin-left pointer-events-none ${isSelected ? 'w-[80px] bg-white opacity-80' : 'w-[40px] bg-emerald-500/50'}`} style={{ transform: `rotate(${plane.heading - 90}deg)` }} />
                    <div className={`absolute left-3 -top-4 text-[11px] font-mono leading-none whitespace-nowrap pointer-events-none select-none z-30 ${isEmergency || hasSquawk7700 ? 'text-red-500 font-bold' : isWarning ? 'text-orange-400 font-bold' : 'text-[#4ade80] drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]'}`}>
                        <div className="font-bold mb-0.5">{plane.callsign}</div>
                        <div className="flex gap-2"><span>{Math.floor(plane.altitude / 100).toString().padStart(3,'0')}{plane.targetAltitude !== plane.altitude && (<span className="text-[9px] align-top text-emerald-200">{plane.targetAltitude > plane.altitude ? '↑' : '↓'}</span>)}</span><span>{Math.floor(plane.speed / 10).toString().padStart(2,'0')}</span></div>
                        <div className={`font-bold ${isEmergency || hasSquawk7700 ? 'text-red-500' : isWarning ? 'text-orange-400' : navColor}`}>{navLabel}</div>
                    </div>
                </div>
              </React.Fragment>
            );
          })}
      </div>
      
      <div className="absolute rounded-full pointer-events-none z-20" style={{ width: radarPixelRadius * 2, height: radarPixelRadius * 2, left: centerPos.x - radarPixelRadius, top: centerPos.y - radarPixelRadius, background: 'radial-gradient(circle, rgba(16,185,129,0) 0%, rgba(16,185,129,0.0) 40%, rgba(16,185,129,0.05) 60%, rgba(16,185,129,0) 70%)' }}>
           <div className="absolute top-1/2 left-1/2 w-1/2 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/20 to-emerald-500/80 origin-left" style={{ transform: `translate(0, -50%) rotate(${sweepAngle - 90}deg)`, boxShadow: "0 0 15px 1px rgba(16, 185, 129, 0.4)" }} />
      </div>
    </div>
  );
};
export default RadarScreen;
