import React from 'react';
import {AbsoluteFill, CanvasImage, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

export const C = {bg: '#081c19', ink: '#effbf5', muted: '#9cb9ac', green: '#57efae', yellow: '#e6fda0'};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const Stage = ({children, chapter}: {children: React.ReactNode; chapter: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <AbsoluteFill style={{background: C.bg, color: C.ink, fontFamily: 'Arial, sans-serif', overflow: 'hidden'}}>
    <AbsoluteFill style={{backgroundImage: 'radial-gradient(circle at 86% 42%, #164d38 0%, transparent 50%), radial-gradient(#70968930 1px, transparent 1px)', backgroundSize: 'auto, 36px 36px'}} />
    <div style={{position: 'absolute', left: 104, top: 68, fontSize: 28, fontWeight: 700, letterSpacing: -1}}>usdt<span style={{color: C.green}}>-payments</span></div>
    <div style={{position: 'absolute', right: 104, top: 70, color: C.muted, fontSize: 20, letterSpacing: 3}}>TRON · TRC-20</div>
    <div style={{position: 'absolute', left: 104, top: 140, width: 1712, height: 1, background: '#62857450'}} />
    <AbsoluteFill style={{opacity: interpolate(frame, [0, .5 * fps], [0, 1], clamp), translate: `${interpolate(frame, [0, .7 * fps], [0, 0], clamp)}px ${interpolate(frame, [0, .7 * fps], [24, 0], {...clamp, easing: Easing.bezier(.16, 1, .3, 1)})}px`}}>{children}</AbsoluteFill>
    <div style={{position: 'absolute', left: 104, bottom: 62, fontSize: 18, color: C.muted, letterSpacing: 1.3}}>{chapter}</div>
    <div style={{position: 'absolute', right: 104, bottom: 62, fontSize: 18, color: C.muted}}>ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ</div>
  </AbsoluteFill>;
};

export const Heading = ({eyebrow, title, detail}: {eyebrow: string; title: React.ReactNode; detail: string}) => <div style={{position: 'absolute', left: 104, top: 214, width: 710}}>
  <div style={{fontSize: 23, fontWeight: 700, color: C.green, letterSpacing: 3, marginBottom: 28}}>{eyebrow}</div>
  <div style={{fontSize: 91, fontWeight: 700, letterSpacing: -4, lineHeight: 1.04}}>{title}</div>
  <div style={{fontSize: 34, color: C.muted, lineHeight: 1.45, marginTop: 34, maxWidth: 650}}>{detail}</div>
</div>;

export const Screenshot = ({file, caption, zoom = 1, position = '50% 50%', height = 532, fit = 'cover'}: {file: string; caption: string; zoom?: number; position?: string; height?: number; fit?: 'cover' | 'contain'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <div style={{position: 'absolute', left: 880, top: 221, width: 934, border: '1px solid #62907970', borderRadius: 26, overflow: 'hidden', background: '#f7faf8', boxShadow: '0 40px 90px #0008', scale: interpolate(frame, [0, 7 * fps], [.97, 1], clamp)}}>
    <div style={{height: 56, background: '#17332b', display: 'flex', alignItems: 'center', paddingLeft: 24, gap: 9}}>
      {['#f1978c', '#e6fda0', '#57efae'].map(color => <div key={color} style={{width: 10, height: 10, borderRadius: 10, background: color}} />)}
      <span style={{marginLeft: 16, fontSize: 17, color: '#c4ddd0'}}>{caption}</span>
    </div>
    <div style={{height, overflow: 'hidden', position: 'relative'}}>
      <CanvasImage src={staticFile(`screenshots/${file}`)} premountFor={fps} style={{width: '100%', height: '100%', objectFit: fit, objectPosition: position, scale: zoom}} />
    </div>
  </div>;
};

export const Tag = ({children, top = 750}: {children: React.ReactNode; top?: number}) => <div style={{position: 'absolute', left: 104, top, padding: '16px 24px', borderRadius: 40, border: '1px solid #5fe7ac60', background: '#113d2f', color: C.green, fontSize: 25, fontWeight: 600}}>{children}</div>;

export const Node = ({label, subtitle, x, active = false}: {label: string; subtitle: string; x: number; active?: boolean}) => <div style={{position: 'absolute', left: x, top: 518, width: 480, height: 195, padding: 30, borderRadius: 26, boxSizing: 'border-box', border: `1px solid ${active ? C.green : '#4c7160'}`, background: active ? '#153c2d' : '#112923', boxShadow: active ? '0 0 60px #3fce7e20' : 'none'}}>
  <div style={{color: active ? C.green : C.ink, fontSize: 39, fontWeight: 700, marginBottom: 22}}>{label}</div>
  <div style={{fontSize: 27, color: C.muted}}>{subtitle}</div>
</div>;

export const Route = ({left, start}: {left: number; start: number}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  return <div style={{position: 'absolute', left, top: 610, width: 134, height: 3, background: '#315746'}}>
    <div style={{height: 3, width: interpolate(frame, [start * fps, (start + 1.8) * fps], [0, 134], clamp), background: C.green}} />
    <div style={{position: 'absolute', right: 0, top: -10, fontSize: 25, color: C.green}}>›</div>
  </div>;
};
