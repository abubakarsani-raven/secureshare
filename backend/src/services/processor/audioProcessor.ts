import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  encryptBuffer,
  serializeEncrypted,
  getEncryptionKey,
} from '../encryption';
import { uploadFile } from '../storage';
import { embedPhase, floatToInt16, int16ToFloat } from '../watermark/audioWatermark';
import { WatermarkPayload } from '../watermark/lsbWatermark';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegStatic);
}

const CHUNK_DURATION = 30;
const SAMPLE_RATE = 44100;

function transcodeToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFrequency(SAMPLE_RATE)
      .audioChannels(1)
      .format('wav')
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

// Walk the RIFF chunk list to find 'data' — ffmpeg WAVs often carry extra
// chunks (LIST/fact), so a hardcoded offset of 44 would read garbage samples.
function wavToPcm(wavBuffer: Buffer): Float64Array {
  if (wavBuffer.length < 12 || wavBuffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a RIFF/WAV file');
  }
  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const end = Math.min(offset + 8 + chunkSize, wavBuffer.length);
      return int16ToFloat(wavBuffer.slice(offset + 8, end));
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  throw new Error('WAV data chunk not found');
}

function pcmToWav(samples: Float64Array): Buffer {
  const pcm = floatToInt16(samples);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function processAudio(
  inputPath: string,
  shareId: string,
  payload: WatermarkPayload
): Promise<{ chunkCount: number; duration: number }> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audio-'));
  try {
    const wavPath = path.join(workDir, 'input.wav');
    await transcodeToWav(inputPath, wavPath);
    const wavBuffer = fs.readFileSync(wavPath);
    let samples = wavToPcm(wavBuffer);

    samples = embedPhase(samples, payload);

    const samplesPerChunk = SAMPLE_RATE * CHUNK_DURATION;
    const chunkCount = Math.ceil(samples.length / samplesPerChunk);
    const duration = samples.length / SAMPLE_RATE;

    // Chunks stay lossless (WAV/PCM): re-encoding to a perceptual codec like
    // AAC would destroy the phase-coded watermark embedded above.
    for (let i = 0; i < chunkCount; i++) {
      const start = i * samplesPerChunk;
      const chunk = samples.slice(start, start + samplesPerChunk);
      const chunkWav = pcmToWav(chunk);
      const encrypted = await encryptBuffer(chunkWav, getEncryptionKey());
      const serialized = serializeEncrypted(encrypted);
      await uploadFile(`shares/${shareId}/audio/chunk_${i}.enc`, serialized, 'application/octet-stream');
    }

    return { chunkCount, duration };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
