# AI Interview App Report

## Overview

This project is an AI-powered mock interview application that uses a candidate's resume and a target job description to simulate an interview. The system supports both text-based and voice-based interaction.

The app is designed to:
- parse a resume from PDF or image format
- accept a job description
- generate interviewer responses using an LLM
- support speech-to-text and text-to-speech for a live interview experience

## Main Features

- Resume upload and parsing
- Job description input
- Text-based interview chat
- Voice-based interview mode
- Sarvam AI speech-to-text for spoken responses
- Sarvam AI text-to-speech for interviewer replies
- Hands-free live mode with silence detection
- Keyboard shortcuts for voice control

## Tech Stack

### Backend
- Node.js
- Express
- Multer
- pdf-parse
- tesseract.js
- OpenAI-compatible LLM client via Groq or OpenAI
- Sarvam AI SDK

### Frontend
- React
- Vite
- Plain CSS

## Project Structure

- `app.js`
  Terminal-based interview flow with typed fallback and microphone support.

- `server.js`
  Main backend API for resume upload, text chat, job description updates, and voice-turn processing.

- `llm.js`
  Contains the interviewer response generation logic using the configured LLM provider.

- `resumeParser.js`
  Extracts text from PDF resumes or image-based resumes.

- `client/src/App.jsx`
  Frontend UI for upload, chat, live mode, keyboard shortcuts, and audio playback.

- `client/src/styles.css`
  Styling for the web interface and live mode status animations.

## Backend Flow

### Resume Parsing
- PDF resumes are parsed using `pdf-parse`
- Image resumes are parsed using `tesseract.js`

### Text Interview
1. User uploads a resume
2. User sets a job description
3. User types a message
4. Backend sends resume text, job description, and message to the interviewer LLM
5. Backend returns text response and Sarvam TTS audio

### Voice Interview
1. Frontend records microphone audio
2. Audio is converted into WAV format
3. Backend sends the WAV file to Sarvam speech-to-text
4. Transcribed text is passed to the interviewer LLM
5. Backend converts the interviewer reply to speech using Sarvam text-to-speech
6. Frontend plays the generated audio

## Live Mode Behavior

The live voice mode is designed to feel like a natural interview:

- listens automatically after live mode starts
- detects silence and auto-submits after 3 seconds
- restarts listening after the interviewer finishes speaking
- supports keyboard shortcuts:
  - `Q` to stop/finalize the current spoken turn
  - `K` to start listening again manually

## APIs Used

### Sarvam AI
- `speechToText.transcribe(...)`
- `textToSpeech.convert(...)`

### LLM Provider
- Groq via OpenAI-compatible API if `GROQ_API_KEY` is present
- OpenAI if `OPENAI_API_KEY` is present

## Environment Variables

Expected values in `.env`:

- `SARVAM_API_KEY`
- `GROQ_API_KEY` or `OPENAI_API_KEY`
- optional: `PORT`

## Run Instructions

### Backend
```powershell
npm run server
```

### Frontend
```powershell
cd client
npm run dev
```

## Current Status

The application currently supports:
- resume upload and parsing
- text interview with TTS reply playback
- voice interview with STT and TTS
- automatic live mode with silence-based turn completion

## Notes

- Port `4000` must be free before starting the backend unless a different `PORT` is configured.
- Browser microphone permissions must be allowed for voice mode.
- Best experience is expected in modern Chromium-based browsers.

## Conclusion

This project delivers a practical AI mock interview platform that combines resume analysis, role-aware questioning, LLM-based interviewer behavior, and voice interaction through Sarvam AI. It is suitable for interview practice, demo purposes, and further extension into a richer coaching product.
