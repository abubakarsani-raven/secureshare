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
import { logger } from '../../utils/logger';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegStatic);
}

function runFfmpeg(input: string, outputDir: string, watermarkText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(outputDir, 'output.mp4');
    ffmpeg(input)
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
      ])
      .videoFilters(
        `drawtext=text='${watermarkText}':fontsize=8:fontcolor=white@0.3:x=mod(n\\,30)*10:y=mod(n\\,30)*10:enable='eq(mod(n\\,30)\\,0)'`
      )
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

function createHls(input: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        '-c:v copy',
        '-c:a copy',
        '-hls_time 4',
        '-hls_list_size 0',
        '-hls_segment_filename',
        path.join(outputDir, 'segment_%03d.ts'),
        '-f hls',
      ])
      .output(path.join(outputDir, 'playlist.m3u8'))
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

export async function processVideo(
  inputPath: string,
  shareId: string,
  watermarkText: string
): Promise<{ segmentCount: number; duration: number }> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-video-'));
  try {
    const transcoded = await runFfmpeg(inputPath, workDir, watermarkText);
    await createHls(transcoded, workDir);

    const playlistPath = path.join(workDir, 'playlist.m3u8');
    const playlistContent = fs.readFileSync(playlistPath, 'utf8');
    const segmentFiles = fs
      .readdirSync(workDir)
      .filter((f) => f.endsWith('.ts'))
      .sort();

    for (let i = 0; i < segmentFiles.length; i++) {
      const segBuffer = fs.readFileSync(path.join(workDir, segmentFiles[i]));
      const encrypted = await encryptBuffer(segBuffer, getEncryptionKey());
      const serialized = serializeEncrypted(encrypted);
      await uploadFile(`shares/${shareId}/video/segment_${i}.enc`, serialized, 'application/octet-stream');
    }

    const encryptedPlaylist = await encryptBuffer(Buffer.from(playlistContent), getEncryptionKey());
    const serializedPlaylist = serializeEncrypted(encryptedPlaylist);
    await uploadFile(`shares/${shareId}/video/playlist.enc`, serializedPlaylist, 'application/octet-stream');

    // Sum the real segment durations from the playlist instead of assuming
    // every segment is exactly hls_time seconds.
    let duration = 0;
    for (const match of playlistContent.matchAll(/#EXTINF:([\d.]+)/g)) {
      duration += parseFloat(match[1]);
    }

    return { segmentCount: segmentFiles.length, duration };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
