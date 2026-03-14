
import React, { useState, useEffect, useRef, useCallback } from 'react';
import RadarScreen from './components/RadarScreen';
import ControlPanel from './components/ControlPanel';
import { Aircraft, Airport, FlightStatus, GameState, RadioMessage, Waypoint, PendingUpdates, AlternateAirport } from './types';

// Constants
const GAME_LOOP_MS = 200; 
const NM_TO_DEG_LAT = 1 / 60; // 1 degree lat = 60NM
const COLLISION_NM = 3.0; // 3NM separation standard
const WARNING_NM = 5.0; // 5NM warning
const SPAWN_SEPARATION_NM = 15.0; // Adjusted for better flow
const SEPARATION_ALT_THRESHOLD = 900; // Feet
const TRAIL_UPDATE_TICKS = 20; // Update trail every ~4 seconds (20 * 200ms)

// Physics Constants - REALISM TUNING
const TURN_RATE_PER_TICK = 0.60; // Increased to ~3 deg/sec (Standard Rate Turn)
const CLIMB_RATE_PER_TICK = 8; // ft per tick (~2400 fpm)
const SPEED_RATE_PER_TICK = 0.3; // knots per tick
const PILOT_REACTION_DELAY_TICKS = 10; // ~2 seconds delay before executing turn

// Airline Mapping for Audio
const AIRLINE_NAMES: Record<string, string> = {
  'AMX': 'Aeroméxico',
  'VOI': 'Volaris',
  'VIV': 'Viva Aerobus',
  'DAL': 'Delta',
  'UAL': 'United',
  'AAL': 'American',
  'CMP': 'Copa',
  'AVA': 'Avianca',
  'IBE': 'Iberia',
  'LRC': 'Lacsa',
  'KLM': 'KLM',
  'AFR': 'Air France',
  'DLH': 'Lufthansa',
  'JBU': 'JetBlue',
  'SLI': 'Costera',
  'GMT': 'Magnicharters',
  'TAO': 'Aeromar',
  'BAW': 'Speedbird',
  'UAE': 'Emirates'
};

const getSpokenCallsign = (callsign: string) => {
  const code = callsign.substring(0, 3).toUpperCase();
  const number = callsign.substring(3);
  const name = AIRLINE_NAMES[code] || code.split('').join(' '); 
  return `${name} ${number}`;
};

// Local Flight Generator (Replaces Gemini)
const GENERATOR_DATA: Record<string, { airlines: string[], models: string[] }> = {
    'MMMX': {
        airlines: ['AMX', 'VOI', 'VIV', 'DAL', 'UAL', 'AAL', 'IBE', 'LRC', 'KLM', 'DLH', 'AFR', 'BAW', 'UAE', 'AVA', 'CMP'],
        models: ['B737', 'A320', 'B787', 'A350', 'B777', 'A321', 'B738']
    },
    'MMGL': {
        airlines: ['AMX', 'VOI', 'VIV', 'DAL', 'UAL', 'AAL', 'TAR', 'SLI'],
        models: ['B737', 'A320', 'E190', 'A319', 'A321']
    }
};

const generateLocalFlight = (airportCode: string): Partial<Aircraft> => {
    const data = GENERATOR_DATA[airportCode] || GENERATOR_DATA['MMMX'];
    const airline = data.airlines[Math.floor(Math.random() * data.airlines.length)];
    const model = data.models[Math.floor(Math.random() * data.models.length)];
    const number = Math.floor(Math.random() * 900) + 100;
    
    return {
        callsign: `${airline}${number}`,
        model: model,
        airline: AIRLINE_NAMES[airline] || airline
    };
};

// Helper: Haversine distance in NM
function getDistanceNM(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 3440.065; // Earth radius in NM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Helper: Calculate bearing
function getBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// Helper: Calculate destination point given distance and bearing
function getDestinationPoint(lat: number, lon: number, brng: number, distNM: number) {
    const R = 3440.065; // Radius of the Earth in NM
    const d = distNM / R;  // angular distance in radians
    const brngRad = brng * Math.PI / 180;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    const lat2 = Math.asin(Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(brngRad));
    const lon2 = lonRad + Math.atan2(Math.sin(brngRad) * Math.sin(d) * Math.cos(latRad), Math.cos(d) - Math.sin(latRad) * Math.sin(lat2));

    return {
        lat: lat2 * 180 / Math.PI,
        lon: lon2 * 180 / Math.PI
    };
}

const AIRPORTS: Airport[] = [
  {
    code: 'MMMX',
    name: 'Ciudad de México (AICM)',
    runwayName: '05 Derecha',
    location: { lat: 19.4361, lon: -99.0719 },
    difficulty: 'Difícil',
    runwayHeading: 60, // Adjusted to 60 to align with PLAZA
    spawnRate: 45000, // Adjusted to 45s
    initialZoom: 10,
    description: "Espacio aéreo complejo. Altitud de transición 18,500.",
    alternates: [
        { code: 'MMTO', name: 'Toluca', runwayName: '15', location: { lat: 19.3371, lon: -99.5660 }, runwayHeading: 150, ilsLengthNM: 12 },
        { code: 'MMPB', name: 'Puebla', runwayName: '17', location: { lat: 19.1581, lon: -98.3714 }, runwayHeading: 172, ilsLengthNM: 12 },
        { code: 'MMQT', name: 'Querétaro', runwayName: '09', location: { lat: 20.6173, lon: -100.1855 }, runwayHeading: 94, ilsLengthNM: 12 }
    ],
    waypoints: [
        { name: 'MEX', type: 'VOR', location: { lat: 19.4361, lon: -99.0719 }, isEntry: false },
        { name: 'PTJ', type: 'VOR', location: { lat: 19.7892, lon: -99.8000 }, isEntry: true }, // Pasteje
        { name: 'PBC', type: 'VOR', location: { lat: 19.1622, lon: -98.3742 }, isEntry: true }, // Puebla
        { name: 'SLM', type: 'VOR', location: { lat: 19.7544, lon: -99.0183 }, isEntry: true }, // Santa Lucia
        { name: 'TLC', type: 'VOR', location: { lat: 19.2880, lon: -99.5670 }, isEntry: false }, // Toluca
        { name: 'MATEO', type: 'VOR', location: { lat: 19.5557, lon: -99.2283 }, isEntry: false }, // San Mateo (Formerly SMO)
        { name: 'APN', type: 'VOR', location: { lat: 19.7120, lon: -98.4690 }, isEntry: false }, // Apan
        { name: 'PLAZA', type: 'FIX', location: { lat: 19.3937, lon: -99.1494 }, isEntry: false }, // Approach Fix
        { name: 'SUTAS', type: 'FIX', location: { lat: 19.4287, lon: -99.2560 }, isEntry: false }, // Final Fix
        { name: 'URNOK', type: 'FIX', location: { lat: 19.1779, lon: -99.0119 }, isEntry: false }, // Approach Fix
    ]
  },
  {
    code: 'MMGL',
    name: 'Guadalajara (GDL)',
    runwayName: '10',
    location: { lat: 20.5218, lon: -103.3112 },
    difficulty: 'Fácil',
    runwayHeading: 100, // Runway 10
    spawnRate: 12000,
    initialZoom: 9,
    description: "Tráfico moderado.",
    alternates: [],
    waypoints: [
        { name: 'GDL', type: 'VOR', location: { lat: 20.5218, lon: -103.3112 }, isEntry: false },
        { name: 'ZAP', type: 'VOR', location: { lat: 20.8000, lon: -103.5000 }, isEntry: true }, 
        { name: 'AGS', type: 'VOR', location: { lat: 21.8000, lon: -102.3000 }, isEntry: true },
    ]
  }
];

// Offline Response Generator
const generateOfflinePilotResponse = (text: string, aircraft: Aircraft, airport: Airport | null): { updates: Partial<Aircraft>, response: string } => {
    const t = text.toLowerCase();
    const updates: Partial<Aircraft> = {};
    const parts = [];

    // Parse Heading
    // Supports: "rumbo 120", "rumba 120"
    const hdgMatch = t.match(/rumb[oa]\s+(\d+)/);
    if (hdgMatch) {
        const val = parseInt(hdgMatch[1]);
        updates.targetHeading = val;
        parts.push(`virando rumbo ${val}`);
        updates.clearedForILS = false;
        updates.establishedOnILS = false;
        updates.currentDirectTo = null;
    }

    // Parse Direct To
    const directMatch = t.match(/directo a ([a-zA-Z0-9]+)/);
    if (directMatch) {
        const wpName = directMatch[1];
        let foundWp: Waypoint | undefined;
        
        if (airport) {
            foundWp = airport.waypoints.find(w => w.name.toLowerCase() === wpName.toLowerCase());
        }

        if (foundWp) {
            const bearing = getBearing(aircraft.position.lat, aircraft.position.lon, foundWp.location.lat, foundWp.location.lon);
            updates.targetHeading = Math.round(bearing);
            updates.clearedForILS = false;
            updates.establishedOnILS = false;
            updates.currentDirectTo = foundWp.name;
            parts.push(`procediendo directo a ${foundWp.name}`);
        } else {
             parts.push(`directo a... punto no encontrado`);
        }
    }

    // Parse Altitude
    const altMatch = t.match(/nivel\s+(?:de\s+)?(?:vuelo\s+)?(\d+)/);
    if (altMatch) {
        const val = parseInt(altMatch[1]);
        updates.targetAltitude = val;
        if (val > aircraft.altitude) parts.push(`ascendiendo nivel ${val}`);
        else parts.push(`descendiendo nivel ${val}`);
        updates.clearedForILS = false;
    }

    // Parse Speed
    const spdMatch = t.match(/(?:velocidad\s+(?:a\s+)?|nudos\s+)(\d+)/);
    if (spdMatch) {
        const val = parseInt(spdMatch[1]);
        updates.targetSpeed = val;
        parts.push(`velocidad ${val} nudos indicados`);
    }

    // Parse ILS / Landing
    if (t.includes('autorizado aproximación ils') || t.includes('autorizado para aterrizar')) {
        updates.clearedForILS = true;
        updates.currentDirectTo = null;
        
        // Smart phraseology: Detect if close to alternate
        let runway = airport ? airport.runwayName : 'activa';
        if (airport && airport.alternates) {
            const distToMain = getDistanceNM(aircraft.position.lat, aircraft.position.lon, airport.location.lat, airport.location.lon);
            let closestAltDist = distToMain;
            
            for (const alt of airport.alternates) {
                const d = getDistanceNM(aircraft.position.lat, aircraft.position.lon, alt.location.lat, alt.location.lon);
                if (d < closestAltDist && d < 20) {
                    closestAltDist = d;
                    runway = `${alt.name} pista ${alt.runwayName}`;
                }
            }
        }
        
        parts.push(`autorizado para aterrizar ILS ${runway}`);
    } else if (t.includes('cancele aproximación')) {
        updates.clearedForILS = false;
        parts.push("cancelando aproximación");
    }

    const spokenCallsign = getSpokenCallsign(aircraft.callsign);
    
    let responseText = "";
    if (parts.length > 0) {
        const instructionText = parts.join(', ');
        responseText = `${instructionText.charAt(0).toUpperCase() + instructionText.slice(1)}, ${spokenCallsign}.`;
    } else {
        responseText = `No le copié, repita instrucción, ${spokenCallsign}.`;
    }

    return { updates, response: responseText };
};

// Generate realistic Volcanic Ash Cone for Popocatépetl
const generateAshCloud = (windDir: number) => {
    const POPO_LAT = 19.0228;
    const POPO_LON = -98.6278;
    
    // Cone spreads out with wind
    // Length: ~60 NM
    const length = 60;
    
    const p1 = { lat: POPO_LAT, lon: POPO_LON };
    
    // Cone width +/- 15 degrees from wind direction
    const dirLeft = (windDir - 15 + 360) % 360;
    const dirRight = (windDir + 15) % 360;
    
    const p2 = getDestinationPoint(POPO_LAT, POPO_LON, dirLeft, length);
    const p3 = getDestinationPoint(POPO_LAT, POPO_LON, dirRight, length);
    
    return {
        points: [p1, p2, p3],
        maxAltitude: 25000 // FL250
    };
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    isGameOver: false,
    level: null,
    score: 0,
    landedCount: 0,
    separationIncidents: 0,
    timeElapsed: 0,
    message: null,
    gameTier: 0,
    windSpeed: 5,
    windDirection: 60,
    weatherSeverity: 0, // Visual storm intensity
    runwayStatus: 'OPEN',
    closureReason: null,
    closureTimer: 0,
    ashCloud: null,
    tutorialCompleted: false,
    showTutorialPanel: true
  });

  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const aircraftRef = useRef<Aircraft[]>([]); 
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [radioHistory, setRadioHistory] = useState<RadioMessage[]>([]);
  const [isProcessingRadio, setIsProcessingRadio] = useState(false);
  
  // Scoring Refs to avoid stale closures
  const scoreRef = useRef(0);
  const landedRef = useRef(0);
  const incidentsRef = useRef(0);
  
  // Voice Settings State
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);

  // Audio Context for Alerts
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastAlertTime = useRef<number>(0);

  const lastSpawnTime = useRef<number>(0);
  const nextSpawnDelay = useRef<number>(0);
  const tickCount = useRef<number>(0);
  const gameTierRef = useRef(0);
  
  // Pending Updates State (Lifted from ControlPanel)
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdates>({
      heading: null,
      altitude: null,
      speed: null,
      directTo: null,
      clearedForILS: false
  });

  // Sync ref with state
  useEffect(() => {
    aircraftRef.current = aircraft;
  }, [aircraft]);

  // Load Voices
  useEffect(() => {
    const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        // Priority: Spanish voices, preferably Google (Neural)
        const spanishVoices = voices.filter(v => v.lang.toLowerCase().includes('es'));
        setAvailableVoices(spanishVoices);
        if (!selectedVoiceURI && spanishVoices.length > 0) {
            const mx = spanishVoices.find(v => v.lang === 'es-MX' && v.name.includes('Google'));
            if (mx) setSelectedVoiceURI(mx.voiceURI);
            else setSelectedVoiceURI(spanishVoices[0].voiceURI);
        }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const initAudio = () => {
      if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume();
      }
  };

  const playAlertSound = (type: 'WARNING' | 'CRITICAL') => {
      if (!audioContextRef.current || Date.now() - lastAlertTime.current < 800) return;
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'CRITICAL') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.1);
          osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
          osc.start();
          osc.stop(ctx.currentTime + 0.4);
      } else {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
      }
      lastAlertTime.current = Date.now();
  };

  const playRadarContactSound = () => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2000, ctx.currentTime); 
    gain.gain.setValueAtTime(0.05, ctx.currentTime); 
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15); 
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  };

  const playRadioBlip = () => {
    if (!audioContextRef.current) return;
    if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
    }
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  };

  // Reset pending updates
  useEffect(() => {
      if (selectedAircraftId) {
          const plane = aircraft.find(p => p.id === selectedAircraftId);
          if (plane) {
              setPendingUpdates({
                  heading: Math.round(plane.targetHeading),
                  altitude: Math.round(plane.targetAltitude),
                  speed: Math.round(plane.targetSpeed),
                  directTo: null,
                  clearedForILS: plane.clearedForILS
              });
          }
      } else {
          setPendingUpdates({
              heading: null,
              altitude: null,
              speed: null,
              directTo: null,
              clearedForILS: false
          });
      }
  }, [selectedAircraftId]);

  // Enhanced Natural TTS
  const speakOffline = (text: string, forcedVoiceURI?: string) => {
      window.speechSynthesis.cancel();
      let spokenText = text;
      // Phonetic corrections
      spokenText = spokenText.replace(/\bURNOK\b/g, "Urnok");
      spokenText = spokenText.replace(/\bSUTAS\b/g, "Sutas");
      spokenText = spokenText.replace(/\bMATEO\b/g, "Mateo");
      spokenText = spokenText.replace(/\bPLAZA\b/g, "Plaza");
      spokenText = spokenText.replace(/\bAPAN\b/g, "Apan");
      
      const utterance = new SpeechSynthesisUtterance(spokenText);
      let voice = null;
      
      // Try to find the requested voice, or a Google voice, or best available Spanish
      if (forcedVoiceURI) {
          voice = availableVoices.find(v => v.voiceURI === forcedVoiceURI);
      }
      if (!voice) {
          // Priority to "Google" voices as they are usually neural/better
          voice = availableVoices.find(v => v.lang.includes('es') && v.name.includes('Google'));
      }
      if (!voice && selectedVoiceURI) {
          voice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
      }
      if (!voice && availableVoices.length > 0) {
          voice = availableVoices[0];
      }

      if (voice) utterance.voice = voice;
      
      // Add slight random variation to pitch/rate if it's a pilot (implied by forcedVoiceURI usage)
      if (forcedVoiceURI) {
          // Generate a pseudo-random seed from the voiceURI length or characters
          const seed = forcedVoiceURI.length; 
          utterance.pitch = 0.9 + (seed % 4) * 0.05; // 0.9 to 1.1
          utterance.rate = 1.0 + (seed % 3) * 0.05; // 1.0 to 1.15
      } else {
          // ATC / System voice
          utterance.rate = 1.1; 
          utterance.pitch = 1.0;
      }
      
      window.speechSynthesis.speak(utterance);
  };

  // Helper to calculate spawn position
  const calculateSpawnPosition = (airport: Airport, entryPoint: Waypoint, distanceOffset: number = 0) => {
    const bearingOut = getBearing(airport.location.lat, airport.location.lon, entryPoint.location.lat, entryPoint.location.lon);
    const distToEntry = getDistanceNM(airport.location.lat, airport.location.lon, entryPoint.location.lat, entryPoint.location.lon);
    const spawnDist = distToEntry + 30.0 + distanceOffset; 
    const spawnPos = getDestinationPoint(airport.location.lat, airport.location.lon, bearingOut, spawnDist);
    const inboundHeading = (bearingOut + 180) % 360;
    return { spawnPos, inboundHeading };
  };

  const getSafeSpawnPoint = useCallback((airport: Airport, currentPlanes: Aircraft[]): Waypoint | null => {
    const entryPoints = airport.waypoints.filter(wp => wp.isEntry);
    const validEntryPoints = entryPoints.filter(wp => {
        const { spawnPos } = calculateSpawnPosition(airport, wp);
        const hasConflict = currentPlanes.some(p => {
             if (p.status === FlightStatus.LANDED) return false;
             const dist = getDistanceNM(spawnPos.lat, spawnPos.lon, p.position.lat, p.position.lon);
             return dist < SPAWN_SEPARATION_NM;
        });
        return !hasConflict;
    });
    if (validEntryPoints.length === 0) return null;
    const shuffled = [...validEntryPoints].sort(() => 0.5 - Math.random());
    return shuffled[0];
  }, []);

  const spawnPlane = useCallback((template: Partial<Aircraft>, airport: Airport, entryPoint: Waypoint, voiceURI?: string, distanceOffset: number = 0): Aircraft => {
    const { spawnPos, inboundHeading } = calculateSpawnPosition(airport, entryPoint, distanceOffset);
    return {
      id: Math.random().toString(36).substr(2, 9),
      callsign: template.callsign || 'UNK000',
      model: template.model || 'Unknown',
      airline: template.airline || 'Unknown',
      position: spawnPos,
      history: [],
      heading: inboundHeading,
      speed: 280, 
      altitude: 24000 + (Math.floor(Math.random()*4)*1000), 
      status: FlightStatus.INBOUND,
      targetAltitude: 24000, 
      targetHeading: inboundHeading,
      targetSpeed: 280,
      fuel: 100,
      turnDelay: 0,
      clearedForILS: false,
      establishedOnILS: false,
      currentDirectTo: null,
      voiceURI: voiceURI, 
      squawk: '1200',
      isTutorial: false 
    };
  }, []);

  const spawnRandomPlane = async (airport: Airport) => {
    if (aircraftRef.current.filter(p => p.status !== FlightStatus.LANDED).length >= 10) return;
    const safeWp = getSafeSpawnPoint(airport, aircraftRef.current);
    if (!safeWp) return;

    // Use Local Generator instead of Gemini
    let template = generateLocalFlight(airport.code);

    let uniqueCallsign = template.callsign || `MX${Math.floor(Math.random()*900)+100}`;
    let attempts = 0;
    while (aircraftRef.current.some(p => p.callsign === uniqueCallsign) && attempts < 20) {
        const match = uniqueCallsign.match(/^([A-Z]+)(\d+)$/);
        if (match) {
            const code = match[1];
            const newNum = Math.floor(Math.random() * 9000) + 100;
            uniqueCallsign = `${code}${newNum}`;
        } else {
             uniqueCallsign = `MX${Math.floor(Math.random()*9000)+100}`;
        }
        attempts++;
    }
    template.callsign = uniqueCallsign;

    let randomVoiceURI = undefined;
    const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().includes('es'));
    if (voices.length > 0) {
        // Filter for Google voices if possible for better quality
        const googleVoices = voices.filter(v => v.name.includes('Google'));
        const pool = googleVoices.length > 0 ? googleVoices : voices;
        const randomVoice = pool[Math.floor(Math.random() * pool.length)];
        randomVoiceURI = randomVoice.voiceURI;
    }

    const newPlane = spawnPlane(template, airport, safeWp, randomVoiceURI);
    setAircraft(prev => [...prev, newPlane]);
    playRadarContactSound();

    const date = new Date();
    const hour = date.getHours();
    let greeting = 'Buenas noches, Torre México';
    if (hour >= 5 && hour < 12) greeting = 'Buenos días, Torre México';
    else if (hour >= 12 && hour < 19) greeting = 'Torre México, Buenas tardes';
    const spokenCallsign = getSpokenCallsign(newPlane.callsign);
    speakOffline(`${greeting}, ${spokenCallsign}, contacto radar.`, randomVoiceURI);
  };

  const startLevel = async (airport: Airport) => {
    initAudio(); 
    scoreRef.current = 0;
    landedRef.current = 0;
    incidentsRef.current = 0;
    gameTierRef.current = 0;
    setLoading(true);
    
    // Generate initial traffic locally
    let flightTemplates: Partial<Aircraft>[] = [];
    for(let i=0; i<3; i++) {
        flightTemplates.push(generateLocalFlight(airport.code));
    }

    setLoading(false);
    setGameState({
      isPlaying: true,
      isGameOver: false,
      level: airport,
      score: 0.0,
      landedCount: 0,
      separationIncidents: 0,
      timeElapsed: 0,
      message: `Torre ${airport.code} operativa. Monitoreando frecuencia 118.1.`,
      gameTier: 0,
      windSpeed: 5,
      windDirection: 60,
      weatherSeverity: 0,
      runwayStatus: 'OPEN',
      closureReason: null,
      closureTimer: 0,
      ashCloud: null,
      tutorialCompleted: false,
      showTutorialPanel: true
    });
    setRadioHistory([]);
    
    const initialPlanes: Aircraft[] = [];
    const entryPoints = airport.waypoints.filter(w => w.isEntry);
    const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().includes('es'));
    const shuffledEntryPoints = [...entryPoints].sort(() => 0.5 - Math.random());

    for (let i = 0; i < flightTemplates.length; i++) {
        const tmpl = flightTemplates[i];
        let wp = shuffledEntryPoints[i % shuffledEntryPoints.length];
        
        // Voice Selection
        let randomVoiceURI = undefined;
        if (voices.length > 0) {
            const googleVoices = voices.filter(v => v.name.includes('Google'));
            const pool = googleVoices.length > 0 ? googleVoices : voices;
            const randomVoice = pool[Math.floor(Math.random() * pool.length)];
            randomVoiceURI = randomVoice.voiceURI;
        }

        if (i === 0 && airport.code === 'MMMX') {
            const mateoFix = airport.waypoints.find(w => w.name === 'MATEO');
            if (mateoFix) {
                const startLat = mateoFix.location.lat;
                const startLon = mateoFix.location.lon;
                const tutorialSpawn = getDestinationPoint(startLat, startLon, 315, 12);
                const tutorialPlane: Aircraft = {
                    id: Math.random().toString(36).substr(2, 9),
                    callsign: tmpl.callsign || 'AMX543',
                    model: 'B737',
                    airline: 'Aeromexico',
                    position: tutorialSpawn,
                    history: [],
                    heading: 135,
                    speed: 240, 
                    altitude: 12000, 
                    status: FlightStatus.INBOUND,
                    targetAltitude: 12000,
                    targetHeading: 135,
                    targetSpeed: 240,
                    fuel: 100,
                    turnDelay: 0,
                    clearedForILS: false,
                    establishedOnILS: false,
                    currentDirectTo: null, 
                    voiceURI: randomVoiceURI,
                    squawk: '1200',
                    isTutorial: true 
                };
                initialPlanes.push(tutorialPlane);
                continue; 
            }
        }

        if (wp) {
             let uniqueCallsign = tmpl.callsign || `MX${Math.floor(Math.random()*999)}`;
             let attempts = 0;
             const isDuplicate = (cs: string) => 
                initialPlanes.some(p => p.callsign === cs) || 
                aircraftRef.current.some(p => p.callsign === cs);

             while (isDuplicate(uniqueCallsign) && attempts < 20) {
                const match = uniqueCallsign.match(/^([A-Z]+)(\d+)$/);
                if (match) {
                    const code = match[1];
                    const newNum = Math.floor(Math.random() * 9000) + 100;
                    uniqueCallsign = `${code}${newNum}`;
                } else {
                     uniqueCallsign = `MX${Math.floor(Math.random()*9000)+100}`;
                }
                attempts++;
             }
             tmpl.callsign = uniqueCallsign;
             const newPlane = spawnPlane(tmpl, airport, wp, randomVoiceURI, i * 15);
             initialPlanes.push(newPlane);
        }
    }
    setAircraft(initialPlanes);
    lastSpawnTime.current = Date.now();
    nextSpawnDelay.current = airport.spawnRate; 
  };

  const handleUpdateAircraft = (id: string, updates: Partial<Aircraft>) => {
    setAircraft(prev => prev.map(p => {
        if (p.id !== id) return p;
        let newTurnDelay = p.turnDelay;
        if (updates.targetHeading !== undefined && Math.abs(updates.targetHeading - p.targetHeading) > 1) {
            newTurnDelay = PILOT_REACTION_DELAY_TICKS;
        }
        return { ...p, ...updates, turnDelay: newTurnDelay };
    }));
  };

  const handleSendCommand = (text: string) => {
    if (!selectedAircraftId) return;
    const selectedPlane = aircraft.find(p => p.id === selectedAircraftId);
    if (!selectedPlane) return;
    const atcMessage: RadioMessage = { id: Date.now().toString(), sender: 'ATC', text: text, timestamp: Date.now() };
    setRadioHistory(prev => [...prev, atcMessage]);
    setIsProcessingRadio(true);
    if (selectedPlane.squawk === '7600') {
        setTimeout(() => { setIsProcessingRadio(false); }, 2000);
        return;
    }
    setTimeout(() => {
        const offlineData = generateOfflinePilotResponse(text, selectedPlane, gameState.level);
        handleUpdateAircraft(selectedPlane.id, offlineData.updates);
        const pilotMessage: RadioMessage = { id: (Date.now() + 1).toString(), sender: 'PILOT', callsign: selectedPlane.callsign, text: offlineData.response, timestamp: Date.now() };
        setRadioHistory(prev => [...prev, pilotMessage]);
        speakOffline(offlineData.response, selectedPlane.voiceURI);
        setIsProcessingRadio(false);
    }, 600); 
  };

  const handleRadarInteraction = (updates: { heading?: number | null, directTo?: string | null }) => {
      setPendingUpdates(prev => ({
          ...prev,
          heading: updates.heading !== undefined ? updates.heading : (updates.directTo ? null : prev.heading),
          directTo: updates.directTo !== undefined ? updates.directTo : (updates.heading ? null : prev.directTo),
          clearedForILS: false
      }));
  };

  const checkForLevelProgression = (currentScore: number) => {
      const currentTier = gameTierRef.current;
      let newTier = currentTier;
      let notification = null;
      let newWeatherSeverity = 0;

      if (currentScore > 30 && currentTier < 3) {
          newTier = 3;
          notification = "¡NIVEL 3! EMERGENCIAS ACTIVAS.";
      } else if (currentScore > 20 && currentTier < 2) {
          newTier = 2;
          notification = "¡NIVEL 2! ACTIVIDAD VOLCÁNICA POSIBLE.";
      } else if (currentScore > 10 && currentTier < 1) {
          newTier = 1;
          notification = "¡NIVEL 1! AEROPUERTOS ALTERNOS DISPONIBLES.";
      }

      if (currentScore > 10) {
          const progress = Math.min(1, (currentScore - 10) / 20); 
          newWeatherSeverity = progress * 0.7;
      }

      if (newTier !== currentTier) {
          gameTierRef.current = newTier;
          setGameState(prev => ({ ...prev, gameTier: newTier, message: notification, weatherSeverity: newWeatherSeverity }));
          if (notification) speakOffline(notification);
      } else if (Math.abs(newWeatherSeverity - gameState.weatherSeverity) > 0.05) {
          setGameState(prev => ({ ...prev, weatherSeverity: newWeatherSeverity }));
      }
  };
  
  const generateTutorialHints = (plane: Aircraft, airport: Airport): string | null => {
      if (plane.status === FlightStatus.LANDED || plane.status === FlightStatus.CRASHED) return null;
      if (!plane.isTutorial || gameState.tutorialCompleted) return null;
      const mateo = airport.waypoints.find(w => w.name === 'MATEO');
      const plaza = airport.waypoints.find(w => w.name === 'PLAZA');
      if (!mateo || !plaza) return null;
      const distToMateo = getDistanceNM(plane.position.lat, plane.position.lon, mateo.location.lat, mateo.location.lon);
      const distToPlaza = getDistanceNM(plane.position.lat, plane.position.lon, plaza.location.lat, plaza.location.lon);
      const distToAirport = getDistanceNM(plane.position.lat, plane.position.lon, airport.location.lat, airport.location.lon);

      if (distToMateo > 2 && plane.currentDirectTo !== 'MATEO' && distToPlaza > 10) {
          if (plane.altitude > 11000) return "DESCIENDA A 2000!";
          return "DIRECTO A MATEO!";
      }
      if (distToMateo < 5 && distToPlaza > 5) {
          if (plane.speed > 210) return "REDUZCA VELOCIDAD 200!";
          if (plane.currentDirectTo !== 'MATEO') return "DIRECTO A PLAZA";
          if (plane.altitude > 10000) return "DESCIENDA A 2000";
      }
      if (distToPlaza < 8 || (distToAirport < 20 && distToAirport > 5)) {
          if (plane.clearedForILS) return "ILS ARMADO (OK)";
          let angleDiff = Math.abs(plane.heading - airport.runwayHeading);
          if (angleDiff > 180) angleDiff = 360 - angleDiff;
          const bearingToAirport = getBearing(plane.position.lat, plane.position.lon, airport.location.lat, airport.location.lon);
          let bearingDiff = Math.abs(bearingToAirport - airport.runwayHeading);
          if (bearingDiff > 180) bearingDiff = 360 - bearingDiff;
          const lateralDist = Math.sin(bearingDiff * Math.PI / 180) * distToAirport;
          const bearingFromAirport = getBearing(airport.location.lat, airport.location.lon, plane.position.lat, plane.position.lon);
          const backCourse = (airport.runwayHeading + 180) % 360;
          let angleFromCenter = Math.abs(bearingFromAirport - backCourse);
          if (angleFromCenter > 180) angleFromCenter = 360 - angleFromCenter;

          if (lateralDist < 2.5) {
              if (angleDiff > 5) return `DIRECTO A MEX, ARME ILS!`;
              if (plane.altitude > 2100) return "BAJE A 2000";
              return "ARME ILS";
          } else {
              if (angleFromCenter < 16) return "INTERCEPTE (RUMBO 090)";
              else return "ACÉRCATE A LA ZONA DE CAPTURA ILS";
          }
      }
      return null;
  };
  
  const renderTutorialPanel = () => {
      if (!gameState.showTutorialPanel) return null;
      if (gameState.tutorialCompleted) {
          return (
            <div className="pointer-events-auto bg-emerald-900/95 border-l-4 border-emerald-400 p-4 rounded shadow-xl max-w-sm backdrop-blur-sm animate-fade-in mt-2 relative">
                <button 
                    onClick={() => setGameState(prev => ({...prev, showTutorialPanel: false}))}
                    className="absolute top-2 right-2 text-emerald-200 hover:text-white font-bold"
                >✕</button>
                <h3 className="text-emerald-300 font-bold text-sm mb-2 uppercase tracking-wider border-b border-emerald-700 pb-1">¡FELICIDADES!</h3>
                <p className="text-white text-xs leading-relaxed font-sans font-bold">Has completado el entrenamiento básico.</p>
                <p className="text-emerald-100 text-xs leading-relaxed font-sans mt-2">Ahora el control del espacio aéreo es tuyo. Te esperan muchos desafíos por delante. ¡Buena suerte!</p>
            </div>
          );
      }
      const selected = aircraft.find(a => a.id === selectedAircraftId);
      const mateo = gameState.level?.waypoints.find(w => w.name === 'MATEO');
      let phase = "INTRODUCCIÓN";
      let text = "Selecciona el avión 'Tutorial' para comenzar.";
      if (selected && mateo) {
          const distToMateo = getDistanceNM(selected.position.lat, selected.position.lon, mateo.location.lat, mateo.location.lon);
          const distToAirport = getDistanceNM(selected.position.lat, selected.position.lon, gameState.level!.location.lat, gameState.level!.location.lon);
          if (distToMateo > 5 && distToAirport > 20) {
              phase = "FASE 1: NAVEGACIÓN VOR";
              text = "Los hexágonos son VORs. Envía el avión 'Directo a MATEO' y desciende, debes dar la siguiente indicación al llegar al VOR o antes, si no lo haces el avión entrará en patrón de espera en esa ubicación.";
          } else if (distToAirport > 15) {
              phase = "FASE 2: NAVEGACIÓN DE ÁREA";
              text = "Los triángulos son FIXes. Al pasar MATEO, ve 'Directo a PLAZA' y reduce velocidad. PLAZA te servirá para alinear el vuelo con la linea de captura ILS";
          } else {
              phase = "FASE 3: APROXIMACIÓN ILS";
              text = "La LÍNEA AZUL es el ILS (Instrument Landing System). Vuela paralelo a ella (060°) y presiona 'ILS APP' para aterrizar en piloto automático.";
          }
      }
      return (
        <div className="pointer-events-auto bg-blue-900/90 border-l-4 border-cyan-400 p-4 rounded shadow-lg max-w-sm backdrop-blur-sm animate-fade-in mt-2">
            <h3 className="text-cyan-300 font-bold text-sm mb-1 uppercase tracking-wider border-b border-blue-700 pb-1">{phase}</h3>
            <p className="text-white text-xs leading-relaxed font-sans">{text}</p>
        </div>
      );
  };

  const processGameEvents = (tick: number, activePlanes: Aircraft[]) => {
      const tier = gameTierRef.current;
      const updates: Partial<GameState> = {};
      let updated = false;

      if (tier >= 1 && tick % 50 === 0) { 
          let newSpeed = gameState.windSpeed + (Math.random() > 0.5 ? 1 : -1);
          newSpeed = Math.max(5, Math.min(30, newSpeed));
          let newDir = gameState.windDirection + (Math.random() > 0.5 ? 5 : -5);
          newDir = (newDir + 360) % 360;
          updates.windSpeed = newSpeed;
          updates.windDirection = newDir;
          updated = true;
          
          // Update Ash Cloud if active
          if (gameState.ashCloud && tier >= 2) {
              updates.ashCloud = generateAshCloud(newDir);
          }
      }

      if (tier >= 2) {
          if (gameState.runwayStatus === 'CLOSED') {
              if (gameState.closureTimer <= 0) {
                  updates.runwayStatus = 'OPEN';
                  updates.closureReason = null;
                  updates.ashCloud = null; // Clear cloud
                  updates.message = "PISTA REABIERTA. OPERACIONES NORMALES.";
                  speakOffline("Pista reabierta. Operaciones normales.");
                  updated = true;
              } else {
                  updates.closureTimer = gameState.closureTimer - GAME_LOOP_MS;
                  updated = true;
              }
          } else if (Math.random() < 0.0001) { // Reduced frequency ~1/10000 ticks
              const reason = Math.random() > 0.3 ? "CENIZA VOLCÁNICA" : "SISMO LEVE";
              updates.runwayStatus = 'CLOSED';
              updates.closureReason = reason;
              updates.closureTimer = 120000; // 2 minutes closure (120,000 ms)
              
              if (reason === "CENIZA VOLCÁNICA") {
                   updates.ashCloud = generateAshCloud(gameState.windDirection);
              }
              
              const msg = `ALERTA: PISTA CERRADA POR ${reason}. REVISIÓN EN CURSO.`;
              updates.message = msg;
              speakOffline(msg);
              updated = true;

              activePlanes.forEach(p => {
                  // Only force Go Around if going to Main Airport ILS, not Alternates
                  const goingToAlternate = gameState.level?.alternates?.some(alt => getDistanceNM(p.position.lat, p.position.lon, alt.location.lat, alt.location.lon) < 15);
                  if (!goingToAlternate && (p.establishedOnILS || p.clearedForILS)) {
                       handleUpdateAircraft(p.id, {
                           clearedForILS: false,
                           establishedOnILS: false,
                           status: FlightStatus.GO_AROUND,
                           targetHeading: gameState.level!.runwayHeading,
                           targetAltitude: 2000,
                           targetSpeed: 200
                       });
                  }
              });
          }
      }

      if (tier >= 3 && tick % 100 === 0) { 
           if (Math.random() < 0.02) { 
               const candidates = activePlanes.filter(p => p.squawk === '1200' && p.status !== FlightStatus.LANDED);
               if (candidates.length > 0) {
                   const victim = candidates[Math.floor(Math.random() * candidates.length)];
                   const type = Math.random() > 0.7 ? '7700' : '7600'; 
                   handleUpdateAircraft(victim.id, { squawk: type });
                   if (type === '7700') {
                       speakOffline(`Mayday, mayday. ${getSpokenCallsign(victim.callsign)} declarando emergencia.`, victim.voiceURI);
                   }
               }
           }
      }
      if (updated) setGameState(prev => ({ ...prev, ...updates }));
  };

  useEffect(() => {
    if (!gameState.isPlaying || gameState.isGameOver || !gameState.level) return;
    const interval = setInterval(() => {
      tickCount.current += 1;
      if (Date.now() - lastSpawnTime.current > nextSpawnDelay.current) {
          spawnRandomPlane(gameState.level!);
          lastSpawnTime.current = Date.now();
          nextSpawnDelay.current = gameState.level!.spawnRate + (Math.random() * 5000);
      }

      // Process game events and progression outside of aircraft state update
      const currentActivePlanes = aircraftRef.current.filter(p => p.status !== FlightStatus.LANDED && p.status !== FlightStatus.CRASHED);
      checkForLevelProgression(scoreRef.current);
      processGameEvents(tickCount.current, currentActivePlanes);

      setAircraft(prevAircraft => {
        let highestAlert: 'NONE' | 'WARNING' | 'CRITICAL' = 'NONE';
        const activePlanes = prevAircraft.filter(p => p.status !== FlightStatus.LANDED && p.status !== FlightStatus.CRASHED);
        let tutorialJustCompleted = false;
        
        const alertMap = new Map<string, 'NONE' | 'WARNING' | 'CRITICAL'>();
        prevAircraft.forEach(p => alertMap.set(p.id, 'NONE'));
        for (let i = 0; i < prevAircraft.length; i++) {
            const p1 = prevAircraft[i];
            if (p1.status === FlightStatus.LANDED || p1.status === FlightStatus.CRASHED) continue;
            for (let j = i + 1; j < prevAircraft.length; j++) {
                const p2 = prevAircraft[j];
                if (p2.status === FlightStatus.LANDED || p2.status === FlightStatus.CRASHED) continue;
                const dist = getDistanceNM(p1.position.lat, p1.position.lon, p2.position.lat, p2.position.lon);
                const altDist = Math.abs(p1.altitude - p2.altitude);
                if (dist < COLLISION_NM && altDist < SEPARATION_ALT_THRESHOLD) {
                    alertMap.set(p1.id, 'CRITICAL');
                    alertMap.set(p2.id, 'CRITICAL');
                    highestAlert = 'CRITICAL';
                } else if (dist < WARNING_NM && altDist < SEPARATION_ALT_THRESHOLD) {
                    if (alertMap.get(p1.id) !== 'CRITICAL') alertMap.set(p1.id, 'WARNING');
                    if (alertMap.get(p2.id) !== 'CRITICAL') alertMap.set(p2.id, 'WARNING');
                    if (highestAlert !== 'CRITICAL') highestAlert = 'WARNING';
                }
            }
        }
        if (highestAlert === 'CRITICAL') playAlertSound('CRITICAL');
        else if (highestAlert === 'WARNING') playAlertSound('WARNING');

        const updatedAircraft = prevAircraft.map(plane => {
            if (plane.status === FlightStatus.LANDED || plane.status === FlightStatus.CRASHED) return plane;
            const airport = gameState.level!;
            let hdg = plane.heading;
            let alt = plane.altitude;
            let spd = plane.speed;
            let established = plane.establishedOnILS;
            let targetAlt = plane.targetAltitude;
            let targetSpd = plane.targetSpeed;
            let currentDelay = plane.turnDelay;
            let currentTargetHeading = plane.targetHeading;
            const distToAirport = getDistanceNM(plane.position.lat, plane.position.lon, airport.location.lat, airport.location.lon);
            
            // Check for Alternate Airport ILS capture
            let targetRunwayHeading = airport.runwayHeading;
            let targetLocation = airport.location;
            let isAlternate = false;

            if (plane.clearedForILS && !established) {
                // Check Main Airport (Only if OPEN)
                if (gameState.runwayStatus === 'OPEN') {
                    // Logic below
                } 
                // Check Alternates (Level 1+)
                if (airport.alternates && gameState.gameTier >= 1) {
                     for (const altAirport of airport.alternates) {
                         const d = getDistanceNM(plane.position.lat, plane.position.lon, altAirport.location.lat, altAirport.location.lon);
                         if (d < 20) {
                             targetRunwayHeading = altAirport.runwayHeading;
                             targetLocation = altAirport.location;
                             isAlternate = true;
                             break;
                         }
                     }
                }
            } else if (established) {
                // If established, we need to know WHERE. 
                // Simplified: Assume if established, they stay established on the current target path.
                // Re-calculating nearest airport to maintain heading
                 if (airport.alternates && gameState.gameTier >= 1) {
                     for (const altAirport of airport.alternates) {
                         const d = getDistanceNM(plane.position.lat, plane.position.lon, altAirport.location.lat, altAirport.location.lon);
                         if (d < 15) {
                             targetRunwayHeading = altAirport.runwayHeading;
                             targetLocation = altAirport.location;
                             isAlternate = true;
                             break;
                         }
                     }
                 }
            }

            if (plane.clearedForILS && !plane.establishedOnILS) {
                 // Capture Logic for determined target (Main or Alternate)
                 const canCaptureMain = !isAlternate && gameState.runwayStatus === 'OPEN';
                 
                 if (canCaptureMain || isAlternate) {
                    const dLon = (targetLocation.lon - plane.position.lon) * Math.PI / 180;
                    const lat1 = plane.position.lat * Math.PI / 180;
                    const lat2 = targetLocation.lat * Math.PI / 180;
                    const y = Math.sin(dLon) * Math.cos(lat2);
                    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                    const bearingToTarget = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

                    let alignmentError = Math.abs(bearingToTarget - targetRunwayHeading);
                    if (alignmentError > 180) alignmentError = 360 - alignmentError;
                    let headingDiff = Math.abs(plane.heading - targetRunwayHeading);
                    if (headingDiff > 180) headingDiff = 360 - headingDiff;
                    const distToTarget = getDistanceNM(plane.position.lat, plane.position.lon, targetLocation.lat, targetLocation.lon);

                    if (alignmentError < 2.0 && headingDiff < 30 && distToTarget < 25) {
                        established = true;
                    }
                 }
            }

            if (established) {
                if (!isAlternate && gameState.runwayStatus === 'CLOSED') {
                    established = false;
                } else {
                    hdg = targetRunwayHeading;
                    const dist = getDistanceNM(plane.position.lat, plane.position.lon, targetLocation.lat, targetLocation.lon);
                    targetAlt = Math.max(0, dist * 320); 
                    targetSpd = 140; 
                }
            } else {
                if (plane.currentDirectTo) {
                    const wp = airport.waypoints.find(w => w.name === plane.currentDirectTo);
                    if (wp) currentTargetHeading = getBearing(plane.position.lat, plane.position.lon, wp.location.lat, wp.location.lon);
                }
                if (currentDelay > 0) {
                    currentDelay--;
                } else {
                    let diff = currentTargetHeading - hdg;
                    if (diff < -180) diff += 360;
                    if (diff > 180) diff -= 360;
                    if (Math.abs(diff) < TURN_RATE_PER_TICK) hdg = currentTargetHeading;
                    else hdg += Math.sign(diff) * TURN_RATE_PER_TICK;
                    hdg = (hdg + 360) % 360;
                }
            }

            let altDiff = targetAlt - alt;
            if (Math.abs(altDiff) < CLIMB_RATE_PER_TICK) alt = targetAlt;
            else alt += Math.sign(altDiff) * CLIMB_RATE_PER_TICK;
            let spdDiff = targetSpd - spd;
            if (Math.abs(spdDiff) < SPEED_RATE_PER_TICK) spd = targetSpd;
            else spd += Math.sign(spdDiff) * SPEED_RATE_PER_TICK;
            
            let groundSpeed = spd;
            if (gameState.gameTier >= 1) {
                const windRad = (gameState.windDirection - hdg) * Math.PI / 180;
                const headwind = gameState.windSpeed * Math.cos(windRad);
                groundSpeed = spd - headwind;
            }
            const distNM = groundSpeed * (GAME_LOOP_MS / 1000 / 3600);
            const destination = getDestinationPoint(plane.position.lat, plane.position.lon, hdg, distNM);
            const newLat = destination.lat;
            const newLon = destination.lon;

            let newHistory = plane.history;
            if (tickCount.current % TRAIL_UPDATE_TICKS === 0) {
                newHistory = [...plane.history, plane.position];
                if (newHistory.length > 100) newHistory.shift(); 
            }

            let newStatus: FlightStatus = plane.status;
            const currentAlert = alertMap.get(plane.id) || 'NONE';

            // Check landing at ANY active airport (Main or Alternate)
            const distToMain = getDistanceNM(newLat, newLon, airport.location.lat, airport.location.lon);
            let landed = false;
            
            if (established && alt < 200) {
                if (distToMain < 0.5) landed = true;
                if (!landed && isAlternate) {
                     // Check alternate distances
                     if (airport.alternates) {
                         for (const alt of airport.alternates) {
                             if (getDistanceNM(newLat, newLon, alt.location.lat, alt.location.lon) < 0.5) {
                                 landed = true;
                                 break;
                             }
                         }
                     }
                }
            }

            if (landed) {
                newStatus = FlightStatus.LANDED;
                scoreRef.current += 1.0;
                landedRef.current += 1;
                if (plane.isTutorial) tutorialJustCompleted = true;
            }
            if (newStatus !== FlightStatus.LANDED) {
                if (currentAlert === 'CRITICAL' && plane.status !== FlightStatus.LOST_SEPARATION) {
                    incidentsRef.current += 1;
                    scoreRef.current -= 0.5;
                    newStatus = FlightStatus.LOST_SEPARATION;
                } else if (currentAlert !== 'CRITICAL' && plane.status === FlightStatus.LOST_SEPARATION) {
                    newStatus = FlightStatus.INBOUND; 
                }
            }
            let hint = null;
            if (scoreRef.current < 10 && !gameState.tutorialCompleted && !tutorialJustCompleted) {
                hint = generateTutorialHints({ ...plane, position: {lat: newLat, lon: newLon} }, gameState.level!);
            }
            return {
                ...plane,
                heading: hdg,
                altitude: alt,
                speed: spd,
                position: { lat: newLat, lon: newLon },
                history: newHistory,
                establishedOnILS: established,
                targetAltitude: targetAlt,
                targetHeading: currentTargetHeading,
                targetSpeed: targetSpd,
                status: newStatus,
                turnDelay: currentDelay,
                proximityAlert: currentAlert,
                tutorialHint: hint
            };
        });
        const updatedActivePlanes = updatedAircraft.filter(p => p.status !== FlightStatus.LANDED);
        setGameState(prev => ({
            ...prev,
            score: scoreRef.current,
            landedCount: landedRef.current,
            separationIncidents: incidentsRef.current,
            timeElapsed: prev.timeElapsed + GAME_LOOP_MS,
            tutorialCompleted: tutorialJustCompleted ? true : prev.tutorialCompleted
        }));
        if (tutorialJustCompleted) speakOffline("Tutorial completado. Buen trabajo, Controlador.");
        return updatedActivePlanes;
      });
    }, GAME_LOOP_MS);
    return () => clearInterval(interval);
  }, [gameState.isPlaying, gameState.level, gameState.isGameOver, gameState.tutorialCompleted]);
  
  const activeAircraft = React.useMemo(() => aircraft.find(a => a.id === selectedAircraftId) || null, [aircraft, selectedAircraftId]);
  return (
    <div className="h-[100dvh] w-screen bg-slate-950 flex flex-col overflow-hidden text-slate-100 font-mono">
      <div className="absolute top-0 left-0 p-4 z-50 pointer-events-none w-full flex justify-between">
        {gameState.level && (
            <div className="flex flex-col gap-2">
                <div>
                    <div className="text-4xl font-bold text-slate-500 opacity-80">score <span className="text-slate-300">{gameState.score.toFixed(1)}</span></div>
                    <div className="text-sm text-slate-500">{gameState.landedCount} landings, {gameState.separationIncidents} incidents</div>
                    <div className="mt-2 text-emerald-500 text-xs tracking-wider uppercase drop-shadow-md font-bold">{gameState.message}</div>
                </div>
                {gameState.score < 10 && renderTutorialPanel()}
            </div>
        )}
        {gameState.level && (
            <div className="flex flex-col items-end gap-1 text-xs">
                <div className={`px-2 py-1 rounded border font-bold ${
                    gameState.runwayStatus === 'OPEN' ? 'bg-emerald-900/50 border-emerald-700 text-emerald-400' : 'bg-red-900/80 border-red-600 text-white animate-pulse'
                }`}>
                    RWY {gameState.level.runwayName}: {gameState.runwayStatus}
                    {gameState.runwayStatus === 'CLOSED' && <div className="text-[10px] opacity-80">{gameState.closureReason} ({(gameState.closureTimer/1000).toFixed(0)}s)</div>}
                </div>
                <div className="px-2 py-1 rounded border bg-slate-800/50 border-slate-700 text-slate-400">VIENTO: {gameState.windDirection.toString().padStart(3,'0')}° / {gameState.windSpeed} KT</div>
                <div className="px-2 py-1 rounded border bg-slate-800/50 border-slate-700 text-slate-500">NIVEL {gameState.gameTier}</div>
            </div>
        )}
      </div>
      <div className="flex-1 relative flex flex-col">
        {gameState.isPlaying && gameState.level ? (
          <>
            <div className="flex-1 relative">
                <RadarScreen 
                    aircraft={aircraft} 
                    airport={gameState.level} 
                    selectedAircraftId={selectedAircraftId}
                    onSelectAircraft={setSelectedAircraftId}
                    pendingUpdates={pendingUpdates}
                    onRadarInteraction={handleRadarInteraction}
                    weatherSeverity={gameState.weatherSeverity}
                    score={gameState.score}
                    gameTier={gameState.gameTier}
                    ashCloud={gameState.ashCloud}
                />
            </div>
            <div className="h-1/3 lg:h-64 z-40">
                <ControlPanel 
                    aircraft={activeAircraft}
                    airport={gameState.level}
                    pendingUpdates={pendingUpdates}
                    setPendingUpdates={setPendingUpdates}
                    radioHistory={radioHistory}
                    onSendCommand={handleSendCommand}
                    isProcessingRadio={isProcessingRadio}
                    availableVoices={availableVoices}
                    currentVoiceURI={selectedVoiceURI}
                    onVoiceChange={setSelectedVoiceURI}
                    onPlayTransmitSound={playRadioBlip}
                />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-[url('https://images.unsplash.com/photo-1542296332-2e44a99cfef9?q=80&w=2666&auto=format&fit=crop')] bg-cover bg-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm"></div>
            <div className="relative z-10 max-w-2xl w-full bg-slate-900/90 p-8 rounded-2xl border border-slate-700 shadow-2xl text-center">
              <h1 className="text-5xl font-bold text-white mb-2 tracking-tighter">CONTROLADOR <span className="text-emerald-500">PRO</span></h1>
              <p className="text-slate-400 mb-8 font-mono text-lg">SIMULADOR DE TRÁFICO AÉREO - MÉXICO</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                {AIRPORTS.map(airport => (
                  <button key={airport.code} onClick={() => startLevel(airport)} disabled={loading} className="flex flex-col items-start p-4 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg transition-all group text-left">
                    <div className="flex justify-between w-full mb-2"><span className="font-bold text-white group-hover:text-emerald-400 transition-colors">{airport.name}</span><span className={`text-[10px] px-2 py-0.5 rounded border uppercase ${airport.difficulty === 'Fácil' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : airport.difficulty === 'Medio' ? 'bg-yellow-900 text-yellow-300 border-yellow-700' : 'bg-red-900 text-red-300 border-red-700'}`}>{airport.difficulty}</span></div>
                    <div className="text-xs text-slate-400 mb-1 font-mono">{airport.code} • {airport.runwayName}</div>
                    <p className="text-xs text-slate-500 line-clamp-2">{airport.description}</p>
                  </button>
                ))}
              </div>
              {loading && <div className="text-emerald-400 animate-pulse font-mono text-sm">Generando tráfico inicial...</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default App;
