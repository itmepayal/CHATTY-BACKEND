import { GoogleGenAI } from "@google/genai";
import { geminiApiKey } from "../../../shared/constants/app.constants.js";

const SUPPORTED_LANGUAGES = {
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
  es: "Spanish",
  fr: "French",
  de: "German",
};

let aiClient = null;
const getAiClient = () => {
  if (!geminiApiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: geminiApiKey });
  }
  return aiClient;
};

// Fallback dictionary for common phrases in calling
const FALLBACK_DICTIONARY = {
  "hello": {
    hi: "नमस्ते",
    gu: "નમસ્તે",
    es: "hola",
    fr: "bonjour",
    de: "hallo",
  },
  "hi": {
    hi: "नमस्ते",
    gu: "નમસ્તે",
    es: "hola",
    fr: "salut",
    de: "hallo",
  },
  "how are you": {
    hi: "आप कैसे हैं?",
    gu: "તમે કેમ છો?",
    es: "¿cómo estás?",
    fr: "comment ça va?",
    de: "wie geht es dir?",
  },
  "can you hear me": {
    hi: "क्या आप मुझे सुन सकते हैं?",
    gu: "શું તમે મને સાંભળી શકો છો?",
    es: "¿me escuchas?",
    fr: "m'entendez-vous?",
    de: "kannst du mich hören?",
  },
  "thank you": {
    hi: "धन्यवाद",
    gu: "આભાર",
    es: "gracias",
    fr: "merci",
    de: "danke",
  },
  "yes": {
    hi: "हाँ",
    gu: "હા",
    es: "sí",
    fr: "oui",
    de: "ja",
  },
  "no": {
    hi: "नहीं",
    gu: "ના",
    es: "no",
    fr: "non",
    de: "nein",
  },
  "bye": {
    hi: "अलविदा",
    gu: "આવજો",
    es: "adiós",
    fr: "au revoir",
    de: "tschüss",
  },
};

/**
 * Translates speech caption text to target language.
 *
 * @param {string} text - The input caption text.
 * @param {string} sourceLang - The source language code (e.g. "en", "hi").
 * @param {string} targetLang - The target language code (e.g. "es", "fr", "gu").
 * @returns {Promise<{ translatedText: string, provider: string }>}
 */
export async function translateCaption(text, sourceLang = "en", targetLang = "es") {
  if (!text || typeof text !== "string") {
    return { translatedText: "", provider: "noop" };
  }

  const cleanText = text.trim();
  const sLang = (sourceLang || "en").toLowerCase().slice(0, 2);
  const tLang = (targetLang || "es").toLowerCase().slice(0, 2);

  if (sLang === tLang) {
    return { translatedText: cleanText, provider: "identity", sourceLang: sLang, targetLang: tLang };
  }

  const targetLangName = SUPPORTED_LANGUAGES[tLang] || "English";
  const sourceLangName = SUPPORTED_LANGUAGES[sLang] || "Auto";

  // Try Gemini API if key is configured
  const client = getAiClient();
  if (client) {
    try {
      const prompt = `You are a real-time speech caption translator for voice and video calls. Translate the following text directly from ${sourceLangName} to ${targetLangName}. Return ONLY the translated sentence, with no commentary, no markdown, and no quotes.\n\nText: ${cleanText}`;
      
      const response = await client.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
      });

      const translated = response.text ? response.text.trim() : "";
      if (translated) {
        return { translatedText: translated, provider: "gemini", sourceLang: sLang, targetLang: tLang };
      }
    } catch (err) {
      console.warn("[call:caption] Gemini translation error, using fallback:", err?.message || err);
    }
  }

  // Graceful fallback for offline / demo environments
  const lower = cleanText.toLowerCase().replace(/[.,?!]/g, "").trim();
  if (FALLBACK_DICTIONARY[lower]?.[tLang]) {
    return {
      translatedText: FALLBACK_DICTIONARY[lower][tLang],
      provider: "dictionary",
      sourceLang: sLang,
      targetLang: tLang,
    };
  }

  return {
    translatedText: `[${targetLangName}] ${cleanText}`,
    provider: "fallback",
    sourceLang: sLang,
    targetLang: tLang,
  };
}
