import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, Stage} from '../ui';

export const Opening = () => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  return <Stage chapter="01 / ПЛАТЁЖНАЯ СИСТЕМА">
    <div style={{position: 'absolute', left: 104, top: 232, fontSize: 23, fontWeight: 700, color: C.green, letterSpacing: 4}}>ПРИЁМ И ВЫПЛАТЫ USDT</div>
    <div style={{position: 'absolute', left: 97, top: 294, fontSize: 140, fontWeight: 700, letterSpacing: -7, lineHeight: 1.02}}>Платежи USDT.<br/>Под вашим<br/><span style={{color: C.green}}>контролем.</span></div>
    <div style={{position: 'absolute', left: 108, top: 788, fontSize: 34, color: C.muted}}>Свой сервер. Свои ключи. Одна админка.</div>
    <div style={{position: 'absolute', left: 1356, top: 285, width: 338, height: 338, borderRadius: '50%', background: C.green, color: '#093b28', fontSize: 205, fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow: '0 0 140px #43e58d30', scale: interpolate(frame, [0, 1.3 * fps], [.7, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>₮</div>
    <div style={{position: 'absolute', left: 1430, top: 673, fontSize: 27, color: C.muted, letterSpacing: 3}}>SELF-HOSTED</div>
  </Stage>;
};
