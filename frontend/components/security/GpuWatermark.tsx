'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  // Identifying text baked into every view (recipient + share id + time).
  label: string;
  // 0..1 overall opacity. Defaults to ~5%: invisible to the naked eye but
  // above the JPEG noise floor so the extractor's normalise pass recovers it.
  opacity?: number;
  // Override the background darkness. Pass true for viewers with a known dark
  // background (e.g. video player, black-background images) regardless of the
  // app theme; omit to follow the active theme automatically.
  dark?: boolean;
}

// Renders a tiled, rotated forensic watermark on the GPU (WebGL). The label is
// rasterized once to a small texture, then a fragment shader repeats and rotates
// it across the whole surface — so tiling/rotation/compositing run on the GPU
// rather than on the 2D canvas CPU path. The layer is pointer-events:none and
// sits above the content; because it is part of the rendered pixels it survives
// screenshots, unlike invisible LSB/DCT marks.
//
// Opacity is kept at 5% — invisible to the naked eye but above the JPEG noise
// floor (~5 luma units). The extractor's greyscale+normalise pass stretches the
// ~14-unit delta back to full contrast for reliable OCR. This matches how
// Netflix, Zoom, and enterprise DLP tools embed on-screen forensic marks.
//
// Colors adapt to the background: dark text on light, light text on dark —
// both produce a ~14-unit recoverable luma delta after normalise.
export default function GpuWatermark({ label, opacity = 0.05, dark: darkProp }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const isDark = darkProp !== undefined ? darkProp : theme === 'dark';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: true });
    if (!gl) return; // WebGL unavailable — caller may also keep a CSS fallback

    // --- rasterize the repeating tile (text glyphs need a 2D raster pass) ---
    // The texture MUST be power-of-two: WebGL1 cannot REPEAT-wrap an NPOT
    // texture (it becomes "incomplete" and samples as transparent).
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const TILE = 512;
    const tile = document.createElement('canvas');
    tile.width = TILE;
    tile.height = TILE;
    const tctx = tile.getContext('2d');
    if (!tctx) return;
    tctx.clearRect(0, 0, TILE, TILE);
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    // Scale the font so the label spans ~92% of the tile width — this makes the
    // text as large as possible (legible once revealed) regardless of label
    // length, rather than a fixed size that shrinks for long names.
    let fontSize = 48;
    tctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const measured = tctx.measureText(label).width || TILE;
    fontSize = Math.max(14, Math.min(64, (fontSize * (TILE * 0.92)) / measured));
    tctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    // On light backgrounds use dark fill + white halo; on dark backgrounds flip
    // them. Both produce a ~14-unit luma delta that survives JPEG and is
    // recovered by the extractor's normalise pass.
    const fillColor = isDark ? 'rgba(240,240,240,0.92)' : 'rgba(15,15,15,0.92)';
    const haloColor = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)';
    const draw = (cx: number, cy: number) => {
      tctx.lineWidth = Math.max(4, fontSize * 0.12);
      tctx.strokeStyle = haloColor;
      tctx.strokeText(label, cx, cy);
      tctx.fillStyle = fillColor;
      tctx.fillText(label, cx, cy);
    };
    draw(TILE / 2, TILE / 4);
    draw(0, (TILE * 3) / 4);
    draw(TILE, (TILE * 3) / 4);

    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };

    const vs = compile(
      gl.VERTEX_SHADER,
      `attribute vec2 p; varying vec2 uv;
       void main(){ uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`
    );
    // Rotate in true pixel space (not uv space) so the tiles stay square and the
    // on-screen watermark angle equals uAngle exactly — that lets the leak tool
    // deskew by a known angle for OCR, regardless of the view's aspect ratio.
    const fs = compile(
      gl.FRAGMENT_SHADER,
      `precision mediump float;
       varying vec2 uv;
       uniform sampler2D tex;
       uniform vec2 uDims;
       uniform float uTile;
       uniform float uOpacity;
       uniform float uAngle;
       void main(){
         vec2 px = uv * uDims;
         float s = sin(uAngle), co = cos(uAngle);
         vec2 r = mat2(co, -s, s, co) * px;
         vec4 t = texture2D(tex, fract(r / uTile));
         gl_FragColor = vec4(t.rgb, t.a * uOpacity);
       }`
    );
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    // Flip Y on upload: the 2D canvas tile has a top-left origin while WebGL
    // textures sample from bottom-left, so without this the label renders
    // upside-down.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uDims = gl.getUniformLocation(prog, 'uDims');
    const uTile = gl.getUniformLocation(prog, 'uTile');
    const uOpacity = gl.getUniformLocation(prog, 'uOpacity');
    const uAngle = gl.getUniformLocation(prog, 'uAngle');

    const render = () => {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const bw = Math.max(1, Math.floor(w * dpr));
      const bh = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uDims, canvas.width, canvas.height);
      // One square tile per ~330 CSS px so each label instance is large enough
      // to read when revealed from a leaked screenshot.
      gl.uniform1f(uTile, 330 * dpr);
      gl.uniform1f(uOpacity, opacity);
      gl.uniform1f(uAngle, -0.5); // -28.6 deg; the leak tool deskews by this
      gl.uniform1i(gl.getUniformLocation(prog, 'tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      gl.deleteTexture(texture);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [label, opacity, isDark]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full z-20"
    />
  );
}
