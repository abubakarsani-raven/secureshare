import fs from 'fs';
import path from 'path';
import { extractWatermark } from '../backend/src/services/watermark/extractor';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx ts-node extractor/extractWatermark.ts <image-path>');
    process.exit(1);
  }

  if (!process.env.WATERMARK_SECRET) {
    console.error('WATERMARK_SECRET environment variable required');
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(absolutePath);
  const result = await extractWatermark(buffer);

  if (result.found && result.payload) {
    console.log(JSON.stringify({ found: true, method: result.method, payload: result.payload }, null, 2));
  } else {
    console.log(JSON.stringify({ found: false, payload: null }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
