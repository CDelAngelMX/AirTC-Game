import React from 'react';
import { Aircraft, FlightStatus } from '../types';

interface FlightStripProps {
  aircraft: Aircraft;
  isSelected: boolean;
  onSelect: () => void;
}

const FlightStrip: React.FC<FlightStripProps> = ({ aircraft, isSelected, onSelect }) => {
  const isEmergency = aircraft.status === FlightStatus.LOST_SEPARATION;

  return (
    <div 
      onClick={onSelect}
      className={`
        w-full p-2 mb-2 border-l-4 font-mono text-xs cursor-pointer select-none transition-all
        ${isEmergency ? 'bg-red-900/30 border-red-500' : 
          isSelected ? 'bg-slate-700 border-yellow-400' : 'bg-slate-800 border-slate-600 hover:bg-slate-700'}
      `}
    >
      <div className="flex justify-between items-center mb-1">
        <span className={`font-bold text-sm ${isEmergency ? 'text-red-400' : 'text-emerald-400'}`}>
          {aircraft.callsign}
        </span>
        <span className="text-slate-400">{aircraft.model}</span>
      </div>
      
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-300">
        <div className="flex justify-between">
          <span>ALT:</span>
          <span className={Math.abs(aircraft.altitude - aircraft.targetAltitude) > 100 ? 'text-yellow-200' : ''}>
            {Math.floor(aircraft.altitude)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>SPD:</span>
          <span className={Math.abs(aircraft.speed - aircraft.targetSpeed) > 10 ? 'text-yellow-200' : ''}>
            {Math.floor(aircraft.speed)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>HDG:</span>
          <span className={Math.abs(aircraft.heading - aircraft.targetHeading) > 5 ? 'text-yellow-200' : ''}>
            {Math.floor(aircraft.heading)}°
          </span>
        </div>
        <div className="flex justify-between">
          <span>EST:</span>
          <span className={aircraft.status === FlightStatus.INBOUND ? 'text-green-400' : 'text-orange-400'}>
            {aircraft.status === FlightStatus.INBOUND ? 'APP' : 'ERR'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default FlightStrip;
