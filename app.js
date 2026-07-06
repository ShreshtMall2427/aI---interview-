const { SarvamAIClient } = require("sarvamai");
const path = require("path");
const record = require("node-record-lpcm16");
const readline = require("readline");
require("dotenv").config();

const { parsePDF, parseImage } = require("./resumeParser");
const { askInterviewer } = require("./llm");

const RESUME_PATH = path.join(__dirname, "resume.pdf");

const JOB_DESC = `
Software Engineer Role:
- Strong DSA
- Java / Backend
- REST APIs
`;

async function loadResume() {
  if (RESUME_PATH.endsWith(".pdf")) {
    return parsePDF(RESUME_PATH);
  }

  return parseImage(RESUME_PATH);
}

const client = process.env.SARVAM_API_KEY
  ? new SarvamAIClient({
      apiSubscriptionKey: process.env.SARVAM_API_KEY,
    })
  : null;

async function startInterview() {
  const resumeText = await loadResume();

  console.log("Resume loaded");
  console.log("AI interview started\n");

  if (!client) {
    console.log("SARVAM_API_KEY not found. Starting typed interview mode instead.\n");
    return startTypedInterview(resumeText);
  }

  const socket = await client.speechToTextStreaming.connect({
    model: "saaras:v3",
    mode: "transcribe",
    "language-code": "en-IN",
    input_audio_codec: "wav",
    sample_rate: "16000",
    flush_signal: "true",
  });

  socket.on("message", async (res) => {
    const userText = res?.data?.transcript;
    if (!userText || userText.trim().length < 3) return;

    console.log("\nYou:", userText);

    try {
      const aiReply = await askInterviewer(resumeText, JOB_DESC, userText);
      console.log("\nInterviewer:\n", aiReply);
    } catch (error) {
      console.error("Interview error:", error.message);
    }
  });

  await socket.waitForOpen();

  console.log("Speak now... (live)");

  try {
    const mic = record.record({
      sampleRate: 16000,
      threshold: 0,
      verbose: false,
      recordProgram: "sox",
    });

    const micStream = mic.stream();

    micStream.on("data", (chunk) => {
      socket.transcribe({
        audio: chunk.toString("base64"),
        sample_rate: 16000,
        encoding: "audio/wav",
      });
    });

    micStream.on("error", async () => {
      console.log("Live microphone capture is unavailable. Switching to typed mode.\n");
      mic.stop();
      await socket.close();
      startTypedInterview(resumeText);
    });
  } catch (error) {
    console.log("Could not start live microphone mode. Switching to typed mode.\n");
    return startTypedInterview(resumeText);
  }
}

function startTypedInterview(resumeText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Type your answers below. Press Ctrl+C to exit.\n");

  const askLoop = () => {
    rl.question("You: ", async (userText) => {
      if (!userText || !userText.trim()) {
        return askLoop();
      }

      try {
        const aiReply = await askInterviewer(resumeText, JOB_DESC, userText.trim());
        console.log("\nInterviewer:\n" + aiReply + "\n");
      } catch (error) {
        console.error("Interview error:", error.message);
      }

      askLoop();
    });
  };

  askLoop();
}

startInterview().catch((error) => {
  console.error("Failed to start interview:", error.message);
});
