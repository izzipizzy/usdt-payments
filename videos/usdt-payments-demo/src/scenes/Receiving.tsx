import {Heading, Screenshot, Stage, Tag} from '../ui';
export const Receiving = () => <Stage chapter="02 / ВЫДАТЬ АДРЕС">
  <Heading eyebrow="ПРИЁМ ПЛАТЕЖЕЙ" title={<>Свой адрес<br/>для счёта.</>} detail="Создайте адрес в админке и передайте его клиенту для оплаты." />
  <Screenshot file="address-ready.ru.png" caption="Адрес для invoice-001" position="50% 100%" />
  <Tag>Один клиент — постоянный адрес тоже возможен</Tag>
</Stage>;
