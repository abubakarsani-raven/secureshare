# PaddleOCR sidecar (optional)

The strongest OCR layer in the Leak Investigator's extraction cascade. It is
**optional** — the investigator works without it (embedded watermark → tuned
Tesseract crop-and-vote → name fuzzy match). When configured, it's tried as a
last resort before giving up, because PaddleOCR reads faint/rotated watermark
text more reliably than Tesseract.

Runs on your own infrastructure: the leaked content never leaves your network.

## Run

```bash
cd backend/paddleocr-sidecar
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8008
```

First start downloads the detection/recognition/angle models (~a few hundred MB).

## Enable on the backend

```bash
# backend/.env
PADDLE_OCR_URL=http://localhost:8008
```

If `PADDLE_OCR_URL` is unset, the backend skips this layer entirely.

## Extraction cascade (each step is a fallback for the previous)

1. **Embedded watermark** (LSB/DCT) — exact, for original image/PDF files.
2. **Perspective correction** — if the user marked screen corners (angled photo).
3. **Tuned Tesseract crop-and-vote** — deskew, OCR each watermark tile in
   isolation (single-line PSM + token charset), vote across copies.
4. **PaddleOCR sidecar** (this service) — stronger OCR when the above misses.
5. **Recipient-name fuzzy match** — last fallback.
