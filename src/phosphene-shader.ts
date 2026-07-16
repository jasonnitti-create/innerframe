// Ashima Arts / Ian McEwan 3D simplex noise — the standard, widely-reused
// public implementation. Everything past it (domain warp, palette, cursor
// and scroll reactivity) is bespoke to this scene.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
  float f = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    f += amp * snoise(p);
    p *= 2.02;
    amp *= 0.48;
  }
  return f;
}

// Inigo Quilez-style domain warp: feed fbm's own output back into itself
// so the field folds into organic, cellular blobs instead of flat bumps.
// Kept gentle (0.5-0.7 scale, not 4.0) — anything stronger pushes the domain
// into high-frequency chaos that aliases into flat white noise instead of
// smooth drifting cloud.
vec3 warp(vec3 p, float t) {
  vec3 q = vec3(
    fbm(p + vec3(0.0, 0.0, t)),
    fbm(p + vec3(5.2, 1.3, 2.8) + t),
    fbm(p + vec3(1.7, 9.2, 4.1) - t)
  );
  vec3 r = vec3(
    fbm(p + 0.6 * q + vec3(1.7, 9.2, 3.3)),
    fbm(p + 0.6 * q + vec3(8.3, 2.8, 1.2)),
    fbm(p + 0.6 * q + vec3(3.1, 5.5, 7.7))
  );
  return p + 0.5 * r;
}
`;

export const phospheneVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const phospheneFragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uMouseEnergy;
uniform float uTune;
uniform vec3 uBg;

varying vec2 vUv;

${NOISE_GLSL}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p2 = (vUv - 0.5) * vec2(aspect, 1.0);
  vec2 mp = (uMouse - 0.5) * vec2(aspect, 1.0);

  float distToMouse = length(p2 - mp);
  float influence = exp(-distToMouse * distToMouse * 3.2) * (0.1 + uMouseEnergy * 0.45);

  float t = uTime * 0.04;
  vec3 domain = vec3(p2 * 1.1, t) + vec3(influence * 0.2, influence * 0.16, influence * 0.1);

  vec3 warped = warp(domain, t);
  float n = fbm(warped) * 0.5 + 0.5;
  n += influence * 0.12;

  // Monochrome: hazy grays surfacing out of near-black, no hue anywhere.
  // The field recedes (darkens, calms) as the viewer tunes in — external
  // signal giving way before the experience starts.
  float haze = smoothstep(0.55, 1.0, n) * 0.42;

  // Breathing pool of light at center, reference-style: slow, faint, alive.
  float pool = exp(-dot(p2, p2) * 2.4) * (0.045 + 0.02 * sin(uTime * 0.45));

  float lum = haze + pool;
  lum *= mix(1.0, 0.35, uTune);

  vec3 color = uBg + vec3(lum) * vec3(1.0, 1.0, 0.97);

  float vig = smoothstep(1.1, 0.3, length(p2));
  color *= mix(0.75, 1.0, vig);

  gl_FragColor = vec4(color, 1.0);
}
`;

export const grainFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uAmount;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  float dist = length(centered);
  vec2 dir = centered / (dist + 0.0001);
  float ca = dist * 0.0016;

  vec3 col;
  col.r = texture2D(tDiffuse, uv - dir * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv + dir * ca).b;

  // Two noise octaves at different cell sizes, averaged, read as clumped
  // film grain rather than uniform per-pixel static.
  vec2 cell = floor(uv * uResolution.xy * 0.8);
  float g1 = hash(cell + fract(uTime * 60.0) * 97.0);
  float g2 = hash(cell * 0.4 + 11.0 + fract(uTime * 41.0) * 53.0);
  float g = mix(g1, g2, 0.45);
  col += (g - 0.5) * uAmount;

  gl_FragColor = vec4(col, 1.0);
}
`;
