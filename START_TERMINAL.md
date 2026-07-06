# Start In Terminal

Follow these steps in PowerShell.

## Step 1: Open terminal in the project folder

```powershell
cd c:\Users\ASUS\OneDrive\Desktop\AI_interview
```

## Step 2: Install dependencies

If you are running the project for the first time, install packages:

```powershell
npm install
```

## Step 3: Add API keys in `.env`

Create or update the `.env` file in the project root.

Example:

```env
GROQ_API_KEY=your_key_here
# or
OPENAI_API_KEY=your_key_here

# optional for voice mode
SARVAM_API_KEY=your_key_here
```

Notes:

- You need `GROQ_API_KEY` or `OPENAI_API_KEY`.
- `SARVAM_API_KEY` is optional.
- If `SARVAM_API_KEY` is missing, the app will still work in typed mode.

## Step 4: Keep your resume file in the project folder

The terminal app reads this file:

```text
resume.pdf
```

So make sure your resume is saved as `resume.pdf` in:

```text
c:\Users\ASUS\OneDrive\Desktop\AI_interview
```

## Step 5: Start the terminal app

Run:

```powershell
npm start
```

## Step 6: Use the interview

What happens next:

1. The app loads `resume.pdf`.
2. If voice is available, it starts live interview mode.
3. If voice is not available, it switches to typed mode.
4. In typed mode, answer in the terminal.

## Step 7: Stop the app

Press:

```text
Ctrl + C
```

## Quick Start

If everything is already set up, use only these commands:

```powershell
cd c:\Users\ASUS\OneDrive\Desktop\AI_interview
npm start
```
