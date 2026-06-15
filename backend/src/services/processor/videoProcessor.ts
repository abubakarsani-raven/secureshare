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
      // Burned-in forensic mark: lives in the actual pixels, so it survives the
      // leaker re-encoding or screen-recording the file (unlike the client-side
      // on-screen overlay). The old params (fontsize 8, shown 1 frame in 30) were
      // unrecoverable after recompression — testing showed OCR read nothing. These
      // are tuned to survive a downscale + CRF 28 transcode while staying subtle:
      //   - fontsize 26 with a black halo: legible on any background once revealed
      //   - white@0.4: faint, and only flickers in for 3 of every 12 frames (~1/8 s
      //     every half second) so it reads as a momentary glint, not a banner
      //   - position drifts so it can't be cropped out at a fixed spot
      // The text is the share token prefix, matching the on-screen watermark and
      // the shares.token_prefix column the leak investigator already matches on.
      .videoFilters(
        `drawtext=text='ID ${watermarkText}':fontsize=26:fontcolor=white@0.4:borderw=2:bordercolor=black@0.5:` +
          `x=(w-tw)/2+mod(n\\,90)*2:y=h*0.12+mod(n\\,120):enable='lt(mod(n\\,12)\\,3)'`
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
