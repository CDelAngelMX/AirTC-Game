
import React, { useState, useRef, useEffect } from 'react';
import { Aircraft, RadioMessage, Airport, PendingUpdates } from '../types';

interface ControlPanelProps {
  aircraft: Aircraft | null;
  airport: Airport | null;
  pendingUpdates: PendingUpdates; // Received from parent
  setPendingUpdates: (updates: PendingUpdates) => void; // Update parent
  radioHistory: RadioMessage[];
  onSendCommand: (text: string) => void;
  isProcessingRadio: boolean;
  // Voice Settings
  availableVoices: SpeechSynthesisVoice[];
  currentVoiceURI: string | null;
  onVoiceChange: (voiceURI: string) => void;
  onPlayTransmitSound?: () => void;
}

// Mapeo de códigos ICAO a fraseología de radio
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
  'TAO': 'Aeromar'
};

const getSpokenCallsign = (callsign: string) => {
  const code = callsign.substring(0, 3).toUpperCase();
  const number = callsign.substring(3);
  const name = AIRLINE_NAMES[code] || code.split('').join(' '); 
  return `${name} ${number}`;
};

interface RadioMessageItemProps {
  msg: RadioMessage;
}

const RadioMessageItem = React.memo(({ msg }: RadioMessageItemProps) => (
  <div className={`flex flex-col ${msg.sender === 'ATC' ? 'items-end' : 'items-start'} mb-1`}>
    <div className={`px-2 py-1 rounded max-w-[90%] ${
      msg.sender === 'ATC' ? 'bg-sky-900/40 text-sky-200 border border-sky-800' : 'bg-emerald-900/40 text-emerald-200 border border-emerald-800'
    }`}>
      <span className="font-bold mr-1 text-[10px] opacity-70 block">
        {msg.sender === 'ATC' ? 'TWR' : msg.callsign}:
      </span>
      {msg.text}
    </div>
  </div>
));

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  aircraft, 
  airport,
  pendingUpdates,
  setPendingUpdates,
  radioHistory, 
  onSendCommand,
  isProcessingRadio,
  availableVoices,
  currentVoiceURI,
  onVoiceChange,
  onPlayTransmitSound
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [showWaypoints, setShowWaypoints] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Mobile Tabs State
  const [activeTab, setActiveTab] = useState<'controls' | 'radio'>('controls');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Only scroll if we are near bottom or it's a new message
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    
    // Increment unread count if we are not on the radio tab
    if (activeTab !== 'radio' && radioHistory.length > 0) {
        setUnreadCount(prev => prev + 1);
    }
  }, [radioHistory]);

  // Reset count when switching to radio
  useEffect(() => {
    if (activeTab === 'radio') {
        setUnreadCount(0);
    }
  }, [activeTab]);

  // Determine if there are unsent changes
  const hasChanges = aircraft && (
    (pendingUpdates.heading !== null && pendingUpdates.heading !== Math.round(aircraft.targetHeading)) ||
    (pendingUpdates.altitude !== null && pendingUpdates.altitude !== Math.round(aircraft.targetAltitude)) ||
    (pendingUpdates.speed !== null && pendingUpdates.speed !== Math.round(aircraft.targetSpeed)) ||
    (pendingUpdates.clearedForILS !== aircraft.clearedForILS) ||
    (pendingUpdates.directTo !== null)
  );

  const handleAltitudeChange = (delta: number) => {
    if (!aircraft) return;
    const currentPending = pendingUpdates.altitude ?? Math.round(aircraft.targetAltitude);
    const newAlt = Math.max(0, Math.min(40000, currentPending + delta));
    
    setPendingUpdates({
        ...pendingUpdates,
        altitude: newAlt,
        clearedForILS: false // Disarm ILS if manually changing altitude
    });
  };

  const handleSpeedChange = (delta: number) => {
    if (!aircraft) return;
    const currentPending = pendingUpdates.speed ?? Math.round(aircraft.targetSpeed);
    const newSpd = Math.max(100, Math.min(600, currentPending + delta));
    
    setPendingUpdates({
        ...pendingUpdates,
        speed: newSpd
    });
  };

  const handleHeadingChange = (delta: number) => {
    if (!aircraft) return;
    const currentPending = pendingUpdates.heading ?? Math.round(aircraft.targetHeading);
    let newHdg = (currentPending + delta) % 360;
    if (newHdg < 0) newHdg += 360;
    
    setPendingUpdates({
        ...pendingUpdates,
        heading: newHdg,
        directTo: null, // Cancel direct to if manual heading
        clearedForILS: false // Disarm ILS if manually changing heading
    });
  };
  
  const handleDirectToSelect = (wpName: string) => {
    setPendingUpdates({
        ...pendingUpdates,
        directTo: wpName,
        clearedForILS: false
    });
    setShowWaypoints(false);
  };

  const toggleILS = () => {
    if (!aircraft) return;
    setPendingUpdates({
        ...pendingUpdates,
        clearedForILS: !pendingUpdates.clearedForILS
    });
  };

  const handleTransmit = () => {
    if (!aircraft || !hasChanges) return;

    // Build the command string based on changes
    const parts = [];
    
    // Heading / Navigation
    if (pendingUpdates.directTo) {
        parts.push(`directo a ${pendingUpdates.directTo}`);
    } else if (pendingUpdates.heading !== null && pendingUpdates.heading !== Math.round(aircraft.targetHeading)) {
        // Determine turn direction for realism
        let diff = pendingUpdates.heading - aircraft.heading;
        if (diff < -180) diff += 360;
        if (diff > 180) diff -= 360;
        const direction = diff > 0 ? "derecha" : "izquierda";
        parts.push(`vire ${direction} rumbo ${pendingUpdates.heading}`);
    }

    // Altitude
    if (pendingUpdates.altitude !== null && pendingUpdates.altitude !== Math.round(aircraft.targetAltitude)) {
        if (pendingUpdates.altitude > aircraft.altitude) parts.push(`ascienda nivel ${pendingUpdates.altitude}`);
        else parts.push(`descienda nivel ${pendingUpdates.altitude}`);
    }

    // Speed
    if (pendingUpdates.speed !== null && pendingUpdates.speed !== Math.round(aircraft.targetSpeed)) {
        parts.push(`reduzca velocidad a ${pendingUpdates.speed} nudos`);
    }

    // ILS
    if (pendingUpdates.clearedForILS !== aircraft.clearedForILS) {
        if (pendingUpdates.clearedForILS) parts.push(`autorizado para aterrizar ILS pista ${airport?.runwayName || 'activa'}`);
        else parts.push(`cancele aproximación ILS`);
    }

    if (parts.length === 0) return;

    const spokenCallsign = getSpokenCallsign(aircraft.callsign);
    const commandText = `${spokenCallsign}, ${parts.join(', ')}`;

    onPlayTransmitSound?.(); // Play sound effect
    onSendCommand(commandText);
  };

  const handleSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !aircraft) return;

    let finalMsg = inputText;
    const spokenCallsign = getSpokenCallsign(aircraft.callsign);
    const rawCallsign = aircraft.callsign;
    
    const lowerInput = finalMsg.toLowerCase();
    if (!lowerInput.startsWith(spokenCallsign.toLowerCase()) && 
        !lowerInput.startsWith(rawCallsign.toLowerCase())) {
        finalMsg = `${spokenCallsign}, ${finalMsg}`;
    }

    onPlayTransmitSound?.(); // Play sound effect
    onSendCommand(finalMsg);
    setInputText('');
  };

  const toggleMic = () => {
    if (isListening) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz nativo.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.start();
    setIsListening(true);
    recognition.onresult = (event: any) => setInputText(event.results[0][0].transcript);
    recognition.onend = () => setIsListening(false);
  };

  if (!aircraft) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 font-mono text-sm uppercase tracking-widest border-t border-slate-700 bg-slate-900">
        Seleccione una aeronave
      </div>
    );
  }

  // Display values (Pending takes precedence over actual target)
  const displayHeading = pendingUpdates.heading ?? Math.round(aircraft.targetHeading);
  const displayAltitude = pendingUpdates.altitude ?? Math.round(aircraft.targetAltitude);
  const displaySpeed = pendingUpdates.speed ?? Math.round(aircraft.targetSpeed);

  return (
    <div className="h-full bg-slate-900 border-t border-slate-700 p-2 font-mono text-slate-200 grid grid-cols-1 lg:grid-cols-3 gap-2 flex flex-col lg:grid overflow-hidden">
      
      {/* MOBILE TABS (Visible only on small screens) */}
      <div className="flex lg:hidden gap-1 mb-1 shrink-0">
          <button 
            onClick={() => setActiveTab('controls')}
            className={`flex-1 py-1 text-xs font-bold rounded uppercase border ${activeTab === 'controls' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
          >
              Controles
          </button>
          <button 
            onClick={() => setActiveTab('radio')}
            className={`flex-1 py-1 text-xs font-bold rounded uppercase border relative ${activeTab === 'radio' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
          >
              Radio
              {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping"></span>
              )}
              {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center text-[8px] text-white">
                      {unreadCount}
                  </span>
              )}
          </button>
      </div>

      {/* LEFT: Physical Controls */}
      <div className={`lg:col-span-2 grid-cols-3 gap-2 bg-slate-800/50 p-2 rounded border border-slate-700 relative 
        ${activeTab === 'controls' ? 'grid' : 'hidden'} lg:grid overflow-y-auto`}
      >
        
        {/* Info Header */}
        <div className="col-span-3 flex justify-between items-center border-b border-slate-700 pb-2 mb-2">
            <div>
                <span className="text-xl font-bold text-yellow-400 mr-2">{aircraft.callsign}</span>
                <span className="text-xs text-slate-400">{aircraft.model}</span>
                {aircraft.establishedOnILS && <span className="ml-2 px-2 py-0.5 bg-cyan-900 text-cyan-300 text-[10px] rounded border border-cyan-700">LOC CAPTURED</span>}
            </div>
            <div className="text-xs text-slate-300 flex gap-4">
                <span className="text-slate-400">ACTUAL:</span>
                <span>HDG: {Math.floor(aircraft.heading)}°</span>
                <span>ALT: {Math.floor(aircraft.altitude)}</span>
                <span>SPD: {Math.floor(aircraft.speed)}</span>
            </div>
        </div>

        {/* Heading Control */}
        <div className="flex flex-col items-center border-r border-slate-700 px-2 relative">
          <label className="text-[10px] text-slate-400 mb-1">RUMBO (HDG)</label>
          <div className="flex items-center gap-1">
            <button onClick={() => handleHeadingChange(-10)} className="bg-slate-700 hover:bg-slate-600 p-1 rounded min-w-[30px] text-xs">-10</button>
            <div className={`text-lg font-bold w-16 text-center transition-colors 
                ${pendingUpdates.directTo ? 'text-sky-400 text-xs' : displayHeading !== Math.round(aircraft.targetHeading) ? 'text-yellow-400 animate-pulse' : 'text-emerald-400'}`}>
                {pendingUpdates.directTo ? pendingUpdates.directTo : pendingUpdates.clearedForILS && aircraft.establishedOnILS ? 'ILS' : displayHeading + '°'}
            </div>
            <button onClick={() => handleHeadingChange(10)} className="bg-slate-700 hover:bg-slate-600 p-1 rounded min-w-[30px] text-xs">+10</button>
          </div>
          <div className="flex gap-1 mt-1">
              <button onClick={() => setShowWaypoints(!showWaypoints)} className="text-[9px] bg-sky-800 text-sky-200 px-2 py-0.5 rounded border border-sky-600 hover:bg-sky-700">DIRECTO</button>
          </div>
          
          {showWaypoints && airport && (
              <div className="absolute bottom-full left-0 w-full bg-slate-800 border border-slate-600 rounded shadow-xl max-h-48 overflow-y-auto z-50">
                  {airport.waypoints.map(wp => (
                      <button 
                        key={wp.name} 
                        onClick={() => handleDirectToSelect(wp.name)}
                        className="w-full text-left px-2 py-1 text-xs hover:bg-slate-700 border-b border-slate-700/50 flex justify-between"
                      >
                          <span className="font-bold text-sky-400">{wp.name}</span>
                          <span className="text-[8px] text-slate-500">{wp.type}</span>
                      </button>
                  ))}
              </div>
          )}
        </div>

        {/* Altitude Control */}
        <div className="flex flex-col items-center border-r border-slate-700 px-2">
          <label className="text-[10px] text-slate-400 mb-1">ALTITUD</label>
          <div className="flex items-center gap-1">
            <button onClick={() => handleAltitudeChange(-1000)} className="bg-slate-700 hover:bg-slate-600 p-1 rounded min-w-[30px] text-xs">-1k</button>
            <div className={`text-lg font-bold w-16 text-center transition-colors
                ${displayAltitude !== Math.round(aircraft.targetAltitude) ? 'text-yellow-400 animate-pulse' : 'text-emerald-400'}`}>
                {pendingUpdates.clearedForILS && aircraft.establishedOnILS ? 'GS' : displayAltitude}
            </div>
            <button onClick={() => handleAltitudeChange(1000)} className="bg-slate-700 hover:bg-slate-600 p-1 rounded min-w-[30px] text-xs">+1k</button>
          </div>
          <button onClick={() => handleAltitudeChange(-100)} className="mt-1 text-[9px] bg-slate-800 px-2 py-0.5 rounded border border-slate-600">Ajuste Fino (-100)</button>
        </div>

        {/* Speed / ILS Control */}
        <div className="flex flex-col items-center px-2">
          <label className="text-[10px] text-slate-400 mb-1">VELOCIDAD</label>
          <div className="flex items-center gap-1">
            <button onClick={() => handleSpeedChange(-20)} className="bg-slate-700 hover:bg-slate-600 p-1 rounded min-w-[30px] text-xs">-20</button>
            <div className={`text-lg font-bold w-12 text-center transition-colors
                ${displaySpeed !== Math.round(aircraft.targetSpeed) ? 'text-yellow-400 animate-pulse' : 'text-emerald-400'}`}>
                {displaySpeed}
            </div>
            <button onClick={() => handleSpeedChange(20)} className="bg-slate-700 hover:bg-slate-600 p-1 rounded min-w-[30px] text-xs">+20</button>
          </div>
          
          <button 
                onClick={toggleILS}
                className={`mt-2 w-full text-[10px] px-2 py-1 rounded font-bold uppercase border transition-all ${
                    aircraft.establishedOnILS 
                    ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                    : pendingUpdates.clearedForILS
                        ? 'bg-yellow-600 text-white border-yellow-400 animate-pulse'
                        : 'bg-slate-700 text-slate-400 border-slate-600 hover:bg-slate-600'
                }`}
            >
                {aircraft.establishedOnILS ? 'ILS LOCKED' : pendingUpdates.clearedForILS ? 'ILS ARMADO' : 'ILS APP'}
          </button>
        </div>

        {/* Transmit Button Overlay/Section */}
        <div className="col-span-3 mt-1 flex justify-end">
            <button 
                onClick={handleTransmit}
                disabled={!hasChanges || isProcessingRadio}
                className={`w-full py-2 rounded font-bold tracking-widest transition-all
                    ${!hasChanges 
                        ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed' 
                        : isProcessingRadio
                            ? 'bg-emerald-900 text-emerald-500 border border-emerald-700 animate-pulse cursor-wait'
                            : 'bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    }`}
            >
                {isProcessingRadio ? 'TRANSMITIENDO...' : hasChanges ? 'TRANSMITIR COMANDOS' : 'TRANSMITIR COMANDOS'}
            </button>
        </div>
      </div>

      {/* RIGHT: Radio / Communication */}
      <div className={`flex flex-col bg-black rounded border border-slate-700 overflow-hidden relative lg:flex lg:h-full 
        ${activeTab === 'radio' ? 'flex-1 h-full' : 'hidden'}`}
      >
        {/* Header */}
        <div className="bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-400 flex justify-between items-center shrink-0">
            <span>FRECUENCIA 118.1</span>
            <div className="flex gap-2">
                 {isProcessingRadio && <span className="text-emerald-400 animate-pulse">TX...</span>}
                 <button onClick={() => setShowSettings(!showSettings)} className="hover:text-white" title="Configuración de Voz">
                    ⚙️
                 </button>
            </div>
        </div>

        {/* Voice Settings Popover */}
        {showSettings && (
            <div className="absolute top-7 right-2 left-2 z-50 bg-slate-800 border border-slate-600 rounded shadow-xl p-2 text-xs">
                <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-slate-300">Voz ATC / Sistema</span>
                    <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white">✕</button>
                </div>
                <select 
                    value={currentVoiceURI || ''}
                    onChange={(e) => onVoiceChange(e.target.value)}
                    className="w-full bg-black border border-slate-600 rounded p-1 text-slate-200 focus:outline-none"
                >
                    {availableVoices.length === 0 && <option value="">Por defecto (Sistema)</option>}
                    {availableVoices.map(v => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name} ({v.lang})
                        </option>
                    ))}
                </select>
                <div className="mt-2 text-[10px] text-slate-500 italic">
                    * Los pilotos tendrán voces aleatorias.
                </div>
            </div>
        )}
        
        {/* Messages Log (Scrollable, takes remaining space) */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs font-mono min-h-0 bg-black/50">
          {radioHistory.length === 0 && (
            <div className="text-slate-600 italic text-center mt-4">Canal libre.</div>
          )}
          {radioHistory.map((msg) => (
            <RadioMessageItem key={msg.id} msg={msg} />
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area (Static at bottom) */}
        <form onSubmit={handleSubmitText} className="p-1 bg-slate-900 border-t border-slate-800 flex gap-1 shrink-0 z-10 relative">
          <button 
            type="button" 
            onClick={toggleMic}
            className={`p-2 rounded transition-colors ${isListening ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
              <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
            </svg>
          </button>
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-black border border-slate-700 rounded px-2 text-sm text-green-400 font-mono focus:outline-none focus:border-green-500 placeholder-slate-700"
            placeholder="Instrucciones manuales..." 
            disabled={isProcessingRadio}
          />
          <button 
            type="submit" 
            className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-50"
            disabled={isProcessingRadio || !inputText.trim()}
          >
            ENV
          </button>
        </form>
      </div>
    </div>
  );
};

export default ControlPanel;
