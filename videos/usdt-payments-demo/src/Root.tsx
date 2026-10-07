import {Composition, Folder} from 'remotion';
import {Video} from './Video';
import {Opening} from './scenes/Opening';
import {Receiving} from './scenes/Receiving';
import {Deposits} from './scenes/Deposits';
import {Collection} from './scenes/Collection';
import {Energy} from './scenes/Energy';
import {Payout} from './scenes/Payout';
import {Operations} from './scenes/Operations';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="UsdtPayments" component={Video} durationInFrames={2550} fps={30} width={1920} height={1080} />
      <Folder name="Scenes">
        <Composition id="Opening" component={Opening} durationInFrames={258} fps={30} width={1920} height={1080} />
        <Composition id="Receiving" component={Receiving} durationInFrames={438} fps={30} width={1920} height={1080} />
        <Composition id="Deposits" component={Deposits} durationInFrames={378} fps={30} width={1920} height={1080} />
        <Composition id="Collection" component={Collection} durationInFrames={378} fps={30} width={1920} height={1080} />
        <Composition id="Energy" component={Energy} durationInFrames={378} fps={30} width={1920} height={1080} />
        <Composition id="Payout" component={Payout} durationInFrames={438} fps={30} width={1920} height={1080} />
        <Composition id="Operations" component={Operations} durationInFrames={390} fps={30} width={1920} height={1080} />
      </Folder>
    </>
  );
};
