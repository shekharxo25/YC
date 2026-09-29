// Hand-built SVG art for Wren: the mascot, the five world heroes and simple story scenes.
// Everything is inline so it renders offline and looks the same on every device.

export function wrenSVG({ size = 120, mood = "happy", listening = false } = {}) {
  const eye = mood === "sleepy" ? `<path d="M73 43q4 3 8 0" stroke="#1E2430" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<circle cx="77" cy="43" r="5.2" fill="#1E2430"/><circle cx="78.8" cy="41.2" r="1.7" fill="#fff"/>`;
  const beak = mood === "talk" ? `<path d="M91 47l14 1-13 4z" fill="#E98B2E"/><path d="M91 52l11 3-11 1z" fill="#C86F1D"/>` : `<path d="M91 47l15 3-15 4z" fill="#E98B2E"/>`;
  const ring = listening ? `<g class="wren-ring"><circle cx="64" cy="64" r="58" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="3"/></g>` : "";
  return `<svg viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true" class="wren-svg">${ring}
  <path d="M30 70 C14 58 10 34 18 18 C28 34 36 44 44 52 Z" fill="#7A4B2E"/>
  <path d="M24 30 l8 10 M20 40 l10 8" stroke="#5C3620" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="62" cy="72" rx="36" ry="32" fill="#9C6440"/>
  <ellipse cx="68" cy="82" rx="23" ry="19" fill="#F3D2A8"/>
  <circle cx="76" cy="50" r="22" fill="#9C6440"/>
  <path d="M62 38 q14 -8 28 2" stroke="#F3D2A8" stroke-width="4" fill="none" stroke-linecap="round"/>
  ${eye}${beak}
  <circle cx="86" cy="56" r="4" fill="#E98B8B" opacity=".55"/>
  <path d="M46 70 q10 16 30 12" stroke="#7A4B2E" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M55 102 l-4 12 M52 114 l-6 2 M52 114 l2 4 M72 102 l2 12 M74 114 l-4 3 M74 114 l6 1" stroke="#C86F1D" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}

export const logoSVG = () => `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="var(--brand)"/><g transform="translate(3 4) scale(.27)">
<path d="M30 70 C14 58 10 34 18 18 C28 34 36 44 44 52 Z" fill="#F3D2A8"/><ellipse cx="62" cy="72" rx="36" ry="32" fill="#F3D2A8"/><circle cx="76" cy="50" r="22" fill="#F3D2A8"/>
<circle cx="78" cy="45" r="5.5" fill="#1E2430"/><path d="M92 47l17 3-17 5z" fill="#F2BD45"/></g></svg>`;

const HEROES = {
  dinos: (c = "#6BA368") => `<g><path d="M40 118 q-30 -6 -34 -30 q18 14 40 12z" fill="${c}"/><ellipse cx="72" cy="100" rx="38" ry="26" fill="${c}"/>
    <path d="M44 80 l8 -12 8 10 8 -13 8 12 8 -11 6 12" fill="#4F8A4D"/>
    <path d="M92 90 q6 -38 30 -40 q20 2 18 22 q-2 16 -26 18z" fill="${c}"/><circle cx="128" cy="64" r="4.5" fill="#1E2430"/><circle cx="129.5" cy="62.5" r="1.4" fill="#fff"/>
    <path d="M122 80 q8 4 16 -2" stroke="#2E5130" stroke-width="3" fill="none" stroke-linecap="round"/>
    <rect x="52" y="116" width="12" height="18" rx="5" fill="#4F8A4D"/><rect x="80" y="116" width="12" height="18" rx="5" fill="#4F8A4D"/>
    <path d="M112 44 q10 -16 24 -6 l-4 8z" fill="#D9534F"/></g>`,
  space: (c = "#6C7BD9") => `<g><line x1="84" y1="30" x2="84" y2="14" stroke="#9AA3B5" stroke-width="3"/><circle cx="84" cy="12" r="5" fill="#F2BD45"/>
    <rect x="56" y="30" width="56" height="44" rx="14" fill="#C9D1E3"/><rect x="64" y="40" width="40" height="24" rx="9" fill="#1F2A55"/>
    <circle cx="76" cy="52" r="4.5" fill="#7FE0F0"/><circle cx="92" cy="52" r="4.5" fill="#7FE0F0"/>
    <rect x="50" y="78" width="68" height="44" rx="12" fill="${c}"/><circle cx="84" cy="98" r="8" fill="#F2BD45"/>
    <rect x="36" y="84" width="12" height="28" rx="6" fill="#C9D1E3"/><rect x="120" y="84" width="12" height="28" rx="6" fill="#C9D1E3"/>
    <rect x="60" y="122" width="14" height="14" rx="4" fill="#9AA3B5"/><rect x="94" y="122" width="14" height="14" rx="4" fill="#9AA3B5"/></g>`,
  ocean: (c = "#E8743B") => `<g><path d="M40 84 l-26 -22 v44z" fill="#C85A26"/><ellipse cx="84" cy="84" rx="48" ry="32" fill="${c}"/>
    <path d="M70 56 q14 -22 30 -4" fill="#C85A26"/><path d="M76 104 q10 18 22 4" fill="#C85A26"/>
    <path d="M62 60 q-6 24 0 48 M78 54 q-6 30 0 60" stroke="#F7B08A" stroke-width="5" fill="none" opacity=".7"/>
    <circle cx="112" cy="76" r="8" fill="#fff"/><circle cx="114" cy="76" r="4.5" fill="#1E2430"/>
    <path d="M118 96 q6 2 10 -3" stroke="#7A2F10" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="140" cy="54" r="5" fill="none" stroke="#fff" stroke-width="2.5" opacity=".8"/><circle cx="150" cy="36" r="3.5" fill="none" stroke="#fff" stroke-width="2" opacity=".7"/></g>`,
  forest: (c = "#D9733B") => `<g><path d="M30 112 q-18 -30 10 -46 q16 28 28 40z" fill="${c}"/><path d="M26 92 q-4 -14 8 -22 q4 12 10 18z" fill="#FFF3E6"/>
    <ellipse cx="80" cy="104" rx="34" ry="24" fill="${c}"/><ellipse cx="86" cy="112" rx="18" ry="12" fill="#FFF3E6"/>
    <path d="M88 60 l14 -26 8 30z M122 60 l10 -28 12 28z" fill="${c}"/><path d="M96 58 l6 -14 4 16z M126 58 l6 -15 6 15z" fill="#5A2E14"/>
    <path d="M84 70 q32 -26 64 0 q-6 22 -32 28 q-26 -6 -32 -28z" fill="${c}"/><path d="M100 84 q16 18 32 0 q-16 10 -32 0z" fill="#FFF3E6"/>
    <circle cx="104" cy="74" r="4" fill="#1E2430"/><circle cx="128" cy="74" r="4" fill="#1E2430"/><ellipse cx="116" cy="88" rx="5" ry="4" fill="#1E2430"/>
    <rect x="62" y="120" width="10" height="16" rx="4" fill="#5A2E14"/><rect x="90" y="120" width="10" height="16" rx="4" fill="#5A2E14"/></g>`,
  trucks: (c = "#E2B23A") => `<g><rect x="20" y="62" width="84" height="46" rx="8" fill="${c}"/><path d="M104 74 h24 l18 20 v14 h-42z" fill="${c}"/>
    <path d="M110 80 h16 l12 14 h-28z" fill="#BFE3F5"/><rect x="28" y="54" width="68" height="12" rx="4" fill="#C8952A"/>
    <circle cx="44" cy="114" r="15" fill="#2B2F36"/><circle cx="44" cy="114" r="6" fill="#9AA3B5"/><circle cx="124" cy="114" r="15" fill="#2B2F36"/><circle cx="124" cy="114" r="6" fill="#9AA3B5"/>
    <circle cx="122" cy="96" r="3.5" fill="#1E2430"/><path d="M140 100 h8" stroke="#F7F2E0" stroke-width="5" stroke-linecap="round"/>
    <path d="M30 76 h60 M30 88 h60" stroke="#C8952A" stroke-width="3"/></g>`,
};
export const heroSVG = (world, size = 160) =>
  `<svg viewBox="0 0 170 150" width="${size}" height="${Math.round(size * 0.88)}" aria-hidden="true">${(HEROES[world] || HEROES.dinos)()}</svg>`;

const SCENERY = {
  dinos: { sky: ["#FCE9C0", "#F7D79B"], ground: "#9CC27B", props: (i) => [`<circle cx="330" cy="54" r="26" fill="#F7B544"/>`, `<path d="M0 150 q60 -50 120 -20 q60 -40 130 0 q60 -30 150 10 v60 h-400z" fill="#86B268"/>`, i === 2 || i === 3 ? `<ellipse cx="250" cy="178" rx="26" ry="32" fill="#F4F0E4" stroke="#D8CFB8" stroke-width="3"/><path d="M232 172 l8 8 8 -10 8 10 8 -8" stroke="#8F8872" stroke-width="3" fill="none"/>` : "", `<path d="M40 190 q10 -40 22 0" fill="#4F8A4D"/><path d="M350 196 q8 -30 18 0" fill="#4F8A4D"/>`] },
  space: { sky: ["#1B2350", "#2E3A78"], ground: "#B7B9C9", props: (i) => [`<circle cx="60" cy="40" r="2" fill="#fff"/><circle cx="140" cy="70" r="1.6" fill="#fff"/><circle cx="220" cy="30" r="2.2" fill="#fff"/><circle cx="360" cy="80" r="1.8" fill="#fff"/><circle cx="300" cy="24" r="1.5" fill="#fff"/>`, `<circle cx="330" cy="56" r="30" fill="#E9A15E"/><ellipse cx="330" cy="56" rx="46" ry="8" fill="none" stroke="#F4D6A8" stroke-width="3"/>`, `<ellipse cx="80" cy="200" rx="30" ry="8" fill="#9C9EB2"/><ellipse cx="300" cy="190" rx="22" ry="6" fill="#9C9EB2"/>`, i === 4 || i === 5 ? `<path d="M250 150 l6 14 15 2 -11 10 3 15 -13 -8 -13 8 3 -15 -11 -10 15 -2z" fill="#F7D84A"/>` : ""] },
  ocean: { sky: ["#CDEFF7", "#7FC6DF"], ground: "#E9D8A6", props: (i) => [`<path d="M0 60 q50 -12 100 0 t100 0 t100 0 t100 0" stroke="#fff" stroke-width="3" fill="none" opacity=".6"/>`, `<path d="M30 200 q-10 -50 8 -80 q6 40 -2 80z M52 200 q6 -40 -4 -64 q18 30 12 64z" fill="#3E9A6B"/>`, i >= 1 ? `<g transform="translate(290 170)"><ellipse cx="0" cy="0" rx="24" ry="16" fill="#E0503A"/><path d="M-22 -6 l-12 -12 M22 -6 l12 -12" stroke="#E0503A" stroke-width="6" stroke-linecap="round"/><circle cx="-7" cy="-14" r="4" fill="#1E2430"/><circle cx="7" cy="-14" r="4" fill="#1E2430"/></g>` : "", i === 2 || i === 3 ? `<path d="M230 120 l120 0 M240 100 l0 90 M270 100 l0 90 M300 100 l0 90 M330 100 l0 90 M230 150 l120 0" stroke="#6D5A43" stroke-width="2" opacity=".6"/>` : ""] },
  forest: { sky: ["#E4F2DA", "#C8E4B8"], ground: "#8DB870", props: (i) => [`<path d="M40 190 l30 -110 30 110z" fill="#3F7A4B"/><path d="M330 196 l26 -96 26 96z" fill="#356B41"/><path d="M290 196 l18 -64 18 64z" fill="#4C8A57"/>`, i === 4 || i === 5 ? `<g transform="translate(250 176)"><path d="M-26 10 q0 -28 26 -28 q26 0 26 28z" fill="#6B4AA0"/><rect x="-32" y="8" width="64" height="8" rx="4" fill="#1E2430"/></g>` : "", `<circle cx="340" cy="46" r="20" fill="#F7D068"/>`] },
  trucks: { sky: ["#DCEBF7", "#B8D6EE"], ground: "#C9A57A", props: (i) => [`<path d="M0 170 q100 -30 200 -6 q100 -26 200 0 v60 h-400z" fill="#B48C60"/>`, `<rect x="300" y="60" width="10" height="120" fill="#E2B23A"/><rect x="250" y="60" width="110" height="10" fill="#E2B23A"/><line x1="258" y1="70" x2="258" y2="120" stroke="#555" stroke-width="2"/>`, i === 2 || i === 3 ? `<ellipse cx="120" cy="200" rx="90" ry="14" fill="#7B5A3A"/>` : "", `<circle cx="60" cy="44" r="20" fill="#F7C95C"/>`] },
};
export function sceneSVG(world, page = 0) {
  const s = SCENERY[world] || SCENERY.dinos;
  const heroX = page % 2 ? 150 : 110;
  return `<svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true" class="scene">
  <defs><linearGradient id="sky-${world}-${page}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/></linearGradient></defs>
  <rect width="400" height="220" fill="url(#sky-${world}-${page})"/>
  ${s.props(page).join("")}
  <rect y="196" width="400" height="30" fill="${s.ground}"/>
  <g transform="translate(${heroX} 70) scale(.92)">${(HEROES[world] || HEROES.dinos)()}</g>
</svg>`;
}

export const WORLD_ICON = {
  dinos: "Dinosaurs", space: "Space", ocean: "Ocean", forest: "Forest", trucks: "Trucks",
};
