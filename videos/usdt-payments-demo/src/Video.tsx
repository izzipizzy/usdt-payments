import {Audio} from '@remotion/media';
import {Captions} from './Captions';
import {linearTiming, TransitionSeries} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {staticFile, useVideoConfig} from 'remotion';
import {Opening} from './scenes/Opening';
import {Receiving} from './scenes/Receiving';
import {Deposits} from './scenes/Deposits';
import {Collection} from './scenes/Collection';
import {Energy} from './scenes/Energy';
import {Payout} from './scenes/Payout';
import {Operations} from './scenes/Operations';

export const Video = () => {
  const {fps} = useVideoConfig();
  return <>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Платёжная система" durationInFrames={8.6 * fps} premountFor={fps}><Opening /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: .6 * fps})} />
      <TransitionSeries.Sequence name="Адрес для счёта" durationInFrames={14.6 * fps} premountFor={fps}><Receiving /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: .6 * fps})} />
      <TransitionSeries.Sequence name="Поступление" durationInFrames={12.6 * fps} premountFor={fps}><Deposits /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: .6 * fps})} />
      <TransitionSeries.Sequence name="Сбор" durationInFrames={12.6 * fps} premountFor={fps}><Collection /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: .6 * fps})} />
      <TransitionSeries.Sequence name="Пул и Energy" durationInFrames={12.6 * fps} premountFor={fps}><Energy /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: .6 * fps})} />
      <TransitionSeries.Sequence name="Выплата" durationInFrames={14.6 * fps} premountFor={fps}><Payout /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: .6 * fps})} />
      <TransitionSeries.Sequence name="Запуск и бэкап" durationInFrames={13 * fps} premountFor={fps}><Operations /></TransitionSeries.Sequence>
    </TransitionSeries>
    <Audio name="Озвучка: вступление" src={staticFile('audio/scene-0.wav')} from={.6 * fps} premountFor={fps} />
    <Audio name="Озвучка: адрес" src={staticFile('audio/scene-1.wav')} from={8.6 * fps} premountFor={fps} />
    <Audio name="Озвучка: поступление" src={staticFile('audio/scene-2.wav')} from={22.6 * fps} premountFor={fps} />
    <Audio name="Озвучка: сбор" src={staticFile('audio/scene-3.wav')} from={34.6 * fps} premountFor={fps} />
    <Audio name="Озвучка: Energy" src={staticFile('audio/scene-4.wav')} from={46.6 * fps} premountFor={fps} />
    <Audio name="Озвучка: выплата" src={staticFile('audio/scene-5.wav')} from={58.6 * fps} premountFor={fps} />
    <Audio name="Озвучка: запуск" src={staticFile('audio/scene-6.wav')} from={72.6 * fps} premountFor={fps} />
    <Captions />
  </>;
};
