import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...p });

export const Icon = {
  home: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></svg>
  ),
  people: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M17.5 13.5a6.5 6.5 0 0 1 4 6.5" /></svg>
  ),
  star: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" /></svg>
  ),
  inbox: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M4 5h16v14H4z" /><path d="M4 13h5l1.5 2h3L15 13h5" /></svg>
  ),
  settings: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  plus: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
  ),
  check: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
  ),
  chevron: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>
  ),
  search: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
  ),
  send: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M21 3 10.5 13.5" /><path d="M21 3 14 21l-3.5-7.5L3 10z" /></svg>
  ),
  upload: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" /></svg>
  ),
  close: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
  copy: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5h10" /></svg>
  ),
  sparkle: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5" /></svg>
  ),
  phone: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M21 16.4v2.8a1.9 1.9 0 0 1-2.1 1.9 18.6 18.6 0 0 1-8.1-2.9 18.3 18.3 0 0 1-5.6-5.6A18.6 18.6 0 0 1 2.3 4.4 1.9 1.9 0 0 1 4.2 2.4H7a1.9 1.9 0 0 1 1.9 1.6c.1.9.3 1.7.6 2.6a1.9 1.9 0 0 1-.4 2L7.9 9.8a15 15 0 0 0 5.6 5.6l1.2-1.2a1.9 1.9 0 0 1 2-.4c.9.3 1.7.5 2.6.6a1.9 1.9 0 0 1 1.7 2Z" /></svg>
  ),
  phoneIn: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M17 7 7 17" /><path d="M7 9v8h8" /></svg>
  ),
  phoneOut: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M7 17 17 7" /><path d="M9 7h8v8" /></svg>
  ),
  mic: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></svg>
  ),
  speaker: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6" /><path d="M18 6.5a7.8 7.8 0 0 1 0 11" /></svg>
  ),
  keypad: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base({ strokeWidth: 3, ...p })}><path d="M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01" /></svg>
  ),
  backspace: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M8.5 5H20v14H8.5L3 12z" /><path d="m11.5 9.5 5 5M16.5 9.5l-5 5" /></svg>
  ),
  back: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>
  ),
  camera: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="3" y="6.5" width="18" height="13" rx="2.5" /><circle cx="12" cy="13" r="3.5" /><path d="M8.5 6.5 10 4h4l1.5 2.5" /></svg>
  ),
  arrowUp: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
  ),
  chat: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M20.5 11.5a8 8 0 0 1-11.6 7.1L3.5 20l1.4-4.6A8 8 0 1 1 20.5 11.5Z" /></svg>
  ),
  doc: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></svg>
  ),
  image: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" /></svg>
  ),
  pencil: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M4 20l1-4L16.5 4.5l3 3L8 19z" /><path d="m14.5 6.5 3 3" /></svg>
  ),
  compose: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
  ),
  video: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="3" y="6.5" width="12.5" height="11" rx="2.5" /><path d="m15.5 10.5 5.5-3v9l-5.5-3" /></svg>
  ),
  gift: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="3.5" y="9" width="17" height="4" rx="1" /><path d="M5 13v7h14v-7" /><path d="M12 9v11" /><path d="M12 9c-1.2-3.4-5.2-3.6-5.2-1.2C6.8 9.2 9.5 9 12 9Z" /><path d="M12 9c1.2-3.4 5.2-3.6 5.2-1.2C17.2 9.2 14.5 9 12 9Z" /></svg>
  ),
  bot: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4" /><circle cx="12" cy="3.5" r="1" /><path d="M9 13h.01M15 13h.01" strokeWidth="2.6" /><path d="M9.5 16h5" /></svg>
  ),
  shield: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6z" /><path d="m9 12 2.2 2.2L15.2 10" /></svg>
  ),
  help: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9" /><path d="M12 17h.01" /></svg>
  ),
  external: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6H5V6h6" /></svg>
  ),
};
