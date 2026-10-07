import {Heading, Screenshot, Stage, Tag} from '../ui';
export const Energy = () => <Stage chapter="05 / ОПЛАТИТЬ РЕСУРСЫ">
  <Heading eyebrow="TRX И ENERGY" title={<>Пул оплачивает<br/>расходы.</>} detail="Пополните пул TRX. Аренду Energy и автопополнение itrx можно настроить отдельно." />
  <Screenshot file="pool-funding.ru.png" caption="Пул TRX для расходов сети" height={532} fit="contain" />
  <Tag>Пул → itrx → Energy для перевода</Tag>
</Stage>;
