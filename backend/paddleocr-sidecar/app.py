"""Optional PaddleOCR sidecar for the Leak Investigator.

A small HTTP service the backend calls (via PADDLE_OCR_URL) as the strongest OCR
layer in the extraction cascade. PaddleOCR is markedly more accurate than
Tesseract on faint, rotated, low-contrast watermark text and ships an angle
classifier. It runs on your own infrastructure, so the leaked content never
leaves your network.

Run:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8008

Then set on the backend:
    PADDLE_OCR_URL=http://localhost:8008
"""
from fastapi import FastAPI, UploadFile, File
import numpy as np
import cv2
from paddleocr import PaddleOCR

app = FastAPI()

# use_angle_cls handles the rotated/tilted on-screen watermark automatically.
_ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)):
    raw = await file.read()
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {"text": ""}
    result = _ocr.ocr(img, cls=True)
    lines = []
    for page in result or []:
        for line in page or []:
            # line = [box, (text, confidence)]
            try:
                lines.append(line[1][0])
            except (IndexError, TypeError):
                continue
    return {"text": " ".join(lines)}
