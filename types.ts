
export enum FlightStatus {
  INBOUND = 'EN_APROXIMACION',
  LANDED = 'ATERRIZADO',
  CRASHED = 'ACCIDENTADO',
  LOST_SEPARATION = 'ALERTA_COLISION',
  GO_AROUND = 'MOTOR_Y_AL_AIRE'
}

export interface Coordinates {
  lat: number;
  lon: number;
}

export type WaypointType = 'VOR' | 'FIX' | 'AIRPORT';

export interface Waypoint {
  name: string;
  type: WaypointType;
  location: Coordinates;
  isEntry?: boolean; // Can planes spawn here?
}

export interface AlternateAirport {
  code: string;
  name: string; // Short name e.g. "Toluca"
  runwayName: string;
  location: Coordinates;
  runwayHeading: number;
  ilsLengthNM: number;
}

export interface PendingUpdates {
  heading: number | null;
  altitude: number | null;
  speed: number | null;
  directTo: string | null;
  clearedForILS: boolean;
}

export interface Aircraft {
  id: string;
  callsign: string; // e.g., AMX543
  model: string; // e.g., B737
  airline: string;
  position: Coordinates;
  history: Coordinates[]; // For radar trails
  heading: number; // 0-359 degrees
  speed: number; // Knots
  altitude: number; // Feet
  status: FlightStatus;
  targetAltitude: number;
  targetHeading: number;
  targetSpeed: number;
  fuel: number; // Percentage
  
  // Physics / Inertia
  turnDelay: number; // Ticks to wait before starting turn
  
  // Navigation State
  currentDirectTo: string | null; // Name of the waypoint flying direct to
  
  // New ILS logic
  clearedForILS: boolean;
  establishedOnILS: boolean;
  
  // Audio
  voiceURI?: string; // Specific voice for this pilot
  
  // Separation Alert State
  proximityAlert?: 'NONE' | 'WARNING' | 'CRITICAL';

  // Emergencies (Level 3+)
  squawk: string; // '1200' normal, '7600' radio fail, '7700' emergency

  // Learning Mode (Score < 10)
  tutorialHint?: string | null;
  isTutorial?: boolean; // Is this the specific training aircraft?
}

export interface Airport {
  code: string;
  name: string;
  runwayName: string; // e.g. "05 Derecha"
  location: Coordinates; // Center of airport
  runwayHeading: number; // Degrees
  difficulty: 'Fácil' | 'Medio' | 'Difícil';
  description: string;
  spawnRate: number; // Base seconds between spawns
  waypoints: Waypoint[];
  initialZoom: number; // Leaflet zoom level
  alternates?: AlternateAirport[]; // Available from Level 1
}

export interface GameState {
  isPlaying: boolean;
  isGameOver: boolean;
  level: Airport | null;
  score: number;
  landedCount: number;
  separationIncidents: number;
  timeElapsed: number;
  message: string | null;
  
  // Level Progression
  gameTier: number; // 0=Basic, 1=Weather/Alternates, 2=Events, 3=Emergencies
  
  // Environmental Conditions
  windSpeed: number;
  windDirection: number;
  weatherSeverity: number; // 0.0 to 1.0 (Visual intensity)
  
  // Runway Status (Level 2+)
  runwayStatus: 'OPEN' | 'CLOSED';
  closureReason: string | null;
  closureTimer: number; // Milliseconds remaining
  
  // Volcanic Ash (Level 2+)
  ashCloud?: {
    points: Coordinates[]; // Polygon
    maxAltitude: number;
  } | null;

  // Tutorial State
  tutorialCompleted: boolean;
  showTutorialPanel: boolean;
}

export interface RadioMessage {
  id: string;
  sender: 'ATC' | 'PILOT';
  callsign?: string;
  text: string;
  timestamp: number;
}
