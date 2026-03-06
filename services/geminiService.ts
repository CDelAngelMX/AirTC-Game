import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Airport } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Fallback data in case API fails
const FALLBACK_FLIGHTS = [
  { callsign: "AMX645", model: "B737", airline: "Aeroméxico" },
  { callsign: "VOI720", model: "A320", airline: "Volaris" },
  { callsign: "VIV102", model: "A321", airline: "VivaAerobus" },
  { callsign: "DAL554", model: "B757", airline: "Delta" },
  { callsign: "UAL890", model: "B737", airline: "United" },
  { callsign: "AMX220", model: "B787", airline: "Aeroméxico" },
  { callsign: "LRC440", model: "A320", airline: "Lacsa" },
  { callsign: "IBE6401", model: "A350", airline: "Iberia" }
];

export const generateFlightScenario = async (airport: Airport, count: number) => {
  try {
    const prompt = `Genera una lista de ${count} vuelos realistas que llegarían al aeropuerto ${airport.name} (${airport.code}). 
    Usa aerolíneas reales que operan ahí. Devuelve solo JSON válido.`;

    const responseSchema: Schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          callsign: { type: Type.STRING, description: "Código de vuelo ICAO, ej. AMX453" },
          model: { type: Type.STRING, description: "Modelo de avión, ej. Boeing 737" },
          airline: { type: Type.STRING, description: "Nombre de aerolínea" }
        },
        required: ["callsign", "model", "airline"]
      }
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.7
      }
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return FALLBACK_FLIGHTS.slice(0, count);

  } catch (error) {
    // Fail silently to fallback if quota exceeded or offline
    console.warn("Gemini generation failed, using fallback data.");
    return FALLBACK_FLIGHTS.sort(() => 0.5 - Math.random()).slice(0, count);
  }
};
