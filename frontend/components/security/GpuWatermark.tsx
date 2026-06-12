'use client';

import { useEffect, useRef } from 'react';

interface Props {
  // Identifying text baked into every view (recipient + share id + time).
  label: string;
  // 0..1 overall opacity. Defaults to a faint forensic level: barely
  // perceptible during normal viewing, but recoverable from a leaked
  // screenshot by boosting contrast.
  opacity?: number;
}

// Renders a tiled, rotated forensic watermark on the GPU (WebGL). The label is
// rasterized once to a small texture, then a fragment shader repeats and rotates
// it across the whole surface — so tiling/rotation/compositing run on the GPU
// rather than on the 2D canvas CPU path. The layer is pointer-events:none and
// sits above the content; because it is part of the rendered pixels it survives
// screenshots, unlike invisible LSB/DCT marks. It carries a light+dark pair so
// the mark is recoverable on both light and dark backgrounds.
export default function GpuWatermark({ label, opacity = 0.08 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    tctx.font = `600 ${22 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    // Draw a white halo under dark text so the label stays legible on both
    // light backgrounds (messages/documents) and dark ones (video/photos).
    const draw = (cx: number, cy: number) => {
      tctx.lineWidth = 5;
      tctx.strokeStyle = 'rgba(255,255,255,0.85)';
      tctx.strokeText(label, cx, cy);
      tctx.fillStyle = 'rgba(15,15,15,0.9)';
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
    // Repeat + rotate the tile in the shader (GPU), then apply opacity.
    const fs = compile(
      gl.FRAGMENT_SHADER,
      `precision mediump float;
       varying vec2 uv;
       uniform sampler2D tex;
       uniform vec2 uRepeat;
       uniform float uOpacity;
       uniform float uAngle;
       void main(){
         vec2 c = uv * uRepeat;
         float s = sin(uAngle), co = cos(uAngle);
         vec2 r = mat2(co, -s, s, co) * (c - 0.5 * uRepeat) + 0.5 * uRepeat;
         vec4 t = texture2D(tex, fract(r));
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uRepeat = gl.getUniformLocation(prog, 'uRepeat');
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
      // One tile per ~190px so the label repeats densely across any size.
      gl.uniform2f(uRepeat, w / 190, h / 190);
      gl.uniform1f(uOpacity, opacity);
      gl.uniform1f(uAngle, -0.5); // ~ -28 degrees
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
  }, [label, opacity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full z-20"
    />
  );
}
