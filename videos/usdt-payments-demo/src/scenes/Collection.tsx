import {Heading, Screenshot, Stage, Tag} from '../ui';
export const Collection = () => <Stage chapter="04 / СОБРАТЬ СРЕДСТВА">
  <Heading eyebrow="СБОР USDT" title={<>Средства —<br/>на основной.</>} detail="Автоматический сбор по сумме или времени. Ручной запуск, когда нужно раньше." />
  <Screenshot file="sweeps.ru.png" caption="Сборы на основной кошелёк" position="50% 0%" />
  <Tag>Адрес клиента → основной кошелёк</Tag>
</Stage>;
