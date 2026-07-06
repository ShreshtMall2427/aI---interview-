const fs = require("fs");
const pdf = require("pdf-parse");
const Tesseract = require("tesseract.js");

async function parsePDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text;
}

async function parseImage(filePath) {
  const result = await Tesseract.recognize(filePath, "eng");
  return result.data.text;
}

module.exports = { parsePDF, parseImage };