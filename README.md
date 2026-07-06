# AI Interview

This project has two ways to run:

- Terminal interview: `npm start`
- Web UI: `npm run server` and `npm run client`

## Requirements

- Node.js 18+ recommended
- `npm`
- At least one AI key:
  - `GROQ_API_KEY`, or
  - `OPENAI_API_KEY`
- Optional for voice features:
  - `SARVAM_API_KEY`
- Optional for terminal microphone mode:
  - `sox` installed and available in `PATH`

## Setup

Open PowerShell in the project folder:

```powershell
cd c:\Users\ASUS\OneDrive\Desktop\AI_interview
```

Install dependencies:

```powershell
npm install
cd client
npm install
cd ..
```

Create or update `.env` in the project root:

```env
GROQ_API_KEY=your_key_here
# or
OPENAI_API_KEY=your_key_here

# optional, needed for voice features
SARVAM_API_KEY=your_key_here
```

## Start In Terminal

The terminal version uses [app.js](c:\Users\ASUS\OneDrive\Desktop\AI_interview\app.js) and reads the resume file from the project root as `resume.pdf`.

Start it with:

```powershell
npm start
```

Notes:

- Keep your resume as `resume.pdf` in the project root, or change `RESUME_PATH` in [app.js](c:\Users\ASUS\OneDrive\Desktop\AI_interview\app.js).
- If `SARVAM_API_KEY` is not set, it will fall back to typed interview mode automatically.
- If you want live microphone input in terminal mode, `sox` is required.
- Press `Ctrl + C` to stop the app.

## Start Web UI

The React frontend talks to the backend on port `4000`, so use two terminals.

Terminal 1:

```powershell
npm run server
```

This starts the backend at `http://localhost:4000`.

Terminal 2:

```powershell
npm run client
```

Then open the local URL shown by Vite in the terminal. It is usually:

```text
http://localhost:5173
```

## Quick Command Reference

```powershell
npm start
```

Starts the terminal interview app.

```powershell
npm run server
```

Starts the Express backend for the web UI.

```powershell
npm run client
```

Starts the React frontend.

## Important

- `npm start` does not start the browser UI.
- For the browser UI, always run both `npm run server` and `npm run client`.
